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
const core = require('./core');
const { paths, ensureDir, exists, log, notify, send, getMainWindow, safeFileName, appendFileLog } = core;
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
const preflight = require('./preflight');

let lastCrash = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const sessions = new Map();     // id -> { id, version, username, accountId, child, startedAt, gameDirectory, stopped }
let launching = false;

function sessionList() {
  return [...sessions.values()].map(s => ({ id: s.id, version: s.version, username: s.username, accountId: s.accountId, startedAt: s.startedAt, running: s.running }));
}
function publishSessions() {
  send('sessions', sessionList());
  try { require('./friends').onSessions(sessionList()); } catch (_) {}
  try { require('./hosting').onSessions(sessionList()); } catch (_) {}
}

/**
 * Minecraft zu, Java laeuft weiter? Alle 20 s nachsehen: Hat ein laufendes
 * Spiel dreimal hintereinander KEIN Fenster mehr, ist es haengengeblieben --
 * dann beenden. Sonst haelt es die Mod-Dateien fest, und der Launcher zeigt
 * das Spiel weiter als "laeuft" an.
 */
const ohneFenster = new Map();   // pid -> Anzahl Pruefungen ohne Fenster
setInterval(async () => {
  if (process.platform !== 'win32') return;
  const laufend = [...sessions.values()].filter(x => x.running && x.child && x.child.pid && Date.now() - x.startedAt > 90000);
  if (!laufend.length) { ohneFenster.clear(); return; }
  let procs;
  try { procs = await require('./javaprocs').javaProcesses(); } catch (_) { return; }
  for (const x of laufend) {
    const p = procs.find(q => q.pid === x.child.pid);
    if (!p) continue;
    const n = p.window ? 0 : (ohneFenster.get(p.pid) || 0) + 1;
    ohneFenster.set(p.pid, n);
    if (n >= 3) {
      log(`Minecraft ${x.version} was closed but Java kept running in the background (PID ${p.pid}) -- ending it.`);
      try { process.kill(p.pid); } catch (_) { require('child_process').execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {}); }
      ohneFenster.delete(p.pid);
    }
  }
}, 20000).unref?.();

function friendsUrl() { try { return require('./friends').gameUrl(); } catch (_) { return ''; } }

function progress(stage, label, percent = null) { send('progress', { stage, label, percent }); }

// ---------------------------------------------------------------------------
// Ladefortschritt nach dem Start (2.4.0)
// ---------------------------------------------------------------------------
//
// Ab der ersten Zeile des Spiels bis zum Titelbildschirm (bzw. bis zum Server)
// vergehen oft 20-60 Sekunden. Die Zeilen im Log verraten, wo das Spiel
// gerade steht. Dazu die Dauer der letzten Starts dieser Version: daraus wird
// ein gleichmaessig laufender Balken, der nie rueckwaerts springt.

const PHASEN = [
  { re: /Loading Minecraft .* with Fabric Loader/i, label: 'Fabric is starting', pct: 8 },
  { re: /Loading \d+ mods?:/i, label: 'Loading mods', pct: 15, mods: true },
  { re: /SpongePowered MIXIN/i, label: 'Preparing mods', pct: 22 },
  { re: /Setting user:|Backend library: LWJGL/i, label: 'Opening the window', pct: 35 },
  { re: /Reloading ResourceManager/i, label: 'Loading resources', pct: 45 },
  { re: /Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/i, label: 'Loading textures', pct: 65 },
  { re: /Sound engine started|OpenAL initialized/i, label: 'Starting sound', pct: 82, fastFertig: true },
  { re: /Created: \d+x\d+x\d+ minecraft:textures\/atlas\/(gui|particles)/i, label: 'Almost there', pct: 88 },
  { re: /Connecting to [^,]+, ?\d+/i, label: 'Connecting to the server', pct: 92, server: true },
  { re: /Loaded \d+ advancements|\[CHAT\]|Joining world|Started \d+ worker threads/i, label: 'In the world', pct: 100, fertig: true }
];
const startzeitenFile = () => path.join(paths.dataRoot, 'startup-times.json');

function ladeBeobachter(version, mitServer) {
  const zeiten = core.loadJson(startzeitenFile(), {}) || {};
  const erwartet = Math.max(8000, Math.min(180000, Number(zeiten[version]) || 35000));
  const beginn = Date.now();
  let prozent = 3, label = 'Minecraft is starting', letzteMarke = beginn, fastFertig = false, fertig = false, mods = null, verbindet = false;
  const melden = () => progress('loading', mods && label === 'Loading mods' ? `Loading ${mods} mods` : label, Math.min(99, Math.round(prozent)));
  const abschliessen = (merken = true) => {
    if (fertig) return;
    fertig = true;
    clearInterval(uhr);
    const dauer = Date.now() - beginn;
    if (merken) try {
      // Gleitender Mittelwert, damit ein Ausreisser (z. B. erster Start) die Schaetzung nicht verdirbt
      const alt = Number(zeiten[version]) || dauer;
      zeiten[version] = Math.round(alt * 0.6 + dauer * 0.4);
      core.writeJson(startzeitenFile(), zeiten);
    } catch (_) {}
    progress('running', 'Minecraft is running', 100);
  };
  const uhr = setInterval(() => {
    if (fertig) return;
    const vergangen = Date.now() - beginn;
    const nachZeit = Math.min(95, vergangen / erwartet * 100);
    if (nachZeit > prozent) prozent = nachZeit;
    // Titelbildschirm erreicht: Sound laeuft und seit 4 s keine neue Phase.
    // Mit Server: erst, wenn die Welt da ist (oder 25 s nach "verbinde").
    if (fastFertig && !mitServer && Date.now() - letzteMarke > 4000) { abschliessen(); return; }
    if (verbindet && Date.now() - letzteMarke > 25000) { abschliessen(); return; }
    // Fehlt eine erwartete Zeile (andere Fassung, andere Mods): nach 20 s ohne
    // neue Phase gilt das Spiel als geladen, sobald die Ressourcen durch sind.
    if (!verbindet && label !== 'Minecraft is starting' && prozent >= 45 && Date.now() - letzteMarke > 20000) { abschliessen(); return; }
    if (vergangen > 240000) { abschliessen(); return; }
    melden();
  }, 1000);
  uhr.unref?.();
  return {
    zeile(text) {
      if (fertig) return;
      for (const ph of PHASEN) {
        if (!ph.re.test(text)) continue;
        if (ph.mods) { const m = text.match(/Loading (\d+) mods?/i); if (m) mods = m[1]; }
        if (ph.fertig && (mitServer ? verbindet : fastFertig)) { abschliessen(); return; }
        if (ph.fertig) continue;
        if (ph.server) verbindet = true;
        if (ph.fastFertig) fastFertig = true;
        letzteMarke = Date.now();
        if (ph.pct >= prozent) { prozent = ph.pct; label = ph.label; }
        melden();
        return;
      }
    },
    ende: () => abschliessen(false)
  };
}

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

/**
 * Java-Voreinstellungen (Einstellungen -> Spiel).
 *  smooth: G1 mit kurzen Pausen und grosser junger Generation -- weniger
 *          Ruckler beim Chunk-Laden (bewaehrte Werte fuer Minecraft).
 *  lowram: sparsamer: kleinere Regionen, doppelte Texte zusammenlegen.
 *  default: nichts extra -- Java entscheidet.
 * Alle Flags gibt es seit Java 17 (Minecraft 1.18+) und in Java 21/25.
 */
const JVM_PRESETS = {
  smooth: ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=50', '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20', '-XX:InitiatingHeapOccupancyPercent=15'],
  lowram: ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=80', '-XX:G1HeapRegionSize=4M', '-XX:+UseStringDeduplication', '-XX:+DisableExplicitGC'],
  default: []
};

const STAGES = { assets: 'Downloading assets', natives: 'Preparing natives', classes: 'Downloading libraries', 'assets-copy': 'Copying assets' };

async function start({ version, serverId = null, address = null, safe = false, hostedWorld = null }) {
  if (launching) throw new Error('A launch is already in progress.');
  const account = accounts.current();
  if (!account) throw new Error('Sign in with your Microsoft account first.');
  const acId = accounts.idOf(account);
  if ([...sessions.values()].some(s => s.accountId === acId)) {
    throw new Error(`${account.username} is already playing. Switch to another account to play in parallel.`);
  }
  const v = instances.requireVersion(version);
  const cfg = settings.get();
  if (safe && [...sessions.values()].some(s => s.version === v)) throw new Error('Close Minecraft first -- safe mode needs the instance to itself.');
  // Server aus der Liste -- oder direkt eine Adresse (Einladungslink vortex://join/...)
  const direkt = address ? servers.normalizeAddress(address) : null;
  // Eigene gehostete Welt (hosting.js): Name der Welt statt 127.0.0.1, nicht in den Server-Verlauf
  const server = serverId ? servers.byId(serverId) : direkt ? { id: null, name: hostedWorld || direkt, address: direkt, hosted: Boolean(hostedWorld) } : null;

  launching = true;
  try {
    progress('auth', 'Checking your account', null);
    const authorization = await accounts.freshAuth(account);
    if (!authorization) throw new Error('Sign in again to play.');

    // Neueste Vortex-Dateien (Client/Addon) holen -- VOR dem Einspielen, damit
    // ein Update schon bei DIESEM Start benutzt wird. Die Jars sind klein;
    // 30 s reichen auch bei langsamem Netz. Ohne Netz bricht das Manifest
    // nach 10 s ab, dann startet das Spiel mit den vorhandenen Dateien.
    if (instances.bundledVersions().includes(v)) {
      progress('prepare', 'Checking for Vortex updates', null);
      const r = await Promise.race([vortexfiles.refresh(ver => instances.packagedEntries(ver), { versionsOnly: [v] }), sleep(30000).then(() => null)]);
      for (const u of r?.updated || []) notify('success', `${u.name} ${u.newVersion} for Minecraft ${u.version} downloaded.`);
      if (r?.updated?.length) require('./core').send('whatsnew', r.updated);
    }

    progress('prepare', `Preparing Minecraft ${v}`, null);
    const prep = await instances.prepare(v);

    // Neue Versionen aus dem Admin-Bereich bringen evtl. keine Fabric API mit
    if (prep.vortex && !prep.hasFabricApi && !require('./core').isLegacyVersion(v)) {
      progress('prepare', 'Installing Fabric API', null);
      try { await modrinth.installMod('fabric-api', v); } catch (e) { log(`Fabric API could not be installed: ${e.message}`, 'warn'); }
    }

    // Pruefung vor dem Start: fehlende, doppelte oder unvertraegliche Mods
    // (im abgesicherten Modus nicht -- da laufen ohnehin nur die Vortex-Dateien)
    if (!safe) progress('prepare', 'Checking your mods', null);
    if (!safe) try {
      const pf = await preflight.run(v, (id, ver) => modrinth.installMod(id, ver));
      if (pf.installed.length) notify('success', `Missing mods installed: ${pf.installed.join(', ')}`);
      if (pf.disabled.length) notify('info', `Installed twice, older copy disabled: ${pf.disabled.join(', ')}`);
      if (pf.incompatible?.length) notify('info', `Not made for Minecraft ${v}, turned off: ${pf.incompatible.slice(0, 6).join(', ')}${pf.incompatible.length > 6 ? ' ...' : ''}`);
      for (const c of pf.conflicts || []) notify('info', `Turned off ${c.aus}: it does not work together with ${c.mit} -- singleplayer worlds would not open.`);
      for (const w of pf.warnings.slice(0, 3)) notify('error', w);
    } catch (e) { log(`Mod check skipped: ${e.message}`, 'warn'); }

    // Mod-Updates automatisch einspielen (Einstellung)
    if (cfg.autoUpdateMods && !safe) {
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

    if (safe) {
      progress('prepare', 'Safe mode: switching your own mods off', null);
      const n = require('./safemode').enter(v);
      notify('info', n ? `Safe mode: ${n} of your mods are off for this start and come back afterwards.` : 'Safe mode: you have no extra mods -- starting normally.');
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
    let laden = null;
    client.on('data', data => {
      if (!sawGameOutput) { sawGameOutput = true; laden = ladeBeobachter(v, Boolean(server)); }
      for (const line of String(data).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { laden?.zeile(line); } catch (_) {}
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
        ...(cfg.jvmPreset === 'custom' ? parseArgs(cfg.jvmArgs) : (JVM_PRESETS[cfg.jvmPreset] || [])),
        // Freunde im Spiel: Der Vortex Client verbindet sich mit demselben Server.
        ...(friendsUrl() ? [`-Dvortex.friends.url=${friendsUrl()}`] : []),
        // Gemeinsamer Ordner fuer Presets, Waypoints, Makros ... -- alle
        // Minecraft-Versionen (26.2, 1.21.11) benutzen dieselben Einstellungen.
        `-Dvortex.shared.dir=${path.join(paths.dataRoot, 'shared')}`,
        // Beta-Test-Checkliste im Spiel (nur wenn der Beta-Kanal aktiv ist).
        ...(vortexfiles.betaActive() ? [`-Dvortex.beta.dir=${require('./betatest').dir()}`] : []),
        // Gehostete Welt: "Hosting Options" im Pausenmenue (Austausch ueber Dateien)
        ...(server?.hosted ? [`-Dvortex.hosting.dir=${require('./hosting').ingameDir()}`] : [])
      ]
    };
    if (server) {
      // "Quick Play" gibt es erst ab 1.20 -- aeltere Versionen (z. B. 1.8.9) bekommen --server/--port
      const m = String(v).match(/^1\.(\d+)/);
      const alt = Boolean(m) && Number(m[1]) < 20;
      options.quickPlay = { type: alt ? 'legacy' : 'multiplayer', identifier: server.address };
    }

    progress('download', 'Checking game files', null);
    log(`Launching Minecraft ${v} (${prep.profileId}) as ${account.username} with ${cfg.memoryMax} MB RAM.`);
    const child = await client.launch(options);
    if (!child) {
      if (safe) { try { require('./safemode').leave(v); } catch (_) {} }
      throw new Error(lastError || 'Minecraft could not be started. Open the console for details.');
    }

    const id = `${acId}:${Date.now()}`;
    const launchedAt = Date.now();
    const session = { id, version: v, username: account.username, accountId: acId, child, startedAt: launchedAt, gameDirectory, stopped: false, running: true };
    const info = instances.bundleInfo(v);
    discord.update({ state: 'playing', version: v, client: info.clientVersion, server: server?.name, since: launchedAt });
    sessions.set(id, session);
    instances.markPlayed(v);
    if (server && !server.hosted) { try { servers.markPlayed(server.address); } catch (_) {} }
    publishSessions();
    progress('started', server ? `Joining ${server.name}` : 'Minecraft is starting', 100);
    notify('success', server ? `Minecraft ${v} is starting and joins ${server.name}.` : `Minecraft ${v} is starting.`);

    const win = getMainWindow();
    if (win) {
      if (cfg.afterLaunch === 'minimize') setTimeout(() => { try { win.minimize(); } catch (_) {} }, 1500);
      if (cfg.afterLaunch === 'hide') setTimeout(() => { try { win.hide(); } catch (_) {} }, 1500);
    }

    // Neue Screenshots (F2) direkt in die Zwischenablage -- dann reicht in
    // Discord ein Strg+V. Nur solange diese Sitzung laeuft.
    const shotWatcher = watchScreenshots(path.join(gameDirectory, 'screenshots'));

    child.on('close', code => {
      try { shotWatcher && shotWatcher.close(); } catch (_) {}
      try { laden?.ende(); } catch (_) {}
      sessions.delete(id);
      if (safe) { try { require('./safemode').leave(v); core.send('versions', instances.allVersions().map(instances.summary)); } catch (e) { log(`Safe mode: ${e.message}`, 'warn'); } }
      try { instances.addPlaytime(v, Date.now() - launchedAt); } catch (_) {}
      // Waehrend des Spiels geladene Updates: jetzt, wo die alten Jars frei
      // sind, einspielen und die alten entfernen (Windows sperrt sie vorher).
      setTimeout(() => {
        if ([...sessions.values()].some(s => s.version === v)) return;
        // Nach dem Schliessen: alte Dateien entfernen. Klemmt eine, weil Java
        // ohne Fenster weiterlaeuft, wird dieser Prozess beendet.
        if (instances.bundledVersions().includes(v)) void instances.syncBundledCleaning(v).catch(() => {});
      }, 1500);
      core.send('versions', instances.allVersions().map(instances.summary));
      publishSessions();
      const crashed = code !== 0 && code !== null && !session.stopped;
      if (crashed) {
        appendFileLog(paths.crashLog, `Minecraft ${v} (${account.username}) exited with code ${code}`);
        let analysis = null;
        try { analysis = crash.analyze({ version: v, gameDirectory, startedAt: launchedAt, code, output }); }
        catch (e) { log(`Crash analysis failed: ${e.message}`, 'debug'); }
        lastCrash = analysis;
        let reported = null;
        if (analysis && settings.get().autoCrashReport) {
          try {
            const cr = require('./crashreport');
            if (cr.enabled()) { reported = 'pending'; cr.send(analysis).then(r => log(`Crash report ${r.id} sent automatically.`)).catch(e => log(`Crash report: ${e.message}`, 'warn')); }
          } catch (_) {}
        }
        if (analysis) analysis.safeMode = Boolean(safe);
        send('crash', { version: v, code, crashReports: exists(paths.crashReportsRoot(v)), analysis, reported });
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

function watchScreenshots(dir) {
  try {
    ensureDir(dir);
    const seen = new Set(fs.readdirSync(dir));
    const timers = new Map();
    return fs.watch(dir, (_ev, name) => {
      if (!name || !/\.png$/i.test(name) || seen.has(name)) return;
      clearTimeout(timers.get(name));
      // Minecraft schreibt die Datei in mehreren Schritten -- kurz warten.
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        const file = path.join(dir, name);
        if (!exists(file) || seen.has(name)) return;
        seen.add(name);
        if (!settings.get().autoCopyScreenshots) return;
        try {
          const { clipboard, nativeImage } = require('electron');
          const img = nativeImage.createFromPath(file);
          if (!img.isEmpty()) { clipboard.writeImage(img); notify('success', 'Screenshot copied -- paste it in Discord with Ctrl+V.'); }
        } catch (e) { log(`Screenshot copy: ${e.message}`, 'warn'); }
      }, 700));
    });
  } catch (e) { log(`Screenshot watcher: ${e.message}`, 'debug'); return null; }
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

module.exports = { start, stop, sessionList, isLaunching, lastCrash: () => lastCrash, ladeBeobachter };
