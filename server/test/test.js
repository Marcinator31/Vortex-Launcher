'use strict';
/**
 * Durchlauf aller Funktionen mit einer gefaelschten Mojang-Pruefung.
 *   node test/test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { start } = require('../src/server');

const uuidOf = name => crypto.createHash('md5').update(name).digest('hex');
const fakeJoined = async (name) => (name === 'Nobody' ? null : { uuid: uuidOf(name), name });

class Client {
  constructor(url, name, kind = 'launcher') { this.url = url; this.name = name; this.kind = kind; this.events = []; this.n = 0; this.pending = new Map(); this.waiters = []; }
  async connect(token) {
    this.ws = new WebSocket(this.url);
    await new Promise((r, j) => { this.ws.once('open', r); this.ws.once('error', j); });
    return new Promise((resolve, reject) => {
      this.ws.on('message', raw => {
        const m = JSON.parse(String(raw));
        if (m.t === 'challenge') this.ws.send(JSON.stringify({ t: 'login', name: this.name, serverId: m.serverId }));
        else if (m.t === 'ready') { this.me = m; resolve(m); }
        else if (m.t === 'error') reject(new Error(m.error));
        else if (m.t === 'res') { const p = this.pending.get(m.id); this.pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); }
        else if (m.t === 'ev') {
          this.events.push(m);
          if (m.ev === 'state') this.state = m.data;
          this.waiters = this.waiters.filter(w => { if (w.ev === m.ev && w.pred(m.data)) { w.resolve(m.data); return false; } return true; });
        }
      });
      this.ws.send(JSON.stringify({ t: 'hello', client: this.kind, version: 'test', token }));
    });
  }
  req(op, args = {}) {
    const id = ++this.n;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ t: 'req', id, op, args })); });
  }
  wait(ev, pred = () => true, ms = 3000) {
    const hit = this.events.find(e => e.ev === ev && pred(e.data) && !e.used);
    if (hit) { hit.used = true; return Promise.resolve(hit.data); }
    return new Promise((resolve, reject) => {
      const w = { ev, pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    });
  }
  clear() { this.events = []; }
  close() { this.ws.close(); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rejects = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } throw new Error(`expected rejection ${re}`); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
  const ENV = { ...(process.env.TEST_PG ? { DATABASE_URL: process.env.TEST_PG } : { DATA_DIR: dir }), COSMETIC_ADMINS: 'Dave' };
  const srv = await start({ env: ENV, port: 0, hasJoined: fakeJoined });
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  try {
    // --- Anmeldung
    const alice = new Client(url, 'Alice'); const a = await alice.connect();
    assert.equal(a.uuid, uuidOf('Alice'));
    const bob = new Client(url, 'Bob'); await bob.connect();
    const carl = new Client(url, 'Carl'); await carl.connect();
    await rejects(new Client(url, 'Nobody').connect(), /Mojang could not confirm/);

    // Token wiederverwenden
    const alice2 = new Client(url, 'Alice', 'game'); const r2 = await alice2.connect(a.token);
    assert.equal(r2.uuid, a.uuid);
    alice2.close(); await sleep(100);

    // --- Anfragen
    await rejects(alice.req('friend.request', { name: 'Zed' }), /never used Vortex/);
    await rejects(alice.req('friend.request', { name: 'alice' }), /That is you/);
    const r = await alice.req('friend.request', { name: 'bob' });
    assert.equal(r.sent, true);
    await bob.wait('request', d => d.name === 'Alice');
    await rejects(alice.req('friend.request', { name: 'Bob' }), /already sent/);
    await bob.req('friend.accept', { uuid: a.uuid });
    await alice.wait('friendAdded', d => d.name === 'Bob');
    await sleep(50);
    assert.equal(alice.state.friends.length, 1);
    assert.equal(alice.state.friends[0].presence.state, 'online');

    // Gegenseitige Anfrage -> sofort Freunde
    await carl.req('friend.request', { name: 'Alice' });
    const x = await alice.req('friend.request', { name: 'Carl' });
    assert.equal(x.friends, true);

    // --- Privatsphaere: Anfragen nur von Freunden von Freunden
    await bob.req('settings.set', { patch: { privacy: { requests: 'fof' } } });
    const dave = new Client(url, 'Dave'); await dave.connect();
    await rejects(dave.req('friend.request', { name: 'Bob' }), /does not accept friend requests/);
    await carl.req('friend.request', { name: 'Bob' });            // Carl & Bob haben Alice gemeinsam
    await bob.req('friend.accept', { uuid: carl.me.uuid });

    // --- Spiel verbindet sich: Status "spielt" mit Server
    alice.clear();
    const bobGame = new Client(url, 'Bob', 'game'); await bobGame.connect();
    await bobGame.req('activity', { mode: 'server', address: 'mc.hypixel.net', serverName: 'Hypixel', version: '26.2' });
    const p = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.activity?.mode === 'server');
    assert.equal(p.presence.activity.address, 'mc.hypixel.net');
    assert.equal(p.presence.activity.joinable, true);
    const jc = await alice.req('join.check', { uuid: bob.me.uuid });
    assert.equal(jc.address, 'mc.hypixel.net');

    // Server verstecken
    alice.clear();
    await bob.req('settings.set', { patch: { privacy: { showServer: 'nobody' } } });
    const hidden = await alice.wait('presence', d => d.uuid === bob.me.uuid);
    assert.equal(hidden.presence.activity.mode, 'hidden');
    assert.equal(hidden.presence.activity.address, undefined);
    await rejects(alice.req('join.check', { uuid: bob.me.uuid }), /cannot join/);

    // Nur Favoriten
    alice.clear();
    await bob.req('settings.set', { patch: { privacy: { showServer: 'favorites' } } });
    await bob.req('friend.update', { uuid: a.uuid, favorite: true, nickname: 'Ali' });
    const fav = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.activity?.mode === 'server');
    assert.equal(fav.presence.activity.address, 'mc.hypixel.net');
    assert.equal(carl.state.friends.find(f => f.name === 'Bob').presence.activity?.address, undefined);

    // Unsichtbar
    alice.clear();
    await bob.req('status.set', { mode: 'invisible' });
    const inv = await alice.wait('presence', d => d.uuid === bob.me.uuid);
    assert.equal(inv.presence.state, 'offline');
    await bob.req('status.set', { mode: 'dnd', text: 'Bedwars' });
    const dnd = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.state !== 'offline');
    assert.equal(dnd.presence.mode, 'dnd');
    assert.equal(dnd.presence.text, 'Bedwars');

    // --- Chat
    const sent = await alice.req('chat.send', { to: bob.me.uuid, body: '  hallo bob  ' });
    assert.equal(sent.message.body, 'hallo bob');
    const got = await bobGame.wait('message', d => d.message.body === 'hallo bob');
    assert.equal(got.conv.unread, 1);
    await bob.req('chat.read', { conv: got.conv.id, upTo: got.message.id });
    const rd = await alice.wait('read', d => d.uuid === bob.me.uuid);
    assert.equal(rd.upTo, got.message.id);
    await bob.req('chat.typing', { conv: got.conv.id });
    await alice.wait('typing', d => d.uuid === bob.me.uuid);
    const e = await alice.req('chat.edit', { id: sent.message.id, body: 'hallo Bob!' });
    assert.equal(e.message.body, 'hallo Bob!');
    await bob.wait('messageUpdate', d => d.message.body === 'hallo Bob!');
    const hist = await bob.req('chat.history', { conv: got.conv.id });
    assert.equal(hist.messages.length, 1);
    await alice.req('chat.delete', { id: sent.message.id });
    const hist2 = await bob.req('chat.history', { conv: got.conv.id });
    assert.equal(hist2.messages[0].deleted, true);
    await rejects(dave.req('chat.send', { to: a.uuid, body: 'hi' }), /does not accept messages/);

    // --- Gruppe
    const g = await alice.req('group.create', { name: 'PvP Squad', members: [bob.me.uuid, carl.me.uuid] });
    assert.equal(g.conv.members.length, 3);
    await rejects(alice.req('group.add', { conv: g.conv.id, uuid: dave.me.uuid }), /only add friends/);
    await carl.req('chat.send', { conv: g.conv.id, body: 'gg' });
    await bob.wait('message', d => d.message.body === 'gg');
    await bob.req('group.leave', { conv: g.conv.id });
    await alice.req('group.rename', { conv: g.conv.id, name: 'Squad 2' });
    await rejects(carl.req('group.kick', { conv: g.conv.id, uuid: a.uuid }), /Only the group owner/);

    // --- Einladungen
    const invite = await alice.req('invite.send', { to: bob.me.uuid, address: 'play.vortexpvp.eu', version: '26.2' });
    const gotInv = await bobGame.wait('invite', d => d.id === invite.invite.id);
    assert.equal(gotInv.address, 'play.vortexpvp.eu');
    const ans = await bobGame.req('invite.respond', { id: gotInv.id, accept: true });
    assert.equal(ans.address, 'play.vortexpvp.eu');
    await alice.wait('inviteAnswer', d => d.accept === true);
    await rejects(bob.req('invite.respond', { id: gotInv.id, accept: true }), /expired/);
    // Einladungen abschalten
    await bob.req('settings.set', { patch: { privacy: { invites: 'nobody' } } });
    await rejects(alice.req('invite.send', { to: bob.me.uuid, address: 'a.b' }), /does not accept invites/);
    // Ohne Adresse: aktueller Server des Einladenden
    await carl.req('invite.send', { to: a.uuid }).then(() => { throw new Error('should fail'); }, err => assert.match(err.message, /Join a server first/));

    // Mitspielen fragen
    await alice.req('join.ask', { to: bob.me.uuid });
    await bob.wait('joinRequest', d => d.uuid === a.uuid);

    // --- Mod-Profil
    await bob.req('profile.set', { versions: { '26.2': { mods: [{ name: 'Sodium', version: '0.7', id: 'sodium', projectId: 'AANobbMI' }] } } });
    const prof = await alice.req('profile.get', { uuid: bob.me.uuid });
    assert.equal(prof.versions['26.2'].mods[0].name, 'Sodium');
    await bob.req('settings.set', { patch: { privacy: { modProfile: 'nobody' } } });
    await rejects(alice.req('profile.get', { uuid: bob.me.uuid }), /does not share/);

    // --- Blockieren
    await alice.req('block', { name: 'Dave' });
    await rejects(dave.req('friend.request', { name: 'Alice' }), /does not accept friend requests/);
    await sleep(50);
    assert.equal(alice.state.blocked[0].name, 'Dave');
    await alice.req('unblock', { uuid: dave.me.uuid });
    await carl.req('block', { uuid: a.uuid });
    await sleep(50);
    assert.equal(alice.state.friends.some(f => f.name === 'Carl'), false, 'block removes friendship');

    // --- Cosmetics: fuer alle lesbar, Bild nur ohne Blockieren, Melden, Sperren
    const pngKopf = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString('base64'); };
    let cs = await alice.req('cosmetics.set', { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3 });
    assert.equal(cs.cosmetics.cape, '', 'custom cape needs a picture first');
    await rejects(alice.req('cosmetics.image', { image: pngKopf(300, 200) }), /2:1/);
    await rejects(alice.req('cosmetics.image', { image: Buffer.from('hello world').toString('base64') }), /not a PNG or JPEG/);
    await rejects(alice.req('cosmetics.image', { image: Buffer.alloc(90 * 1024).toString('base64') }), /too big/);
    const up = await alice.req('cosmetics.image', { image: pngKopf(512, 256) });
    assert.match(up.hash, /^[0-9a-f]{32}$/);
    await rejects(alice.req('cosmetics.image', { image: pngKopf(1024, 512) }), /wait a moment/);
    cs = await alice.req('cosmetics.set', { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3, extra: 'x' });
    assert.deepEqual(cs.cosmetics, { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3 });
    cs = await bob.req('cosmetics.set', { cape: 'vortex_blue', hat: 'Top Hat!', particles: '', density: 99 });
    assert.deepEqual(cs.cosmetics, { cape: 'vortex_blue', hat: '', particles: '', density: 2 });
    let cg = await bob.req('cosmetics.get', { uuids: [a.uuid, bob.me.uuid, 'kaputt', carl.me.uuid] });
    assert.equal(cg.players[a.uuid].image, up.hash);
    assert.equal(cg.players[a.uuid].hat, 'crown');
    assert.equal(cg.players[bob.me.uuid].cape, 'vortex_blue');
    assert.equal(cg.players[carl.me.uuid], undefined, 'no cosmetics stored for Carl');
    const bild = await bob.req('cosmetics.imageGet', { hash: up.hash });
    assert.equal(bild.image, pngKopf(512, 256));
    // Carl hat Alice blockiert: Hut ja, Bild nein
    cg = await carl.req('cosmetics.get', { uuids: [a.uuid] });
    assert.equal(cg.players[a.uuid].hat, 'crown');
    assert.equal(cg.players[a.uuid].cape, '');
    assert.equal(cg.players[a.uuid].image, null);
    await rejects(carl.req('cosmetics.imageGet', { hash: up.hash }), /not found/);
    // Melden und Sperren (Dave ist Cosmetics-Admin)
    assert.equal((await bob.req('cosmetics.report', { uuid: a.uuid })).reported, true);
    await rejects(bob.req('cosmetics.report', { uuid: carl.me.uuid }), /no cape picture/);
    await rejects(bob.req('cosmetics.reports'), /Only cosmetics admins/);
    const rep = await dave.req('cosmetics.reports');
    assert.equal(rep.reports[0].name, 'Alice');
    assert.equal(rep.reports[0].count, 1);
    await dave.req('cosmetics.moderate', { uuid: a.uuid, action: 'ban' });
    cg = await bob.req('cosmetics.get', { uuids: [a.uuid] });
    assert.equal(cg.players[a.uuid].cape, '');
    assert.equal(cg.players[a.uuid].hat, 'crown', 'only the picture is removed');
    await rejects(bob.req('cosmetics.imageGet', { hash: up.hash }), /not found/);
    await sleep(10);
    await rejects(alice.req('cosmetics.image', { image: pngKopf(512, 256) }), /cannot upload/);
    assert.equal((await dave.req('cosmetics.reports')).reports.length, 0);

    // --- Emotes: an andere im Spiel, nicht an Blockierte, hoechstens eins pro Sekunde
    const bobSpiel = new Client(url, 'Bob', 'game'); await bobSpiel.connect(bob.me.token);
    const carlSpiel = new Client(url, 'Carl', 'game'); await carlSpiel.connect(carl.me.token);
    assert.equal((await alice.req('emote.play', { emote: 'wave' })).sent, true);
    const em = await bobSpiel.wait('emote');
    assert.deepEqual(em, { uuid: a.uuid, emote: 'wave' });
    assert.equal((await alice.req('emote.play', { emote: 'dance' })).sent, false, 'rate limit');
    await rejects(alice.req('emote.play', { emote: 'Bad Emote!' }), /Unknown emote/);
    await sleep(100);
    assert.equal(carlSpiel.events.some(e => e.ev === 'emote'), false, 'Carl blocked Alice');
    assert.equal(bob.events.some(e => e.ev === 'emote'), false, 'only game connections');
    bobSpiel.close(); carlSpiel.close();

    // Freund entfernen
    await alice.req('friend.remove', { uuid: bob.me.uuid });
    await sleep(50);
    assert.equal(bob.state.friends.some(f => f.name === 'Alice'), false);

    // Ungueltige Einstellungen werden ignoriert
    const s = await alice.req('settings.set', { patch: { privacy: { requests: 'hacker' }, notify: { sound: 'yes' } } });
    assert.equal(s.settings.privacy.requests, 'everyone');
    assert.equal(s.settings.notify.sound, true);

    // Offline -> zuletzt gesehen
    bob.clear();
    alice.close();
    await sleep(150);

    // Neustart: Daten sind noch da
    await srv.stop();
    const srv2 = await start({ env: ENV, port: 0, hasJoined: fakeJoined });
    const url2 = `ws://127.0.0.1:${srv2.port}/ws`;
    const c2 = new Client(url2, 'Carl'); await c2.connect(carl.me.token);
    await sleep(100);
    assert.equal(c2.state.blocked[0].name, 'Alice');
    assert.ok(c2.state.convs.some(c => c.kind === 'group' && c.name === 'Squad 2'));
    for (const c of [bob, bobGame, carl, dave, c2]) c.close();
    await srv2.stop();
    console.log('ALL TESTS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err);
    await srv.stop().catch(() => {});
    process.exit(1);
  }
})();
