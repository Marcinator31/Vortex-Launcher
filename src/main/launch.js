'use strict';
/**
 * Minecraft starten (minecraft-launcher-core) und laufende Sitzungen verwalten.
 *
 * BEHOBEN gegenueber dem alten Launcher:
 *  - Scheiterte der Start, gab MCLC still "null" zurueck und schrieb den
 *    Grund nur ins Debug-Log -- in der Oberflaeche passierte einfach nichts.
 *    Jetzt wird der Grund aufgefangen und angezeigt.
 *  - Arbeitsspeicher, Fenstergroesse, Vollbild und JVM-Argumente kommen aus
 *    den Einstellungen (vorher fest 2-4 GB).
 *  - Absturz-Erkennung: Beendet sich Minecraft mit Fehlercode, meldet der
 *    Launcher das und bietet Log und Crash-Reports an.
 *
 * Zweites Konto parallel: laeuft dieselbe Version schon, bekommt das zweite
 * Konto eine Kopie des Spielordners (Minecraft sperrt den Ordner sonst).
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { paths, ensureDir, exists, log, notify, send, getMainWindow, safeFileName, appendFileLog } = require('./core');
const settings = require('./settings');
const instances = require('./instances');
const accounts = require('./accounts');
const servers = require('./servers');
const java = require('./java');
const vortexfiles = require('./vortexfiles');
const modrinth = require('./modrinth');
const media = require('./media');
const crash = require('./crash');
const discord = require('./discord');

let lastCrash = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sessions = new Map();     // id -> { id, version, username, accountId, child, startedAt, gameDirectory, stopped }
let launching = false;

function sessionList() {
  return [...sessions.values()].map(s => ({ id: s.id, version: s.version, username: s.username, accountId: s.accountId, startedAt: s.startedAt, running: s.running }));
}
function publishSessions() { send('sessions', sessionList()); }

function progress(stage, label, percent = null) { send('progress', { stage, label, percent }); }

/** "a b 'c d'" -> ['a','b','c d']; -Xmx/-Xms werden ignoriert (Einstellung). */
function parseArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out.filter(a => !/^-Xm[sx]/i.test(a)).slice(0, 60);
}

function copyDir(src, dst) { if (exists(src)) fs.cpSync(src, dst, { recursive: true, force: true, dereference: true }); }

function parallelDirectory(version, account) {
  const base = paths.instanceRoot(version);
  const target = path.join(paths.instancesRoot, `${version}-parallel-${safeFileName(accounts.idOf(account)).slice(0, 40)}`);
  ensureDir(target);
  for (const d of ['mods', 'config', 'resourcepacks', 'shaderpacks']) copyDir(path.join(base, d), path.join(target, d));
  for (const f of ['options.txt', 'servers.dat']) {
    if (exists(path.join(base, f))) fs.copyFileSync(path.join(base, f), path.join(target, f));
  }
  return target;
}

const STAGES = { assets: 'Downloading assets', natives: 'Preparing natives', classes: 'Downloading libraries', 'assets-copy': 'Copying assets' };

async function start({ version, serverId = null }) {
  if (launching) throw new Error('A launch is already in progress.');
  const account = accounts.current();
  if (!account) throw new Error('Sign in with your Microsoft account first.');
  const acId = accounts.idOf(account);
  if ([...sessions.values()].some(s => s.accountId === acId)) {
    throw new Error(`${account.username} is already playing. Switch to another account to play in parallel.`);
  }
  const v = instances.requireVersion(version);
  const cfg = settings.get();
  const server = serverId ? servers.byId(serverId) : null;

  launching = true;
  try {
    progress('auth', 'Checking your account', null);
    const authorization = await accounts.freshAuth(account);
    if (!authorization) throw new Error('Sign in again to play.');

    // Neueste Vortex-Dateien aus dem Admin-Bereich holen (hoechstens ~8 s warten)
    if (instances.bundledVersions().includes(v)) {
      progress('prepare', 'Checking for Vortex updates', null);
      const r = await Promise.race([vortexfiles.refresh(ver => instances.packagedEntries(ver), { versionsOnly: [v] }), sleep(8000).then(() => null)]);
      for (const u of r?.updated || []) notify('success', `${u.name} ${u.newVersion} for Minecraft ${u.version} downloaded.`);
    }

    progress('prepare', `Preparing Minecraft ${v}`, null);
    const prep = await instances.prepare(v);

    // Neue Versionen aus dem Admin-Bereich bringen evtl. keine Fabric API mit
    if (prep.vortex && !prep.hasFabricApi) {
      progress('prepare', 'Installing Fabric API', null);
      try { await modrinth.installMod('fabric-api', v); } catch (e) { log(`Fabric API could not be installed: ${e.message}`, 'warn'); }
    }

    // Mod-Updates automatisch einspielen (Einstellung)
    if (cfg.autoUpdateMods) {
      progress('prepare', 'Updating mods', null);
      try {
        const r = await modrinth.applyUpdates(v);
        if (r.updated.length) notify('success', `${r.updated.length} mod(s) updated.`);
      } catch (e) { log(`Mod updates skipped: ${e.message}`, 'debug'); }
    }

    // Welten sichern, wenn sich Vortex-Dateien oder Mods geaendert haben
    const changed = instances.consumeChanged(v) || prep.copied > 0;
    if (cfg.autoBackup && changed && ![...sessions.values()].some(x => x.version === v)) {
      progress('prepare', 'Backing up your worlds', null);
      try { const n = await media.backupAll(v, 'before update'); if (n) log(`${n} world(s) backed up before the update.`); }
      catch (e) { log(`Backup skipped: ${e.message}`, 'warn'); }
    }

    progress('java', 'Checking Java', null);
    const jre = await java.javaFor(v, cfg.javaPath);

    const sameVersionRunning = [...sessions.values()].some(s => s.version === v);
    const gameDirectory = sameVersionRunning ? parallelDirectory(v, account) : paths.instanceRoot(v);

    const client = new Client();
    let lastError = null;
    let sawGameOutput = false;
    client.on('debug', msg => {
      const text = String(msg);
      if (/Failed to start due to|Couldn't start Minecraft|Failed to download|Failed to find version/i.test(text)) lastError = text.replace(/^\[MCLC\]:\s*/, '');
      if (/Launching with arguments/.test(text)) { appendFileLog(paths.launchLog, 'MCLC launch arguments written (hidden in console)'); return; }
      log(text, 'debug');
    });
    const output = [];                    // letzte Zeilen fuer die Absturz-Analyse
    client.on('data', data => {
      if (!sawGameOutput) { sawGameOutput = true; progress('running', 'Minecraft is running', 100); }
      for (const line of String(data).split(/\r?\n/)) {
        if (!line.trim()) continue;
        output.push(line);
        if (output.length > 600) output.splice(0, output.length - 600);
        log(line, /\b(ERROR|FATAL|Exception)\b/.test(line) ? 'error' : 'game');
      }
    });
    client.on('progress', e => {
      if (!e || !e.total) return;
      progress('download', STAGES[e.type] || 'Downloading files', Math.min(100, Math.floor(e.task / e.total * 100)));
    });
    client.on('download-status', e => {
      if (e && e.type === 'version-jar' && e.total) progress('download', 'Downloading Minecraft', Math.min(100, Math.floor(e.current / e.total * 100)));
    });

    const options = {
      authorization,
      root: paths.instanceRoot(v),
      version: { number: v, type: 'release', custom: prep.profileId },
      memory: { max: cfg.memoryMax, min: Math.min(cfg.memoryMin, cfg.memoryMax) },
      javaPath: jre.binary,
      overrides: { gameDirectory, detached: true, maxSockets: 8 },
      window: cfg.fullscreen ? { fullscreen: true } : { width: cfg.width, height: cfg.height },
      customArgs: [
        ...(jre.major >= 22 ? ['--enable-native-access=ALL-UNNAMED'] : []),
        ...parseArgs(cfg.jvmArgs)
      ]
    };
    if (server) options.quickPlay = { type: 'multiplayer', identifier: server.address };

    progress('download', 'Checking game files', null);
    log(`Launching Minecraft ${v} (${prep.profileId}) as ${account.username} with ${cfg.memoryMax} MB RAM.`);
    const child = await client.launch(options);
    if (!child) throw new Error(lastError || 'Minecraft could not be started. Open the console for details.');

    const id = `${acId}:${Date.now()}`;
    const launchedAt = Date.now();
    const session = { id, version: v, username: account.username, accountId: acId, child, startedAt: launchedAt, gameDirectory, stopped: false, running: true };
    const info = instances.bundleInfo(v);
    discord.update({ state: 'playing', version: v, client: info.clientVersion, server: server?.name, since: launchedAt });
    sessions.set(id, session);
    instances.markPlayed(v);
    publishSessions();
    progress('started', server ? `Joining ${server.name}` : 'Minecraft is starting', 100);
    notify('success', server ? `Minecraft ${v} is starting and joins ${server.name}.` : `Minecraft ${v} is starting.`);

    const win = getMainWindow();
    if (win) {
      if (cfg.afterLaunch === 'minimize') setTimeout(() => { try { win.minimize(); } catch (_) {} }, 1500);
      if (cfg.afterLaunch === 'hide') setTimeout(() => { try { win.hide(); } catch (_) {} }, 1500);
    }

    child.on('close', code => {
      sessions.delete(id);
      publishSessions();
      const crashed = code !== 0 && code !== null && !session.stopped;
      if (crashed) {
        appendFileLog(paths.crashLog, `Minecraft ${v} (${account.username}) exited with code ${code}`);
        let analysis = null;
        try { analysis = crash.analyze({ version: v, gameDirectory, startedAt: launchedAt, code, output }); }
        catch (e) { log(`Crash analysis failed: ${e.message}`, 'debug'); }
        lastCrash = analysis;
        send('crash', { version: v, code, crashReports: exists(paths.crashReportsRoot(v)), analysis });
      } else {
        log(`Minecraft ${v} (${account.username}) closed.`);
      }
      // Launcher wieder zeigen, wenn nichts mehr laeuft
      const w = getMainWindow();
      if (w && sessions.size === 0 && (cfg.afterLaunch !== 'keep' || crashed)) {
        try { w.show(); if (w.isMinimized()) w.restore(); w.focus(); } catch (_) {}
      }
      progress('idle', '', null);
      if (!sessions.size) discord.update({ state: 'launcher' });
    });
    return { id, version: v };
  } catch (error) {
    progress('idle', '', null);
    throw error;
  } finally {
    launching = false;
  }
}

function stop(id) {
  const s = sessions.get(String(id || ''));
  if (!s) return false;
  s.stopped = true;
  try { s.child.kill(); } catch (_) {}
  log(`Minecraft ${s.version} (${s.username}) was stopped from the launcher.`);
  return true;
}

function isLaunching() { return launching; }

module.exports = { start, stop, sessionList, isLaunching, lastCrash: () => lastCrash };
