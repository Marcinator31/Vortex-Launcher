'use strict';
/**
 * Hosting-Labor, Teil 2 (nur GitHub Actions): src/main/hosting.js selbst --
 * so wie der Launcher es benutzt, nur ohne Electron und ohne echtes
 * Minecraft (launch.start ist hier ein Platzhalter, der "laeuft" meldet).
 *
 *   1. Vanilla legt eine Einzelspielerwelt an.
 *   2. hosting.start(): Paper-Download, Paper direkt auf der Welt, bore-Tunnel.
 *      Statusabfrage ueber die bore-Adresse von aussen.
 *   3. Einstellungen (Spielmodus, Schwierigkeit, PvP, Cheats, Whitelist)
 *      -> Antworten des Servers in der Konsole.
 *   4. Konsolenbefehl, "Hosting Options" aus dem Spiel (inbox/*.json).
 *   5. Plugin-Installer: Chunky von Modrinth -> Neustart noetig -> restart()
 *      -> Plugin geladen.
 *   6. "Minecraft geschlossen" (onSessions ohne Spiel) -> Server aus.
 *   7. Vanilla startet die Welt wieder (gleicher Seed, Schwierigkeit vom Server).
 * Bericht: lab/report-e2e-<version>.txt
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const Module = require('module');
const { spawn, execFileSync } = require('child_process');

const V = process.env.LAB_V || '26.2';
const ROOT = path.resolve(process.env.LAB_DIR || 'lab-e2e');
const report = [];
const say = t => { const s = String(t); report.push(s); console.log(s); };
let fehler = 0;
const pruefe = (name, ok, info = '') => { if (!ok) fehler++; say(`${ok ? 'OK  ' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const fin = () => {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, `report-e2e-${V}.txt`), report.join('\n') + '\n');
  process.exit(fehler ? 1 : 0);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const DATA = path.join(ROOT, 'data');
const INSTANZ = path.join(ROOT, 'instanz');
fs.mkdirSync(path.join(INSTANZ, 'saves'), { recursive: true });

// --- Platzhalter fuer die Electron-Teile -------------------------------------
const gesendet = [];
const notizen = [];
let sessions = [];
const javaBin = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['java']).toString().split(/\r?\n/)[0].trim();
const mocks = {
  electron: { app: { getPath: () => DATA, getVersion: () => '2.5.0-lab', isPackaged: false }, shell: {}, BrowserWindow: class {} },
  './core': {
    paths: { dataRoot: DATA, instanceRoot: v => INSTANZ },
    ensureDir: d => fs.mkdirSync(d, { recursive: true }),
    exists: p => fs.existsSync(p),
    log: (m, l) => console.log(`[log${l ? ` ${l}` : ''}] ${m}`),
    notify: (type, text) => { notizen.push(`${type}: ${text}`); console.log(`[notify ${type}] ${text}`); },
    send: (ch, v) => gesendet.push({ ch, v }),
    loadJson: (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } },
    writeJson: (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); }
  },
  './instances': { requireVersion: v => { if (v !== V) throw new Error(`Unknown version ${v}`); return v; } },
  './accounts': { current: () => ({ id: 'a1', username: 'jeb_', uuid: '853c80ef3c3749fdaa49938b674adae6' }), idOf: a => a.id },
  './settings': { get: () => ({ javaPath: '' }) },
  './java': { javaFor: async () => ({ binary: javaBin, major: 25 }) },
  './media': { backupWorld: async () => { say('  (Backup vor dem Hosten angefordert)'); } },
  './jarinfo': {},
  './launch': {
    isLaunching: () => false,
    sessionList: () => sessions,
    start: async ({ version, address, hostedWorld }) => {
      say(`  launch.start(${version}, ${address}, "${hostedWorld}")`);
      sessions = [{ id: 's1', accountId: 'a1', version }];
      return { id: 's1' };
    }
  }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (mocks[req] && (req === 'electron' || /src[\\/]main/.test(parent?.filename || ''))) return `mock:${req}`;
  return origResolve.call(this, req, parent, ...rest);
};
for (const [k, v] of Object.entries(mocks)) {
  const m = new Module(`mock:${k}`);
  m.exports = v;
  m.loaded = true;
  Module._cache[`mock:${k}`] = m;
}

const hosting = require('../../src/main/hosting');
const plugins = require('../../src/main/plugins');

// --- Hilfen ------------------------------------------------------------------
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function dl(url, file) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }

function vanilla(jar, cwd, args, befehle) {
  return new Promise(resolve => {
    const child = spawn('java', ['-Xmx2G', '-jar', jar, '--nogui', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let buf = '', done = false;
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 6 * 60 * 1000);
    const feed = d => {
      buf += String(d);
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) {
        lines.push(l);
        if (!done && /Done \([\d.,]+s\)!/.test(l)) {
          done = true;
          (async () => { for (const b of befehle) { child.stdin.write(`${b}\n`); await sleep(1500); } child.stdin.write('stop\n'); })();
        }
      }
    };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, done, lines }); });
  });
}

function varint(n) { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); }
function ping(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host, () => {
      const h = Buffer.from(host);
      const body = Buffer.concat([varint(0), varint(767), varint(h.length), h, Buffer.from([port >> 8, port & 255]), varint(1)]);
      s.write(Buffer.concat([varint(body.length), body]));
      s.write(Buffer.from([1, 0]));
    });
    let buf = Buffer.alloc(0);
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const str = buf.toString('utf8');
      const i = str.indexOf('{'); const j = str.lastIndexOf('}');
      if (i >= 0 && j > i) { try { const o = JSON.parse(str.slice(i, j + 1)); s.destroy(); resolve(o); } catch (_) {} }
    });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); reject(new Error('ping timeout')); }, 15000);
  });
}

const konsole = () => hosting.console().lines.map(l => l.line);
/** Warten, bis eine Konsolenzeile (ab Index ab) zum Muster passt. */
async function warteZeile(muster, ab, ms = 15000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const z = konsole().slice(ab).find(l => muster.test(l));
    if (z) return z.replace(/^\[[^\]]*\]:?\s*/, '');
    await sleep(250);
  }
  return null;
}
async function warteStatus(st, ms) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (hosting.state().status === st) return true; await sleep(500); }
  return false;
}

// --- Ablauf ------------------------------------------------------------------
(async () => {
  say(`=== Hosting E2E (src/main/hosting.js) Minecraft ${V} ===`);
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const ver = await json(manifest.versions.find(x => x.id === V).url);
  const vjar = path.join(ROOT, 'vanilla.jar');
  await dl(ver.downloads.server.url, vjar);
  const vDir = path.join(ROOT, 'vanilla');
  fs.mkdirSync(vDir);
  fs.writeFileSync(path.join(vDir, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(vDir, 'server.properties'), 'online-mode=false\nserver-port=25598\nlevel-name=welt\ndifficulty=easy\n');
  const saves = path.join(INSTANZ, 'saves');

  // 1) Einzelspielerwelt
  let r = await vanilla(vjar, vDir, ['--universe', saves, '--world', 'welt'], ['seed']);
  const seed1 = r.lines.find(l => /Seed:/.test(l))?.replace(/^.*Seed:/, 'Seed:');
  pruefe('vanilla legt die Welt an', r.done && fs.existsSync(path.join(saves, 'welt', 'level.dat')), seed1);

  // 2) Hosten
  const t0 = Date.now();
  let fehlerStart = null;
  try { await hosting.start({ version: V, world: 'welt', acceptEula: true }); } catch (e) { fehlerStart = e.message; }
  const st = hosting.state();
  pruefe('hosting.start laeuft durch', !fehlerStart && st.status === 'running', fehlerStart || `${Math.round((Date.now() - t0) / 1000)} s`);
  if (fehlerStart) { say(konsole().slice(-40).join('\n')); fin(); return; }
  pruefe('Adresse fuer Freunde ueber bore.pub', st.network === 'bore' && /^bore\.pub:\d+$/.test(st.address || ''), st.address);
  const opZeile = konsole().find(l => /jeb_|operator|does not exist/i.test(l) && !/joined|Starting|Welt/.test(l));
  pruefe('Hoster (echtes Konto jeb_) ist OP', /Made jeb_ a server operator|already an operator/i.test(opZeile || ''), opZeile || '-');
  const ingame = path.join(DATA, 'hosting', 'ingame');
  const stJson = JSON.parse(fs.readFileSync(path.join(ingame, 'state.json'), 'utf8'));
  pruefe('state.json fuers Spiel', stJson.status === 'running' && stJson.address === st.address, JSON.stringify(stJson).slice(0, 160));
  if (st.address) {
    const [h, p] = st.address.split(':');
    try { const o = await ping(h, Number(p)); pruefe('Statusabfrage ueber bore.pub', Boolean(o.version), `${o.version?.name} / ${JSON.stringify(o.description).slice(0, 60)}`); }
    catch (e) { pruefe('Statusabfrage ueber bore.pub', false, e.message); }
  }

  // 3) Einstellungen
  let ab = konsole().length;
  hosting.setSettings(V, 'welt', { difficulty: 'hard' });
  pruefe('Schwierigkeit -> hard', Boolean(await warteZeile(/difficulty/i, ab)), await warteZeile(/difficulty/i, ab, 1));
  ab = konsole().length;
  hosting.setSettings(V, 'welt', { gamemode: 'creative' });
  pruefe('Spielmodus fuer Freunde -> creative', Boolean(await warteZeile(/game ?mode/i, ab)), await warteZeile(/game ?mode/i, ab, 1));
  ab = konsole().length;
  hosting.setSettings(V, 'welt', { pvp: false });
  pruefe('PvP aus (gamerule pvp)', Boolean(await warteZeile(/pvp/i, ab)), await warteZeile(/pvp/i, ab, 1));
  ab = konsole().length;
  hosting.setSettings(V, 'welt', { whitelist: true });
  pruefe('Whitelist an', Boolean(await warteZeile(/whitelist|white-list/i, ab)), await warteZeile(/whitelist|white-list/i, ab, 1));
  hosting.setSettings(V, 'welt', { whitelist: false, maxPlayers: 12 });
  pruefe('max. Spieler -> Neustart noetig', hosting.state().restartNeeded === true, '');
  const gespeichert = hosting.getSettings(V, 'welt').settings;
  pruefe('Einstellungen je Welt gespeichert', gespeichert.difficulty === 'hard' && gespeichert.gamemode === 'creative' && gespeichert.pvp === false && gespeichert.maxPlayers === 12, JSON.stringify(gespeichert));

  // 4) Konsole + "Hosting Options" aus dem Spiel
  ab = konsole().length;
  hosting.command('/say Hallo aus dem Launcher');
  pruefe('Konsolenbefehl', Boolean(await warteZeile(/Hallo aus dem Launcher/, ab)), await warteZeile(/Hallo aus dem Launcher/, ab, 1));
  ab = konsole().length;
  fs.mkdirSync(path.join(ingame, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(ingame, 'inbox', `${Date.now()}-1.json`), JSON.stringify({ type: 'settings', patch: { difficulty: 'peaceful' } }));
  pruefe('Hosting Options im Spiel -> Schwierigkeit peaceful', Boolean(await warteZeile(/peaceful/i, ab)), await warteZeile(/peaceful/i, ab, 1));
  pruefe('inbox abgearbeitet', fs.readdirSync(path.join(ingame, 'inbox')).length === 0, '');
  try { hosting.player('jeb_', 'kick'); pruefe('sich selbst rauswerfen verboten', false); } catch (e) { pruefe('sich selbst rauswerfen verboten', /That would be you/.test(e.message), e.message); }

  // 5) Plugins
  let plug = null;
  try {
    const s = await plugins.search('chunky', V, 0, 'relevance');
    const hit = s.results.find(x => /chunky/i.test(x.title)) || s.results[0];
    say(`  Suche "chunky": ${s.results.slice(0, 4).map(x => x.title).join(', ')}`);
    plug = await plugins.install(hit.projectId, V);
    hosting.pluginsChanged(V);
    pruefe('Plugin installiert', fs.existsSync(path.join(plugins.pluginsDir(V), plug.file)), plug.file);
    pruefe('Plugin in der Liste', plugins.list(V).plugins.some(p => p.file === plug.file), plugins.list(V).plugins.map(p => `${p.title} ${p.version}`).join(', '));
  } catch (e) { pruefe('Plugin installiert', false, e.message); }
  ab = konsole().length;
  let rf = null;
  try { await hosting.restart(); } catch (e) { rf = e.message; }
  pruefe('Neustart', !rf && hosting.state().status === 'running' && !hosting.state().restartNeeded, rf || '');
  if (plug) pruefe('Plugin nach dem Neustart geladen', Boolean(await warteZeile(new RegExp(`Enabling ${plug.title}|\\[${plug.title}\\]`, 'i'), ab, 3000)), await warteZeile(new RegExp(plug.title, 'i'), ab, 1));
  ab = konsole().length;
  hosting.command('difficulty');
  pruefe('Einstellung nach dem Neustart noch da', Boolean(await warteZeile(/peaceful/i, ab)), await warteZeile(/difficulty/i, ab, 1));

  // 6) Minecraft zu -> Server aus
  sessions = [];
  hosting.onSessions(sessions);
  pruefe('Minecraft zu -> Server aus', await warteStatus('off', 60000), notizen.slice(-1)[0] || '');
  pruefe('state.json meldet aus', JSON.parse(fs.readFileSync(path.join(ingame, 'state.json'), 'utf8')).status === 'off', '');

  // 7) Einzelspieler wieder
  r = await vanilla(vjar, vDir, ['--universe', saves, '--world', 'welt'], ['seed', 'difficulty']);
  const seed2 = r.lines.find(l => /Seed:/.test(l))?.replace(/^.*Seed:/, 'Seed:');
  pruefe('Einzelspieler startet die Welt wieder', r.done && r.code === 0, `code ${r.code}`);
  pruefe('gleicher Seed', seed1 && seed1 === seed2, `${seed1} / ${seed2}`);
  say(`  Schwierigkeit danach: ${r.lines.filter(l => /difficulty/i.test(l)).map(l => l.replace(/^\[[^\]]*\]:?\s*/, '')).slice(-1)[0] || '?'}`);
  say('\n--- alle Schwierigkeits-Zeilen der Konsole ---');
  for (const l of konsole().filter(x => /difficult/i.test(x))) say(`  ${l}`);
  say(`\nERGEBNIS: ${fehler ? `${fehler} Fehler` : 'alles OK'}`);
  fin();
})().catch(e => { say(`ABBRUCH: ${e.stack || e.message}`); fehler++; fin(); });
