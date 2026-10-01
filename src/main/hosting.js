'use strict';
/**
 * Welt hosten: eine Einzelspieler-Welt fuer bis zu 4 Freunde oeffnen.
 *
 * Der Launcher startet dafuer einen echten Minecraft-Server (Vanilla, von
 * Mojang) direkt auf der Welt im saves-Ordner -- nichts wird kopiert. Dann
 * startet er Minecraft und verbindet den Hoster selbst. Schliesst der Hoster
 * Minecraft, faehrt der Server herunter (speichert vorher alles).
 *
 *   - Platz fuer den Hoster + 4 Freunde (max-players=5).
 *   - online-mode: nur echte Minecraft-Konten.
 *   - Schwierigkeit, Spielmodus und Hardcore kommen aus der Welt.
 *   - Cheats an in der Welt -> der Hoster ist Operator.
 *   - Vor dem Start wird die Welt gesichert (Backup).
 *   - Freunde kommen ueber e4mc rein (Mod auf dem Server, kostenloser
 *     Vermittlungsdienst): Adresse wie abc.e4mc.link, ohne Portfreigabe und
 *     ohne Konto -- klappt auch hinter Routern ohne UPnP. Faellt e4mc aus,
 *     wird der Router-Port per UPnP freigegeben, wenn der Router das kann.
 *
 * Inventar & Position des Hosters: Bis 1.21 liegen sie in level.dat
 * ("Player"), ein Server liest aber playerdata/<uuid>.dat. Deshalb werden
 * sie vor dem Start dorthin uebertragen; der Server entfernt "Player" beim
 * Speichern aus level.dat, danach liest auch der Einzelspieler die Datei.
 * Ab 26.x liegen die Daten schon in players/data/<uuid>.dat.
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

const MAX_FRIENDS = 4;
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
// Mods auf dem Server -- nur diese zwei (Modrinth-Projekt-IDs). e4mc braucht Fabric API.
const SERVER_MODS = [{ id: 'P7dR8mSH', name: 'Fabric API' }, { id: 'qANg5Jrr', name: 'e4mc' }];
const hostingRoot = v => path.join(paths.dataRoot, 'hosting', v);
const savesRoot = v => path.join(paths.instanceRoot(v), 'saves');
const safeDirName = n => typeof n === 'string' && n && n === path.basename(n) && !n.startsWith('.') && !/[<>:"|?*]/.test(n);
const dashed = u => { const h = String(u || '').replace(/-/g, '').toLowerCase(); return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null; };

let state = { status: 'off' };
let server = null;           // { child, port, version, world, sessionId, renewTimer }
let stopping = null;         // Promise, solange der Server herunterfaehrt

function publish(patch) {
  if (patch) state = { ...state, ...patch };
  send('hosting', state);
}
const step = (label, percent = null) => publish({ step: label, percent });

// ---------------------------------------------------------------------------
// Server-Jar von Mojang
// ---------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Mojang could not be reached (${res.status}).`);
  return res.json();
}

/** Versions-JSON: erst die von Minecraft schon geladene, sonst von Mojang. */
async function versionJson(v) {
  const local = path.join(paths.instanceRoot(v), 'versions', v, `${v}.json`);
  const j = core.loadJson(local, null);
  if (j?.downloads?.server?.url) return j;
  const manifest = await getJson(MANIFEST);
  const entry = (manifest.versions || []).find(x => x.id === v);
  if (!entry) throw new Error(`Mojang has no server for Minecraft ${v}.`);
  return getJson(entry.url);
}

const sha1Of = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

async function ensureServerJar(v) {
  const dir = hostingRoot(v);
  ensureDir(dir);
  const jar = path.join(dir, 'server.jar');
  const metaFile = path.join(dir, 'server-jar.json');
  const meta = core.loadJson(metaFile, null);
  if (exists(jar) && meta?.sha1) {
    try { if (sha1Of(jar) === meta.sha1) return jar; } catch (_) {}
  }
  step('Downloading the Minecraft server', 0);
  const info = (await versionJson(v)).downloads?.server;
  if (!info?.url) throw new Error(`Mojang has no server for Minecraft ${v}.`);
  if (exists(jar) && sha1Of(jar) === info.sha1) { core.writeJson(metaFile, { sha1: info.sha1 }); return jar; }
  const res = await fetch(info.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`The Minecraft server could not be downloaded (${res.status}).`);
  const total = Number(info.size) || Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0, lastPct = -1;
  for await (const c of res.body) {
    chunks.push(Buffer.from(c));
    got += c.length;
    const pct = total ? Math.floor(got / total * 100) : null;
    if (pct !== lastPct) { lastPct = pct; step('Downloading the Minecraft server', pct); }
  }
  const buf = Buffer.concat(chunks);
  const sum = crypto.createHash('sha1').update(buf).digest('hex');
  if (info.sha1 && sum !== info.sha1) throw new Error('The Minecraft server download is damaged. Try again.');
  const tmp = `${jar}.download`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, jar);
  core.writeJson(metaFile, { sha1: sum });
  log(`Minecraft server ${v} downloaded (${Math.round(buf.length / 1048576)} MB).`);
  return jar;
}

// ---------------------------------------------------------------------------
// Fabric-Server mit e4mc (Verbindung fuer Freunde ohne Portfreigabe)
// ---------------------------------------------------------------------------

async function downloadTo(url, file, sha1 = null) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error(`Download is damaged: ${path.basename(file)}`);
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`Not a jar file: ${path.basename(file)}`);
  const tmp = `${file}.download`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

/** Neueste Fabric-Fassung einer Mod fuer diese Minecraft-Version (Modrinth). */
async function modrinthFile(projectId, v) {
  const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([v]))}`;
  const list = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?${q}`);
  const ver = (list || []).find(x => x.version_type === 'release') || (list || [])[0];
  const f = ver && (ver.files.find(x => x.primary) || ver.files[0]);
  if (!f) return null;
  return { url: f.url, sha1: f.hashes?.sha1 || null, filename: f.filename };
}

/**
 * Fabric-Server-Starter + mods/ (Fabric API, e4mc) im Server-Ordner.
 * Der Starter benutzt die server.jar von ensureServerJar(). Ohne Netz geht
 * es mit dem weiter, was schon da ist.
 */
async function ensureFabricServer(v, dir) {
  const launcher = path.join(dir, 'fabric-server-launch.jar');
  const modsDir = path.join(dir, 'mods');
  const metaFile = path.join(dir, 'fabric-server.json');
  const meta = core.loadJson(metaFile, {}) || {};
  ensureDir(modsDir);
  try {
    const loader = (await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(v)}`))[0]?.loader?.version;
    const installer = ((await getJson(`${FABRIC_META}/versions/installer`)) || []).find(x => x.stable)?.version;
    if (!loader || !installer) throw new Error(`Fabric has no server for Minecraft ${v}.`);
    if (!exists(launcher) || meta.loader !== loader || meta.installer !== installer) {
      await downloadTo(`${FABRIC_META}/versions/loader/${encodeURIComponent(v)}/${loader}/${installer}/server/jar`, launcher);
      meta.loader = loader; meta.installer = installer;
    }
    const wanted = [];
    for (const m of SERVER_MODS) {
      const f = await modrinthFile(m.id, v);
      if (!f) throw new Error(`${m.name} is not available for Minecraft ${v}.`);
      if (!/^[\w.+-]+\.jar$/i.test(f.filename)) throw new Error(`Unexpected file name from Modrinth: ${f.filename}`);
      wanted.push(f.filename);
      if (!exists(path.join(modsDir, f.filename))) await downloadTo(f.url, path.join(modsDir, f.filename), f.sha1);
    }
    meta.mods = wanted;
    core.writeJson(metaFile, meta);
  } catch (e) {
    // Offline? Dann mit dem letzten Stand weiter, falls er komplett ist.
    if (!(exists(launcher) && meta.mods?.length && meta.mods.every(f => exists(path.join(modsDir, f))))) throw e;
    log(`Hosting: using the existing e4mc setup (${e.message}).`, 'warn');
  }
  // Hilfs-Mod: ohne sie stuerzt der Server ab, sobald jemand joint (e4mc-Fehler, siehe hosting-fix/)
  const FIX = 'vortex-hosting-fix.jar';
  fs.copyFileSync(path.join(paths.assetsRoot(), 'hosting', FIX).replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), path.join(modsDir, FIX));
  // Alte Fassungen und fremde Jars raus -- auf dem Server laufen nur diese Mods.
  const keep = [...meta.mods, FIX];
  for (const f of fs.readdirSync(modsDir)) {
    if (/\.jar$/i.test(f) && !keep.includes(f)) fs.rmSync(path.join(modsDir, f), { force: true });
  }
  fs.writeFileSync(path.join(dir, 'fabric-server-launcher.properties'), 'serverJar=server.jar\n');
  return launcher;
}

// ---------------------------------------------------------------------------
// Welt lesen / vorbereiten
// ---------------------------------------------------------------------------

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];

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

/** Bis 1.21: Inventar & Position des Hosters aus level.dat fuer den Server bereitlegen. */
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

/**
 * Nach dem Hosten: Hat level.dat noch einen (jetzt alten) "Player", wird er
 * durch den Stand vom Server ersetzt -- sonst stuende man im Einzelspieler
 * wieder dort, wo man vor dem Hosten war.
 */
function movePlayerBack(worldDir, uuid) {
  if (!uuid) return;
  const src = path.join(worldDir, 'playerdata', `${uuid}.dat`);
  const file = path.join(worldDir, 'level.dat');
  if (!exists(src) || !exists(file)) return;
  const doc = nbt.readGz(file);
  const data = nbt.child(doc.root, 'Data');
  if (!nbt.child(data, 'Player')) return;
  const fresh = nbt.readGz(src).root;
  data.value.set('Player', fresh);
  const tmp = `${file}.vortex-tmp`;
  fs.writeFileSync(tmp, nbt.toGz(doc));
  fs.renameSync(tmp, file);
  log('Hosting: your inventory and position from the server are back in singleplayer.');
}

/** server.properties: unsere Werte setzen, den Rest (vom Server) behalten. */
function writeProperties(dir, values) {
  const file = path.join(dir, 'server.properties');
  const lines = exists(file) ? fs.readFileSync(file, 'latin1').split(/\r?\n/) : ['#Minecraft server properties'];
  const left = new Map(Object.entries(values));
  // Nicht-ASCII als \uXXXX -- so liest Java es in jeder Version richtig.
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

// ---------------------------------------------------------------------------
// Starten / Stoppen
// ---------------------------------------------------------------------------

function sendCommand(cmd) {
  if (!server?.child?.stdin?.writable) return false;
  server.child.stdin.write(`${cmd}\n`);
  return true;
}

function onServerLine(line) {
  log(`[Server] ${line}`, /\b(ERROR|FATAL|Exception)\b/.test(line) ? 'error' : 'game');
  // e4mc meldet die Adresse fuer Freunde (kann auch spaeter neu kommen)
  const domain = line.match(/Domain assigned: ([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  if (domain) { publish({ address: domain[1].toLowerCase(), network: 'e4mc' }); return; }
  const join = line.match(/]: ([A-Za-z0-9_]{1,16}) joined the game\s*$/);
  const left = line.match(/]: ([A-Za-z0-9_]{1,16}) left the game\s*$/);
  if (join) {
    const players = [...new Set([...(state.players || []), join[1]])];
    publish({ players });
    if (join[1].toLowerCase() !== String(state.host || '').toLowerCase()) notify('success', `${join[1]} joined your world.`);
  } else if (left) {
    publish({ players: (state.players || []).filter(p => p !== left[1]) });
    if (left[1].toLowerCase() !== String(state.host || '').toLowerCase()) notify('info', `${left[1]} left your world.`);
  }
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server took too long to start. Open the console for details.')), 5 * 60 * 1000);
    let lastError = '';
    const onLine = line => {
      if (/\bDone \([\d.,]+s\)!/.test(line)) { clearTimeout(timer); resolve(); }
      else if (/FAILED TO BIND TO PORT/i.test(line)) lastError = 'The server port is already in use.';
      else if (/session\.lock|already locked/i.test(line)) lastError = 'This world is open somewhere else. Close it in Minecraft first.';
      else if (/Preparing spawn area: (\d+)%/.test(line)) step('Preparing the world', Number(line.match(/(\d+)%/)[1]));
    };
    child.lineListeners.push(onLine);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(lastError || `The server stopped while starting (code ${code}). Open the console for details.`)); });
  });
}

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
  const uuid = dashed(account.uuid);
  state = { status: 'starting', version: v, world, worldName: ws.name, host: account.username, players: [], maxFriends: MAX_FRIENDS, step: 'Backing up your world', percent: null, startedAt: Date.now() };
  publish();

  try {
    try { await require('./media').backupWorld(v, world, 'before hosting'); }
    catch (e) { log(`Hosting: backup skipped: ${e.message}`, 'warn'); }

    const dir = hostingRoot(v);
    const jar = await ensureServerJar(v);
    let launchJar = jar, tunnel = true;
    try { step('Preparing the connection for your friends'); launchJar = await ensureFabricServer(v, dir); }
    catch (e) { tunnel = false; log(`Hosting: e4mc is not available, starting without it: ${e.message}`, 'warn'); }
    step('Checking Java');
    const jre = await java.javaFor(v, settings.get().javaPath);

    const port = await pickPort();
    // Der Server laeuft im Launcher-Ordner, die Welt bleibt im saves-Ordner.
    fs.writeFileSync(path.join(dir, 'eula.txt'), '# Accepted in the Vortex Client launcher (https://aka.ms/MinecraftEULA)\neula=true\n');
    fs.writeFileSync(path.join(dir, 'ops.json'), '[]');
    writeProperties(dir, {
      'server-port': port, 'server-ip': '', 'max-players': MAX_FRIENDS + 1, 'online-mode': 'true',
      'level-name': world, motd: `${account.username}s Welt: ${ws.name}`.slice(0, 59),
      gamemode: ws.gamemode, difficulty: ws.difficulty, hardcore: String(ws.hardcore),
      'spawn-protection': 0, 'white-list': 'false', 'allow-flight': 'true', 'enable-status': 'true'
    });
    try { movePlayerOut(worldDir, uuid); } catch (e) { log(`Hosting: player data: ${e.message}`, 'warn'); }

    step('Starting the server');
    const memory = os.totalmem() >= 12 * 1024 ** 3 ? 3072 : os.totalmem() >= 8 * 1024 ** 3 ? 2048 : 1024;
    const child = spawn(jre.binary, [
      `-Xmx${memory}M`, '-Xms512M', ...(jre.major >= 22 ? ['--enable-native-access=ALL-UNNAMED'] : []),
      '-jar', launchJar, '--nogui', '--universe', savesRoot(v), '--world', world, '--port', String(port)
    ], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.lineListeners = [onServerLine];
    let buf = '';
    const feed = d => {
      buf += String(d);
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const l of parts) if (l.trim()) for (const fn of child.lineListeners) { try { fn(l); } catch (_) {} }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', e => log(`Hosting: ${e.message}`, 'error'));
    server = { child, port, version: v, world, worldDir, uuid, sessionId: null, renewTimer: null };
    child.on('exit', code => {
      log(`Hosting: server stopped (code ${code}).`);
      // Beim Stoppen raeumt stop() auf, beim Starten der catch-Zweig von start().
      if (server?.child === child && !stopping && state.status === 'running') void cleanup('The server stopped unexpectedly. Open the console for details.');
    });

    await waitForReady(child);
    if (ws.cheats) sendCommand(`op ${account.username}`);

    const lan = lanAddress();
    publish({ port, lan: lan ? `${lan}:${port}` : null });
    if (tunnel && state.network !== 'e4mc') {
      step('Connecting to e4mc');
      const t0 = Date.now();
      while (state.network !== 'e4mc' && server?.child.exitCode === null && Date.now() - t0 < 25000) await new Promise(r => setTimeout(r, 250));
      if (state.network !== 'e4mc') log('Hosting: e4mc did not send an address -- trying the router instead.', 'warn');
    }
    // Ohne e4mc: Port im Router freigeben (UPnP), sonst bleibt nur die manuelle Freigabe.
    if (state.network !== 'e4mc') await openRouterPort(port);

    step('Starting Minecraft');
    const r = await launch.start({ version: v, address: `127.0.0.1:${port}`, hostedWorld: ws.name });
    if (!server || server.child.exitCode !== null) throw new Error('The server stopped while Minecraft was starting.');
    server.sessionId = r.id;
    publish({ status: 'running', step: null, percent: null });
    notify('success', `Your world “${ws.name}” is open for up to ${MAX_FRIENDS} friends.`);
    // Minecraft schon wieder zu (z. B. sofort abgestuerzt)? Dann gleich aus.
    if (!launch.sessionList().some(s => s.id === r.id)) void stop('host-closed');
    return state;
  } catch (e) {
    log(`Hosting failed: ${e.message}`, 'error');
    await stop('failed');
    publish({ status: 'off', error: e.message });
    throw e;
  }
}

/** Port per UPnP im Router freigeben; Adresse fuer Freunde setzen. */
async function openRouterPort(port) {
  step('Opening the port in your router');
  let pub = null, network = 'manual';
  try {
    const r = await Promise.race([upnp.open(port), new Promise((_, rej) => setTimeout(() => rej(new Error('The router did not answer.')), 9000))]);
    if (r.externalIp && !upnp.isPrivateIp(r.externalIp)) { pub = r.externalIp; network = 'upnp'; }
    else network = 'cgnat';
    if (r.lease && server) server.renewTimer = setInterval(() => upnp.open(port).catch(() => {}), (r.lease - 300) * 1000);
    log(`Hosting: port ${port} opened in the router${r.externalIp ? ` (${r.externalIp})` : ''}.`);
  } catch (e) { log(`Hosting: router port sharing failed: ${e.message}`, 'warn'); }
  // cgnat: der Router hat selbst keine oeffentliche IP (Anbieter teilt sie
  // oder zweiter Router davor) -- von aussen kommt dann niemand durch.
  if (!pub) pub = await publicIp();
  // e4mc kann sich in der Zwischenzeit doch noch gemeldet haben
  if (state.network !== 'e4mc') publish({ address: pub ? `${pub}${port === 25565 ? '' : `:${port}`}` : null, network });
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
  if (s.port) await upnp.close(s.port).catch(() => {});
  try { movePlayerBack(s.worldDir, s.uuid); } catch (e) { log(`Hosting: player data: ${e.message}`, 'warn'); }
  const name = state.worldName;
  state = { status: 'off', error: error || null };
  publish();
  if (error) notify('error', error);
  else if (reason === 'host-closed') notify('info', `Minecraft was closed -- the server for “${name}” is off.`);
  else if (reason !== 'failed' && reason !== 'quit') notify('info', `The server for “${name}” is off.`);
  // Spielt der Hoster noch (Server ueber den Launcher gestoppt)? Er fliegt raus -- das ist so gewollt.
}

/** Vom Launcher bei jeder Aenderung der laufenden Spiele aufgerufen. */
function onSessions(list) {
  if (!server?.sessionId || state.status !== 'running') return;
  if (!(list || []).some(s => s.id === server.sessionId)) void stop('host-closed');
}

function kick(name) {
  if (state.status !== 'running') throw new Error('You are not hosting right now.');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(String(name || ''))) throw new Error('Invalid player name.');
  sendCommand(`kick ${name}`);
  return {};
}

module.exports = { start, stop, kick, sendCommand, onSessions, state: () => state, active: () => Boolean(server), MAX_FRIENDS };
