'use strict';
/**
 * Welt hosten (neu in Launcher 2.5): eine Einzelspielerwelt als Server --
 * mit Paper und Plugins, direkt auf der ECHTEN Welt (keine Kopie), mit
 * Konsole, Einstellungen, Spielerverwaltung und einer Adresse fuer Freunde
 * ohne Konto oder Bestaetigung.
 *
 *   Server      Paper (neuester stabiler Build fuer die Version). Plugins
 *               liegen je Version in hosting/<version>/server/plugins
 *               (Plugin-Installer: plugins.js).
 *   Welt        laeuft direkt im saves-Ordner. paperwelt.js sorgt dafuer,
 *               dass sie danach im Einzelspieler unveraendert weiterlaeuft
 *               (im Hosting-Labor mit echten Servern geprueft). Vor jedem
 *               Start ein Backup.
 *   Freunde     bore.pub (bore.js): kostenloser Tunnel, kein Konto, nichts
 *               zu bestaetigen. Der Launcher erbittet jedes Mal denselben
 *               Port wie zuletzt -- meist bleibt die Adresse gleich. Faellt
 *               bore.pub aus: UPnP im Router, sonst manuelle Freigabe.
 *   Konsole     alle Serverzeilen + Befehlseingabe (sendCommand).
 *   Einstellungen je Welt (Spielmodus, Schwierigkeit, PvP, Cheats fuer
 *               Freunde, Whitelist, max. Spieler) -- wirken sofort, soweit
 *               Minecraft das zulaesst (max. Spieler: beim naechsten Start).
 *   Spieler     Liste mit Kick, Bann, OP, Spielmodus.
 *   Im Spiel    "Hosting Options" im Pausenmenue (Vortex Client): der
 *               Launcher schreibt den Stand nach hosting/ingame/state.json,
 *               das Spiel legt Wuensche in hosting/ingame/inbox/*.json ab.
 *   Ende        Schliesst der Hoster Minecraft, speichert der Server und
 *               geht aus.
 *
 * Der Hoster ist immer Operator (fuer "Hosting Options" im Spiel).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./core');
const { paths, ensureDir, exists, log, notify, send } = core;
const instances = require('./instances');
const accounts = require('./accounts');
const settings = require('./settings');
const java = require('./java');
const nbt = require('./nbt');
const upnp = require('./upnp');
const bore = require('./bore');
const paperwelt = require('./paperwelt');
const plugins = require('./plugins');

const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const savesRoot = v => path.join(paths.instanceRoot(v), 'saves');
const hostRoot = () => path.join(paths.dataRoot, 'hosting');
const serverDir = v => plugins.serverDir(v);
const settingsFile = () => path.join(hostRoot(), 'worlds.json');
const tunnelFile = () => path.join(hostRoot(), 'tunnel.json');
const ingameDir = () => path.join(hostRoot(), 'ingame');
const safeDirName = n => typeof n === 'string' && n && n === path.basename(n) && !n.startsWith('.') && !/[<>:"|?*]/.test(n);
const safeName = n => /^[A-Za-z0-9_]{1,16}$/.test(String(n || ''));
const dashed = u => { const h = String(u || '').replace(/-/g, '').toLowerCase(); return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null; };

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const CONSOLE_MAX = 1500;

let state = { status: 'off' };
let server = null;           // { child, port, version, world, worldDir, uuid, dir, sessionId, tunnel, ... }
let stopping = null;
let konsole = [];            // [{ t, line, level }]
let konsoleRaus = [];        // gesammelt fuer das naechste Senden
let konsoleTimer = null;

function publish(patch) {
  if (patch) state = { ...state, ...patch };
  send('hosting', state);
  schreibeIngame();
}
const step = (label, percent = null) => publish({ step: label, percent });

// ---------------------------------------------------------------------------
// Einstellungen je Welt
// ---------------------------------------------------------------------------

const DEFAULTS = { gamemode: 'survival', difficulty: 'normal', pvp: true, cheats: false, whitelist: false, maxPlayers: 8, whitelistNames: [] };

function alleEinstellungen() { return core.loadJson(settingsFile(), {}) || {}; }

function einstellungen(v, world, worldDir = null) {
  const alle = alleEinstellungen();
  const key = `${v}/${world}`;
  if (alle[key]) return { ...DEFAULTS, ...alle[key] };
  // Erstes Mal: aus der Welt uebernehmen
  const ws = worldDir ? worldSettings(worldDir) : {};
  return { ...DEFAULTS, gamemode: ws.gamemode || DEFAULTS.gamemode, difficulty: ws.difficulty || DEFAULTS.difficulty };
}

function speichereEinstellungen(v, world, werte) {
  const alle = alleEinstellungen();
  alle[`${v}/${world}`] = werte;
  ensureDir(hostRoot());
  core.writeJson(settingsFile(), alle);
}

/** Einstellungen der Welt aus level.dat (1.21: Felder; 26.x: difficulty_settings). */
function worldSettings(worldDir) {
  const out = { gamemode: 'survival', difficulty: 'normal', hardcore: false, cheats: false, name: path.basename(worldDir) };
  try {
    const doc = nbt.readGz(path.join(worldDir, 'level.dat'));
    const data = nbt.child(doc.root, 'Data');
    const val = k => nbt.child(data, k)?.value;
    if (typeof val('LevelName') === 'string' && val('LevelName')) out.name = val('LevelName').slice(0, 64);
    if (GAMEMODES[val('GameType')]) out.gamemode = GAMEMODES[val('GameType')];
    if (DIFFICULTIES[val('Difficulty')]) out.difficulty = DIFFICULTIES[val('Difficulty')];
    if (val('hardcore') === 1) out.hardcore = true;
    const ds = nbt.child(data, 'difficulty_settings');
    if (ds) {
      const d = nbt.child(ds, 'difficulty')?.value;
      if (DIFFICULTIES.includes(d)) out.difficulty = d;
      if (nbt.child(ds, 'hardcore')?.value === 1) out.hardcore = true;
    }
    out.cheats = val('allowCommands') === 1;
  } catch (e) { log(`Hosting: could not read level.dat: ${e.message}`, 'warn'); }
  return out;
}

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'VortexClientLauncher' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
  return res.json();
}

async function downloadTo(url, file, sha256) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0, lastPct = -1;
  for await (const c of res.body) {
    chunks.push(Buffer.from(c));
    got += c.length;
    const pct = total ? Math.floor(got / total * 100) : null;
    if (pct !== lastPct) { lastPct = pct; step('Downloading the server (Paper)', pct); }
  }
  const buf = Buffer.concat(chunks);
  if (sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error('The server download is damaged. Try again.');
  const tmp = `${file}.download`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Neuester stabiler Paper-Build fuer diese Version; ohne Netz der vorhandene. */
async function ensurePaper(v, dir) {
  const jar = path.join(dir, 'paper.jar');
  const metaFile = path.join(dir, 'paper.json');
  const meta = core.loadJson(metaFile, {}) || {};
  try {
    const b = await getJson(`${PAPER_API}/versions/${encodeURIComponent(v)}/builds/latest`);
    const d = b?.downloads?.['server:default'];
    if (!d?.url || !d?.checksums?.sha256) throw new Error(`Paper has no server for Minecraft ${v} yet.`);
    if (!exists(jar) || meta.sha256 !== d.checksums.sha256) {
      await downloadTo(d.url, jar, d.checksums.sha256);
      core.writeJson(metaFile, { build: b.id, sha256: d.checksums.sha256 });
      log(`Hosting: Paper ${v} build ${b.id} downloaded.`);
    }
  } catch (e) {
    if (!exists(jar)) throw e;
    log(`Hosting: using the existing Paper server (${e.message}).`, 'warn');
  }
  return jar;
}

// ---------------------------------------------------------------------------
// Spielerdaten des Hosters (bis 1.21 in level.dat)
// ---------------------------------------------------------------------------

function movePlayerOut(worldDir, uuid) {
  const file = path.join(worldDir, 'level.dat');
  const doc = nbt.readGz(file);
  const player = nbt.child(nbt.child(doc.root, 'Data'), 'Player');
  if (!player || player.type !== nbt.T.COMPOUND || !uuid) return false;
  const dir = path.join(worldDir, 'playerdata');
  ensureDir(dir);
  const target = path.join(dir, `${uuid}.dat`);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, nbt.toGz({ name: '', root: player }));
  fs.renameSync(tmp, target);
  log(`Hosting: your inventory and position were handed to the server (${path.basename(worldDir)}).`);
  return true;
}

function movePlayerBack(worldDir, uuid) {
  if (!uuid) return;
  const src = path.join(worldDir, 'playerdata', `${uuid}.dat`);
  const file = path.join(worldDir, 'level.dat');
  if (!exists(src) || !exists(file)) return;
  const doc = nbt.readGz(file);
  const data = nbt.child(doc.root, 'Data');
  if (!nbt.child(data, 'Player')) return;
  data.value.set('Player', nbt.readGz(src).root);
  const tmp = `${file}.vortex-tmp`;
  fs.writeFileSync(tmp, nbt.toGz(doc));
  fs.renameSync(tmp, file);
  log('Hosting: your inventory and position from the server are back in singleplayer.');
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** server.properties: unsere Werte setzen, den Rest (vom Server) behalten. */
function writeProperties(dir, values) {
  const file = path.join(dir, 'server.properties');
  const lines = exists(file) ? fs.readFileSync(file, 'latin1').split(/\r?\n/) : ['#Minecraft server properties'];
  const left = new Map(Object.entries(values));
  const enc = v => String(v).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/:/g, '\\:');
  const out = lines.map(l => {
    const m = l.match(/^([^#!=:\s][^=:]*?)\s*[=:]/);
    if (!m || !left.has(m[1])) return l;
    const v = left.get(m[1]);
    left.delete(m[1]);
    return `${m[1]}=${enc(v)}`;
  }).filter((l, i, a) => l || i < a.length - 1);
  for (const [k, v] of left) out.push(`${k}=${enc(v)}`);
  fs.writeFileSync(file, `${out.join('\n')}\n`, 'latin1');
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}
async function pickPort() {
  for (const p of [25565, 25566, 25567, 25568, 25569, 25570]) if (await portFree(p)) return p;
  throw new Error('No free port for the server (25565-25570 are all in use).');
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) return a.address;
    }
  }
  return null;
}

async function publicIp() {
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(6000) });
    const ip = (await r.text()).trim();
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip : null;
  } catch (_) { return null; }
}

/** ops.json des Servers lesen (Namen in Kleinschrift). */
function opsListe(dir) {
  try { return new Set((JSON.parse(fs.readFileSync(path.join(dir, 'ops.json'), 'utf8')) || []).map(o => String(o.name || '').toLowerCase())); }
  catch (_) { return new Set(); }
}

// ---------------------------------------------------------------------------
// Konsole
// ---------------------------------------------------------------------------

function konsoleZeile(line, level) {
  const z = { t: Date.now(), line: String(line).slice(0, 2000), level };
  konsole.push(z);
  if (konsole.length > CONSOLE_MAX) konsole = konsole.slice(-CONSOLE_MAX);
  konsoleRaus.push(z);
  if (!konsoleTimer) {
    konsoleTimer = setTimeout(() => {
      konsoleTimer = null;
      const batch = konsoleRaus;
      konsoleRaus = [];
      send('hosting-console', batch);
    }, 120);
  }
}

function sendCommand(cmd) {
  if (!server?.child?.stdin?.writable) return false;
  server.child.stdin.write(`${cmd}\n`);
  return true;
}

/** Befehl aus der Konsole des Launchers (oder aus dem Spiel). */
function command(text) {
  if (state.status !== 'running' && state.status !== 'starting') throw new Error('The server is not running.');
  const cmd = String(text || '').replace(/^\//, '').replace(/[\r\n]/g, ' ').trim().slice(0, 500);
  if (!cmd) return {};
  konsoleZeile(`> ${cmd}`, 'input');
  if (!sendCommand(cmd)) throw new Error('The server is not running.');
  return {};
}

function onServerLine(line) {
  const level = /\b(ERROR|FATAL|SEVERE)\b|Exception/.test(line) ? 'error' : /\bWARN\b/.test(line) ? 'warn' : 'info';
  konsoleZeile(line, level);
  const join = line.match(/]: ([A-Za-z0-9_]{1,16}) joined the game\s*$/);
  const left = line.match(/]: ([A-Za-z0-9_]{1,16}) left the game\s*$/);
  if (join) {
    spielerAktualisieren(join[1]);
    const istHost = join[1].toLowerCase() === String(state.host || '').toLowerCase();
    if (!istHost) {
      notify('success', `${join[1]} joined your world.`);
      // Spielmodus und Cheats aus den Einstellungen gelten auch fuer Neue
      const e = state.settings || DEFAULTS;
      setTimeout(() => {
        sendCommand(`gamemode ${e.gamemode} ${join[1]}`);
        if (e.cheats) sendCommand(`op ${join[1]}`);
      }, 400);
    }
  } else if (left) {
    if (left[1].toLowerCase() !== String(state.host || '').toLowerCase()) notify('info', `${left[1]} left your world.`);
    spielerAktualisieren(null, left[1]);
  } else if (/\bOpped|De-opped|Made .* a server operator|no longer a server operator/i.test(line)) {
    setTimeout(() => spielerAktualisieren(), 300);
  }
}

/** Spielerliste: aus join/left gepflegt, OP-Status aus ops.json. */
function spielerAktualisieren(dazu = null, weg = null) {
  if (!server) return;
  const namen = (server.online || []).filter(n => !weg || n.toLowerCase() !== weg.toLowerCase());
  if (dazu && !namen.some(n => n.toLowerCase() === dazu.toLowerCase())) namen.push(dazu);
  server.online = namen;
  const ops = opsListe(server.dir);
  const host = String(state.host || '').toLowerCase();
  publish({ players: namen.map(n => ({ name: n, op: ops.has(n.toLowerCase()), host: n.toLowerCase() === host })) });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server took too long to start. Look at the console for details.')), 6 * 60 * 1000);
    let lastError = '';
    const onLine = line => {
      if (/\bDone \([\d.,]+s\)!/.test(line)) { clearTimeout(timer); resolve(); }
      else if (/FAILED TO BIND TO PORT/i.test(line)) lastError = 'The server port is already in use.';
      else if (/session\.lock|already locked/i.test(line)) lastError = 'This world is open somewhere else. Close it in Minecraft first.';
      else if (/UnsupportedClassVersionError/i.test(line)) lastError = 'Java is too old for this server.';
      else if (/Preparing spawn area: (\d+)%/.test(line)) step('Preparing the world', Number(line.match(/(\d+)%/)[1]));
      else if (/World storage migration|Vanilla import/i.test(line)) step('Preparing your world for Paper (only the first time)');
      else if (/Loading \d+ plugins?|Enabling .* v/i.test(line)) step('Loading plugins');
    };
    child.lineListeners.push(onLine);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(lastError || `The server stopped while starting (code ${code}). Look at the console for details.`)); });
  });
}

// ---------------------------------------------------------------------------
// Tunnel fuer Freunde
// ---------------------------------------------------------------------------

async function tunnelOeffnen() {
  if (!server) return;
  const port = server.port;
  const merk = core.loadJson(tunnelFile(), {}) || {};
  let t = null;
  for (const wunsch of [merk.port || 0, 0]) {
    try {
      t = await bore.open(port, { wunschPort: wunsch, log: m => log(`Hosting: ${m}`, 'warn') });
      break;
    } catch (e) {
      log(`Hosting: bore.pub${wunsch ? ` (port ${wunsch})` : ''}: ${e.message}`, 'warn');
      if (!wunsch) t = null;
    }
  }
  if (!server || server.port !== port) { try { t?.close(); } catch (_) {} return; }
  if (!t) return false;
  ensureDir(hostRoot());
  core.writeJson(tunnelFile(), { port: t.remotePort });
  server.tunnel = t;
  publish({ address: t.address, network: 'bore' });
  log(`Hosting: friends can join with ${t.address}.`);
  t.on('close', grund => {
    if (!server || server.tunnel !== t || stopping) return;
    server.tunnel = null;
    log(`Hosting: connection to bore.pub ${grund} -- reconnecting.`, 'warn');
    publish({ network: 'reconnecting' });
    let versuch = 0;
    const wieder = async () => {
      if (!server || stopping) return;
      const ok = await tunnelOeffnen();
      if (ok === false && server && !stopping) setTimeout(wieder, Math.min(60000, 3000 * 2 ** versuch++));
    };
    setTimeout(wieder, 2000);
  });
  return true;
}

/** Port per UPnP im Router freigeben; Adresse fuer Freunde setzen (nur wenn bore nicht geht). */
async function openRouterPort(port) {
  step('Opening the port in your router');
  let pub = null, network = 'manual';
  try {
    const r = await Promise.race([upnp.open(port), new Promise((_, rej) => setTimeout(() => rej(new Error('The router did not answer.')), 9000))]);
    if (r.externalIp && !upnp.isPrivateIp(r.externalIp)) { pub = r.externalIp; network = 'upnp'; }
    else network = 'cgnat';
    if (r.lease && server) server.renewTimer = setInterval(() => upnp.open(port).catch(() => {}), (r.lease - 300) * 1000);
  } catch (e) { log(`Hosting: router port sharing failed: ${e.message}`, 'warn'); }
  if (!pub) pub = await publicIp();
  if (state.network !== 'bore') publish({ address: pub ? `${pub}${port === 25565 ? '' : `:${port}`}` : null, network });
}

// ---------------------------------------------------------------------------
// Starten / Stoppen
// ---------------------------------------------------------------------------

async function start({ version, world, acceptEula }) {
  if (state.status !== 'off') throw new Error('You are already hosting a world.');
  const v = instances.requireVersion(version);
  if (!safeDirName(world)) throw new Error('Invalid world.');
  const worldDir = path.join(savesRoot(v), world);
  if (!exists(path.join(worldDir, 'level.dat'))) throw new Error('This world no longer exists.');
  if (!acceptEula) throw new Error('Please accept the Minecraft EULA to host a world.');
  const account = accounts.current();
  if (!account) throw new Error('Sign in with your Microsoft account first.');
  const launch = require('./launch');
  if (launch.isLaunching()) throw new Error('A launch is already in progress.');
  if (launch.sessionList().some(s => s.accountId === accounts.idOf(account))) throw new Error('Close Minecraft first -- hosting starts it for you.');

  const ws = worldSettings(worldDir);
  const werte = einstellungen(v, world, worldDir);
  const uuid = dashed(account.uuid);
  konsole = [];
  state = {
    status: 'starting', version: v, world, worldName: ws.name, host: account.username, players: [],
    settings: werte, step: 'Backing up your world', percent: null, startedAt: Date.now(), restartNeeded: false
  };
  publish();

  try {
    try { await require('./media').backupWorld(v, world, 'before hosting'); }
    catch (e) { log(`Hosting: backup skipped: ${e.message}`, 'warn'); }

    const dir = serverDir(v);
    ensureDir(path.join(dir, 'plugins'));
    step('Downloading the server (Paper)');
    const jar = await ensurePaper(v, dir);
    step('Checking Java');
    const jre = await java.javaFor(v, settings.get().javaPath);
    const port = await pickPort();

    fs.writeFileSync(path.join(dir, 'eula.txt'), '# Accepted in the Vortex Client launcher (https://aka.ms/MinecraftEULA)\neula=true\n');
    writeProperties(dir, {
      'server-port': port, 'server-ip': '', 'max-players': Math.max(2, Math.min(50, Number(werte.maxPlayers) || 8)), 'online-mode': 'true',
      'level-name': world, motd: `${account.username}s Welt: ${ws.name}`.slice(0, 59),
      gamemode: werte.gamemode, difficulty: werte.difficulty, hardcore: String(ws.hardcore), pvp: String(werte.pvp !== false),
      'white-list': String(Boolean(werte.whitelist)), 'enforce-whitelist': String(Boolean(werte.whitelist)),
      'spawn-protection': 0, 'allow-flight': 'true', 'enable-status': 'true'
    });
    try { movePlayerOut(worldDir, uuid); } catch (e) { log(`Hosting: player data: ${e.message}`, 'warn'); }
    const vb = paperwelt.vorbereiten(worldDir, v, dir);

    step('Starting the server');
    const memory = os.totalmem() >= 12 * 1024 ** 3 ? 4096 : os.totalmem() >= 8 * 1024 ** 3 ? 2048 : 1024;
    const child = spawn(jre.binary, [
      `-Xmx${memory}M`, '-Xms512M', ...(jre.major >= 22 ? ['--enable-native-access=ALL-UNNAMED'] : []),
      // Backup ist gemacht -- Paper soll nicht 30 s vor der Weltuebernahme warten
      '-Dpaper.disableMigrationDelay=true', '-Dcom.mojang.eula.agree=true',
      '-jar', jar, '--nogui', '--universe', vb.universe, '--world', vb.world, '--port', String(port)
    ], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.lineListeners = [onServerLine];
    let buf = '';
    const feed = d => {
      buf += String(d);
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const roh of parts) {
        const l = roh.replace(/\x1b\[[0-9;]*m/g, '');
        if (l.trim()) for (const fn of child.lineListeners) { try { fn(l); } catch (_) {} }
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', e => log(`Hosting: ${e.message}`, 'error'));
    server = { child, port, version: v, world, worldDir, uuid, dir, sessionId: null, renewTimer: null, tunnel: null, online: [] };
    child.on('exit', code => {
      log(`Hosting: server stopped (code ${code}).`);
      if (server?.child === child && !stopping && !server.neustart && state.status === 'running') void cleanup('The server stopped unexpectedly. Look at the console for details.');
    });

    await waitForReady(child);
    nachStart(account.username, werte);

    const lan = lanAddress();
    publish({ port, lan: lan ? `${lan}:${port}` : null });
    step('Connecting to bore.pub (address for your friends)');
    if (!(await tunnelOeffnen())) await openRouterPort(port);

    step('Starting Minecraft');
    const r = await launch.start({ version: v, address: `127.0.0.1:${port}`, hostedWorld: ws.name });
    if (!server || server.child.exitCode !== null) throw new Error('The server stopped while Minecraft was starting.');
    server.sessionId = r.id;
    publish({ status: 'running', step: null, percent: null });
    notify('success', `Your world “${ws.name}” is online.`);
    if (!launch.sessionList().some(s => s.id === r.id)) void stop('host-closed');
    return state;
  } catch (e) {
    log(`Hosting failed: ${e.message}`, 'error');
    await stop('failed');
    publish({ status: 'off', error: e.message });
    throw e;
  }
}

/** Nach "Done": Hoster ist OP, Einstellungen anwenden, die nur per Befehl gehen. */
function nachStart(host, werte) {
  sendCommand(`op ${host}`);
  sendCommand(`difficulty ${werte.difficulty}`);
  sendCommand(`defaultgamemode ${werte.gamemode}`);
  sendCommand(`gamerule pvp ${werte.pvp !== false}`);
  if (werte.whitelist) {
    sendCommand('whitelist on');
    sendCommand(`whitelist add ${host}`);
    for (const n of werte.whitelistNames || []) if (safeName(n)) sendCommand(`whitelist add ${n}`);
  }
}

/** Server neu starten (z. B. fuer neue Plugins) -- Minecraft bleibt offen, man verbindet sich neu. */
async function restart() {
  if (state.status !== 'running' || !server) throw new Error('The server is not running.');
  const s = server;
  s.neustart = true;
  publish({ status: 'starting', step: 'Restarting the server', percent: null });
  await new Promise(resolve => {
    const hard = setTimeout(() => { try { s.child.kill(); } catch (_) {} }, 45000);
    s.child.once('exit', () => { clearTimeout(hard); resolve(); });
    if (!sendCommand('stop')) { try { s.child.kill(); } catch (_) {} }
  });
  try { paperwelt.nachbereiten(s.worldDir, s.version); } catch (e) { log(`Hosting: ${e.message}`, 'warn'); }
  const werte = state.settings || DEFAULTS;
  writeProperties(s.dir, {
    'max-players': Math.max(2, Math.min(50, Number(werte.maxPlayers) || 8)), gamemode: werte.gamemode,
    difficulty: werte.difficulty, pvp: String(werte.pvp !== false), 'white-list': String(Boolean(werte.whitelist)), 'enforce-whitelist': String(Boolean(werte.whitelist))
  });
  const vb = paperwelt.vorbereiten(s.worldDir, s.version, s.dir);
  const jre = await java.javaFor(s.version, settings.get().javaPath);
  const memory = os.totalmem() >= 12 * 1024 ** 3 ? 4096 : os.totalmem() >= 8 * 1024 ** 3 ? 2048 : 1024;
  const child = spawn(jre.binary, [
    `-Xmx${memory}M`, '-Xms512M', ...(jre.major >= 22 ? ['--enable-native-access=ALL-UNNAMED'] : []),
    '-Dpaper.disableMigrationDelay=true', '-jar', path.join(s.dir, 'paper.jar'), '--nogui', '--universe', vb.universe, '--world', vb.world, '--port', String(s.port)
  ], { cwd: s.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.lineListeners = [onServerLine];
  let buf = '';
  const feed = d => {
    buf += String(d);
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const roh of parts) { const l = roh.replace(/\x1b\[[0-9;]*m/g, ''); if (l.trim()) for (const fn of child.lineListeners) { try { fn(l); } catch (_) {} } }
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  s.child = child;
  s.neustart = false;
  s.online = [];
  child.on('exit', code => {
    log(`Hosting: server stopped (code ${code}).`);
    if (server?.child === child && !stopping && !server.neustart && state.status === 'running') void cleanup('The server stopped unexpectedly. Look at the console for details.');
  });
  try {
    await waitForReady(child);
  } catch (e) {
    await cleanup(e.message);
    throw e;
  }
  nachStart(state.host, werte);
  publish({ status: 'running', step: null, percent: null, players: [], restartNeeded: false });
  notify('success', 'The server is back online -- join it again from Multiplayer.');
  return state;
}

/** Server sauber beenden ("stop" speichert alles), notfalls hart. */
function stop(reason = 'user') {
  if (stopping) return stopping;
  if (!server) { if (state.status !== 'off') publish({ status: 'off', step: null }); return Promise.resolve(); }
  const s = server;
  publish({ status: 'stopping', step: 'Saving the world', percent: null });
  stopping = new Promise(resolve => {
    const done = () => { clearTimeout(hard); resolve(); };
    const hard = setTimeout(() => { log('Hosting: server did not stop in time -- ending it.', 'warn'); try { s.child.kill(); } catch (_) {} }, 45000);
    if (s.child.exitCode !== null) { done(); return; }
    s.child.once('exit', done);
    if (!sendCommand('stop')) { try { s.child.kill(); } catch (_) {} }
  }).then(() => cleanup(null, reason)).finally(() => { stopping = null; });
  return stopping;
}

async function cleanup(error, reason) {
  const s = server;
  if (!s) return;
  server = null;
  clearInterval(s.renewTimer);
  try { s.tunnel?.close(); } catch (_) {}
  if (s.port) await upnp.close(s.port).catch(() => {});
  try {
    const zurueck = paperwelt.nachbereiten(s.worldDir, s.version);
    if (zurueck.length) log(`Hosting: world data back for singleplayer (${zurueck.join(', ')}).`);
  } catch (e) { log(`Hosting: world data: ${e.message}`, 'error'); }
  try { movePlayerBack(s.worldDir, s.uuid); } catch (e) { log(`Hosting: player data: ${e.message}`, 'warn'); }
  const name = state.worldName;
  state = { status: 'off', error: error || null };
  publish();
  if (error) notify('error', error);
  else if (reason === 'host-closed') notify('info', `Minecraft was closed -- the server for “${name}” is off.`);
  else if (reason !== 'failed' && reason !== 'quit') notify('info', `The server for “${name}” is off.`);
}

/** Vom Launcher bei jeder Aenderung der laufenden Spiele aufgerufen. */
function onSessions(list) {
  if (!server?.sessionId || state.status !== 'running') return;
  if (!(list || []).some(s => s.id === server.sessionId)) void stop('host-closed');
}

// ---------------------------------------------------------------------------
// Einstellungen und Spieler (Launcher und Spiel)
// ---------------------------------------------------------------------------

/** Einstellungen aendern; laufend: sofort anwenden, soweit moeglich. */
function setSettings(version, world, patch) {
  const v = instances.requireVersion(version);
  if (!safeDirName(world)) throw new Error('Invalid world.');
  const alt = einstellungen(v, world, path.join(savesRoot(v), world));
  const neu = { ...alt };
  if (patch.gamemode !== undefined) { if (!GAMEMODES.includes(patch.gamemode)) throw new Error('Invalid game mode.'); neu.gamemode = patch.gamemode; }
  if (patch.difficulty !== undefined) { if (!DIFFICULTIES.includes(patch.difficulty)) throw new Error('Invalid difficulty.'); neu.difficulty = patch.difficulty; }
  if (patch.pvp !== undefined) neu.pvp = Boolean(patch.pvp);
  if (patch.cheats !== undefined) neu.cheats = Boolean(patch.cheats);
  if (patch.whitelist !== undefined) neu.whitelist = Boolean(patch.whitelist);
  if (patch.maxPlayers !== undefined) neu.maxPlayers = Math.max(2, Math.min(50, Math.round(Number(patch.maxPlayers) || 8)));
  speichereEinstellungen(v, world, neu);
  const laeuft = state.status === 'running' && state.version === v && state.world === world;
  if (laeuft) {
    const host = String(state.host || '').toLowerCase();
    const freunde = (server?.online || []).filter(n => n.toLowerCase() !== host);
    if (neu.gamemode !== alt.gamemode) { sendCommand(`defaultgamemode ${neu.gamemode}`); for (const n of freunde) sendCommand(`gamemode ${neu.gamemode} ${n}`); }
    if (neu.difficulty !== alt.difficulty) sendCommand(`difficulty ${neu.difficulty}`);
    if (neu.pvp !== alt.pvp) sendCommand(`gamerule pvp ${neu.pvp}`);
    if (neu.cheats !== alt.cheats) for (const n of freunde) sendCommand(`${neu.cheats ? 'op' : 'deop'} ${n}`);
    if (neu.whitelist !== alt.whitelist) {
      sendCommand(`whitelist ${neu.whitelist ? 'on' : 'off'}`);
      if (neu.whitelist) for (const n of [state.host, ...(server?.online || [])]) if (safeName(n)) sendCommand(`whitelist add ${n}`);
    }
    publish({ settings: neu, restartNeeded: state.restartNeeded || neu.maxPlayers !== alt.maxPlayers });
  }
  return { settings: neu };
}

function getSettings(version, world) {
  const v = instances.requireVersion(version);
  if (!safeDirName(world)) throw new Error('Invalid world.');
  return { settings: einstellungen(v, world, path.join(savesRoot(v), world)) };
}

/** Aktion fuer einen Spieler: kick, ban, pardon, op, deop, gamemode:<modus>, whitelist. */
function player(name, action) {
  if (state.status !== 'running') throw new Error('You are not hosting right now.');
  if (!safeName(name)) throw new Error('Invalid player name.');
  const host = name.toLowerCase() === String(state.host || '').toLowerCase();
  const a = String(action || '');
  if (host && ['kick', 'ban', 'deop'].includes(a)) throw new Error('That would be you.');
  if (a === 'kick') sendCommand(`kick ${name}`);
  else if (a === 'ban') sendCommand(`ban ${name}`);
  else if (a === 'pardon') sendCommand(`pardon ${name}`);
  else if (a === 'op') sendCommand(`op ${name}`);
  else if (a === 'deop') sendCommand(`deop ${name}`);
  else if (a === 'whitelist') sendCommand(`whitelist add ${name}`);
  else if (a.startsWith('gamemode:') && GAMEMODES.includes(a.slice(9))) sendCommand(`gamemode ${a.slice(9)} ${name}`);
  else throw new Error('Unknown action.');
  konsoleZeile(`> (${a} ${name})`, 'input');
  setTimeout(() => spielerAktualisieren(), 700);
  return {};
}

/** Gebannte Spieler (banned-players.json). */
function banned() {
  if (!server) return { banned: [] };
  try { return { banned: (JSON.parse(fs.readFileSync(path.join(server.dir, 'banned-players.json'), 'utf8')) || []).map(b => b.name).filter(safeName) }; }
  catch (_) { return { banned: [] }; }
}

// ---------------------------------------------------------------------------
// "Hosting Options" im Spiel (Vortex Client)
// ---------------------------------------------------------------------------

function schreibeIngame() {
  try {
    const dir = ingameDir();
    ensureDir(path.join(dir, 'inbox'));
    const s = state;
    const daten = s.status === 'off' ? { status: 'off' } : {
      status: s.status, world: s.worldName, version: s.version, address: s.address || null, lan: s.lan || null,
      network: s.network || null, host: s.host, players: s.players || [], settings: s.settings || null, restartNeeded: Boolean(s.restartNeeded)
    };
    const tmp = path.join(dir, 'state.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(daten));
    fs.renameSync(tmp, path.join(dir, 'state.json'));
  } catch (_) {}
}

/** Wuensche aus dem Spiel abarbeiten (alle 500 ms). */
function liesIngame() {
  const inbox = path.join(ingameDir(), 'inbox');
  let files = [];
  try { files = fs.readdirSync(inbox).filter(f => f.endsWith('.json')).sort(); } catch (_) { return; }
  for (const f of files) {
    const p = path.join(inbox, f);
    let msg = null;
    try { msg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    try { fs.rmSync(p, { force: true }); } catch (_) {}
    if (!msg || state.status !== 'running') continue;
    try {
      if (msg.type === 'settings' && msg.patch) setSettings(state.version, state.world, msg.patch);
      else if (msg.type === 'player') player(msg.name, msg.action);
      else if (msg.type === 'restart') void restart().catch(e => notify('error', e.message));
    } catch (e) { log(`Hosting (in game): ${e.message}`, 'warn'); }
  }
}
setInterval(liesIngame, 500).unref?.();

/** Plugins geaendert: laeuft der Server dieser Version, braucht es einen Neustart. */
function pluginsChanged(version) {
  if (server && state.version === version && state.status === 'running') publish({ restartNeeded: true });
}

/** Wird diese Welt gerade gehostet? (Backup zurueckspielen/Loeschen verbieten) */
const isHosted = (version, world) => Boolean(server) && state.version === version && state.world === world;

module.exports = {
  start, stop, restart, command, sendCommand, onSessions, setSettings, getSettings, player, banned, ingameDir, pluginsChanged, isHosted,
  console: () => ({ lines: konsole }), state: () => state, active: () => Boolean(server)
};
