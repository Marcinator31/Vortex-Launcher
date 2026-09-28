'use strict';
/**
 * Freunde im Launcher: Verbindung zum Freunde-Server (server/ im Repo).
 *
 * ANMELDUNG wie beim Beitreten eines Minecraft-Servers: Der Server schickt
 * eine Zufallszahl, der Launcher meldet sie mit dem Minecraft-Zugang bei
 * Mojang an, der Server prueft das bei Mojang. Der Zugangstoken verlaesst
 * den PC nur Richtung Mojang. Danach gibt es einen eigenen Freunde-Token
 * (60 Tage), damit nicht jeder Neustart ueber Mojang laeuft.
 *
 * Der Launcher zeigt "online"; spielt man eine Vortex-Version, verbindet
 * sich zusaetzlich das Spiel selbst (dann sehen Freunde auch den Server).
 *
 * BENACHRICHTIGUNGEN entscheidet der Launcher anhand der Einstellungen, die
 * auf dem Server liegen (gelten also auch im Spiel): Freund online, Freund
 * auf Server, Nachrichten, Einladungen, Anfragen ... Laeuft das Spiel mit
 * Vortex Client, zeigt das Spiel sie an -- nicht doppelt auch der Launcher.
 */
const fs = require('fs');
const crypto = require('crypto');
const { app, Notification } = require('electron');
const core = require('./core');
const config = require('./config');
const accounts = require('./accounts');
const settings = require('./settings');

const { paths, log, send, loadJson, writeJson, getMainWindow } = core;
const tokenFile = () => require('path').join(paths.dataRoot, 'friends.json');

let ws = null;
let conn = 'off';                 // off | disabled | signedout | connecting | online | offline
let lastError = null;
let data = null;                  // letzter Stand vom Server
let me = null;                    // { uuid, name }
let retry = null, backoff = 2000;
let reqId = 0;
const pending = new Map();
let accountId = null;
let selfPresence = null;
let lastProfileHash = '';
let playing = null;
let pingTimer = null, profileTimer = null;

const url = () => String(process.env.VORTEX_FRIENDS_URL || config.friendsServer || '').trim();

function status() {
  return { conn, error: lastError, configured: Boolean(url()), me, url: url() ? url().replace(/^wss?:\/\//, '').replace(/\/ws$/, '') : '' };
}

function publish() { send('friends', { ev: 'status', data: status() }); }
function setConn(c, err = null) { conn = c; lastError = err; publish(); }

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

function start() {
  const acc = accounts.current();
  const id = acc ? accounts.idOf(acc) : null;
  if (ws && id === accountId && (conn === 'online' || conn === 'connecting')) return;
  stop(false);
  accountId = id;
  if (!url()) { setConn('disabled'); return; }
  if (!acc || !/^[0-9a-f-]{32,36}$/i.test(String(acc.uuid || ''))) { setConn('signedout'); return; }
  connect();
}

function stop(publishIt = true) {
  clearTimeout(retry); retry = null;
  clearInterval(pingTimer); clearInterval(profileTimer);
  if (ws) { try { ws.onclose = null; ws.close(); } catch (_) {} ws = null; }
  for (const p of pending.values()) p.reject(new Error('Not connected to the friends server.'));
  pending.clear();
  data = null; me = null; selfPresence = null; lastProfileHash = '';
  if (publishIt) setConn('off');
}

function scheduleReconnect() {
  clearTimeout(retry);
  retry = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 60000);
}

function connect() {
  const acc = accounts.current();
  if (!acc || !url()) { start(); return; }
  setConn('connecting', lastError);
  let sock;
  try { sock = new WebSocket(url()); } catch (e) { setConn('offline', e.message); scheduleReconnect(); return; }
  ws = sock;
  const uuid = String(acc.uuid).replace(/-/g, '').toLowerCase();
  const tokens = loadJson(tokenFile(), {}) || {};

  sock.onopen = () => {
    sock.send(JSON.stringify({ t: 'hello', client: 'launcher', version: app.getVersion(), token: tokens[uuid] || undefined }));
  };
  sock.onmessage = async ev => {
    let m;
    try { m = JSON.parse(String(ev.data)); } catch (_) { return; }
    try {
      if (m.t === 'challenge') await answerChallenge(sock, acc, uuid, m.serverId);
      else if (m.t === 'ready') onReady(m, uuid);
      else if (m.t === 'error') { lastError = m.error; log(`Friends: ${m.error}`, 'warn'); }
      else if (m.t === 'res') {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); clearTimeout(p.timer); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); }
      } else if (m.t === 'ev') onEvent(m.ev, m.data);
    } catch (e) {
      lastError = e.message;
      log(`Friends: ${e.message}`, 'warn');
      try { sock.close(); } catch (_) {}
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    clearInterval(pingTimer); clearInterval(profileTimer);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('The connection to the friends server was lost.')); }
    pending.clear();
    setConn('offline', lastError);
    scheduleReconnect();
  };
  sock.onerror = () => { lastError = lastError || 'The friends server is not reachable.'; };
}

async function answerChallenge(sock, acc, uuid, serverId) {
  const auth = await accounts.freshAuth(acc, { interactive: false });
  if (!auth?.access_token) throw new Error('Sign in to your Microsoft account again to use friends.');
  const res = await fetch(`${process.env.VORTEX_MOJANG_URL || 'https://sessionserver.mojang.com'}/session/minecraft/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: auth.access_token, selectedProfile: uuid, serverId }),
    signal: AbortSignal.timeout(15000)
  });
  if (res.status !== 204 && !res.ok) throw new Error(`Mojang refused the sign-in (${res.status}). Sign in to your account again.`);
  sock.send(JSON.stringify({ t: 'login', name: acc.username, serverId }));
}

function onReady(m, uuid) {
  const tokens = loadJson(tokenFile(), {}) || {};
  if (m.token && tokens[uuid] !== m.token) { tokens[uuid] = m.token; writeJson(tokenFile(), tokens); }
  me = { uuid: m.uuid, name: m.name };
  backoff = 2000;
  lastError = null;
  setConn('online');
  log(`Friends: connected as ${m.name}.`);
  clearInterval(pingTimer);
  // Etwas Verkehr, damit Hoster die Verbindung nicht als "leer" schliessen.
  pingTimer = setInterval(() => { try { ws?.send('{"t":"ping"}'); } catch (_) {} }, 25000);
  sendActivity();
  clearInterval(profileTimer);
  setTimeout(syncProfile, 3000);
  profileTimer = setInterval(syncProfile, 5 * 60 * 1000);
}

function request(op, args = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || conn !== 'online') { reject(new Error(conn === 'disabled' ? 'Friends are not set up in this launcher.' : 'Not connected to the friends server.')); return; }
    const id = ++reqId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The friends server did not answer.')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ t: 'req', id, op, args }));
  });
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

const friendOf = uuid => data?.friends?.find(f => f.uuid === uuid) || null;
const label = f => (f?.nickname ? `${f.nickname} (${f.name})` : f?.name || '?');

function onEvent(ev, d) {
  switch (ev) {
    case 'state':
      data = d;
      break;
    case 'self':
      selfPresence = d.presence;
      if (data?.me) data.me.status = d.status;
      break;
    case 'presence': {
      const f = friendOf(d.uuid);
      if (f) {
        const prev = f.presence || { state: 'offline' };
        f.presence = d.presence;
        presenceNotice(f, prev, d.presence);
      }
      break;
    }
    case 'message': {
      if (data?.convs) {
        const i = data.convs.findIndex(c => c.id === d.conv.id);
        if (i >= 0) data.convs.splice(i, 1);
        data.convs.unshift(d.conv);
      }
      messageNotice(d.conv, d.message);
      break;
    }
    case 'read':
      if (data?.convs && d.uuid === me?.uuid) { const c = data.convs.find(x => x.id === d.conv); if (c) c.unread = 0; }
      break;
    case 'request': {
      const n = settingsNotify();
      if (n?.requests) notice('request', { title: 'Friend request', body: `${d.name} wants to be your friend.`, uuid: d.uuid });
      break;
    }
    case 'friendAdded':
      notice('friendAdded', { title: 'New friend', body: `${d.name} is now your friend.`, uuid: d.uuid });
      break;
    case 'invite': {
      if (data) data.invites = [...(data.invites || []).filter(i => i.id !== d.id), d];
      const n = settingsNotify();
      if (n?.invites && !friendOf(d.from.uuid)?.muted) {
        notice('invite', { title: `${label(friendOf(d.from.uuid) || d.from)} invites you`, body: `${d.serverName || d.address}${d.version ? ` · Minecraft ${d.version}` : ''}`, uuid: d.from.uuid, invite: d });
      }
      break;
    }
    case 'inviteAnswer':
      notice('inviteAnswer', { title: d.accept ? `${d.from.name} is coming` : `${d.from.name} declined`, body: d.accept ? 'They accepted your invite.' : 'They cannot join right now.', uuid: d.from.uuid, quiet: true });
      break;
    case 'joinRequest': {
      const n = settingsNotify();
      if (n?.joinRequests && !friendOf(d.uuid)?.muted) notice('joinRequest', { title: `${label(friendOf(d.uuid) || d)} wants to join you`, body: 'Send them an invite to your server.', uuid: d.uuid });
      break;
    }
    default: break;
  }
  send('friends', { ev, data: d });
}

const settingsNotify = () => data?.me?.settings?.notify || null;
const gameConnected = () => Boolean(selfPresence?.activity?.client);

function presenceNotice(f, prev, next) {
  const n = settingsNotify();
  if (!n || f.muted) return;
  const ok = level => level === 'all' || (level === 'favorites' && f.favorite);
  if (prev.state === 'offline' && next.state !== 'offline' && ok(n.friendOnline)) {
    notice('online', { title: `${label(f)} is online`, body: next.text || (next.activity ? 'Playing Minecraft' : 'In the launcher'), uuid: f.uuid });
  } else if (prev.state !== 'offline' && next.state === 'offline' && ok(n.friendOffline)) {
    notice('offline', { title: `${label(f)} went offline`, body: '', uuid: f.uuid });
  }
  const addr = next.activity?.address;
  if (addr && addr !== prev.activity?.address && ok(n.friendJoin)) {
    notice('join', { title: `${label(f)} joined a server`, body: next.activity.serverName ? `${next.activity.serverName} (${addr})` : addr, uuid: f.uuid, address: addr, version: next.activity.version, joinable: next.activity.joinable });
  }
}

function messageNotice(c, msg) {
  const n = settingsNotify();
  if (!n || !msg || msg.sender === me?.uuid || c.muted || msg.kind === 'system' || msg.blocked) return;
  const f = friendOf(msg.sender);
  if (f?.muted) return;
  if (c.kind === 'dm') {
    if (n.messages === 'off' || (n.messages === 'favorites' && !f?.favorite)) return;
  } else {
    if (n.groupMessages === 'off') return;
    if (n.groupMessages === 'mentions' && !String(msg.body).toLowerCase().includes(`@${String(me?.name).toLowerCase()}`)) return;
  }
  const who = label(f || { name: msg.senderName });
  const text = msg.kind === 'invite' ? `Invites you to ${msg.extra?.serverName || msg.extra?.address}` : msg.body;
  notice('message', { title: c.kind === 'group' ? `${who} in ${c.name}` : who, body: text.length > 140 ? `${text.slice(0, 139)}…` : text, uuid: msg.sender, conv: c.id });
}

const IMPORTANT = new Set(['message', 'invite', 'joinRequest']);

/** Text fuer Windows-Benachrichtigungen in der Sprache des Launchers. */
function tr(text) {
  try {
    const I = require('../shared/i18n');
    const pref = settings.get().language;
    I.setLanguage(pref === 'auto' ? (/^de/i.test(app.getLocale()) ? 'de' : 'en') : pref);
    return I.tr(text);
  } catch (_) { return text; }
}

function notice(kind, payload) {
  const n = settingsNotify();
  if (!n) return;
  const mode = data?.me?.status?.mode;
  if (mode === 'dnd' && n.dndSilence && kind !== 'inviteAnswer') return;
  const isPlaying = Boolean(playing?.playing);
  if (isPlaying) {
    if (n.whilePlaying === 'off') return;
    if (n.whilePlaying === 'important' && !IMPORTANT.has(kind)) return;
    // Das Spiel zeigt es selbst an -- nicht doppelt.
    if (gameConnected() && n.inGame) return;
  }
  const win = getMainWindow();
  const focused = Boolean(win && win.isFocused() && !win.isMinimized());
  send('friends-notify', { kind, ...payload, sound: n.sound, focused });
  if (!focused && n.desktop && Notification.isSupported()) {
    try {
      const note = new Notification({ title: tr(payload.title), body: tr(payload.body || ''), silent: !n.sound });
      note.on('click', () => {
        const w = getMainWindow();
        if (w) { w.show(); if (w.isMinimized()) w.restore(); w.focus(); }
        send('friends-open', { uuid: payload.uuid, conv: payload.conv });
      });
      note.show();
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Spiel laeuft? / Mod-Profil
// ---------------------------------------------------------------------------

function onSessions(list) {
  const acc = accounts.current();
  const mine = (list || []).find(s => acc && s.accountId === accounts.idOf(acc));
  const next = mine ? { playing: true, version: mine.version, since: mine.startedAt } : { playing: false };
  if (JSON.stringify(next) === JSON.stringify(playing)) return;
  playing = next;
  sendActivity();
}

function sendActivity() {
  if (conn !== 'online' || !playing) return;
  request('activity', playing).catch(() => {});
}

/** Welche Mods habe ich? (fuer "Mod-Profil ansehen" bei Freunden) */
function syncProfile() {
  if (conn !== 'online') return;
  try {
    const instances = require('./instances');
    const versions = {};
    for (const v of instances.allVersions()) {
      if (!fs.existsSync(paths.modsRoot(v))) continue;
      const mods = instances.listMods(v).map(m => ({
        name: m.name, version: m.version, id: m.id, projectId: m.projectId || '', enabled: m.enabled,
        vortex: m.source === 'vortex' || m.source === 'addon' || m.source === 'bundled'
      }));
      if (mods.length) versions[v] = { loader: 'fabric', mods };
    }
    const hash = crypto.createHash('sha1').update(JSON.stringify(versions)).digest('hex');
    if (hash === lastProfileHash) return;
    request('profile.set', { versions }).then(() => { lastProfileHash = hash; }).catch(e => log(`Friends: mod profile: ${e.message}`, 'debug'));
  } catch (e) { log(`Friends: mod profile: ${e.message}`, 'debug'); }
}

async function signOut() {
  const acc = accounts.current();
  const uuid = String(acc?.uuid || '').replace(/-/g, '').toLowerCase();
  const tokens = loadJson(tokenFile(), {}) || {};
  if (tokens[uuid]) {
    try { await request('logout', { token: tokens[uuid] }); } catch (_) {}
    delete tokens[uuid];
    writeJson(tokenFile(), tokens);
  }
}

module.exports = {
  start, stop, status, request, onSessions, syncProfile, signOut,
  snapshot: () => data,
  gameUrl: url,
  reconnect: () => { backoff = 2000; stop(false); start(); }
};
