'use strict';
/**
 * Start-Labor (nur GitHub Actions, Linux + Xvfb): Der Launcher-Code selbst
 * (instances, launch, java, Legacy-Fabric-Meta, minecraft-launcher-core)
 * installiert und startet eine Minecraft-Version -- mit Offline-Konto statt
 * Microsoft. Prueft, dass das Spiel laeuft und der Vortex Client geladen ist,
 * macht ein Bildschirmfoto des Fensters und beendet das Spiel wieder.
 *
 *   LAB_V=1.8.9 LAB_JAR=/pfad/vortexclient.jar LAB_JAVA=/pfad/java node tools/launch-lab/run.js
 *
 * Bericht: lab-launch/report-<version>.txt, Bild: lab-launch/screen-<version>.png
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const V = process.env.LAB_V || '1.8.9';
const OUT = path.resolve('lab-launch');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-launch-'));
const report = [];
let fehler = 0;
const say = t => { report.push(String(t)); console.log(String(t)); };
const pruefe = (name, ok, info = '') => { if (!ok) fehler++; say(`${ok ? 'OK  ' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const fin = () => { fs.writeFileSync(path.join(OUT, `report-${V}.txt`), report.join('\n') + '\n'); process.exit(fehler ? 1 : 0); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Electron-Ersatz ---------------------------------------------------------
class Em { constructor() { this.l = {}; } on(e, f) { (this.l[e] ||= []).push(f); return this; } once(e, f) { return this.on(e, f); } emit(e, ...a) { (this.l[e] || []).forEach(f => f(...a)); } }
const electron = {
  app: Object.assign(new Em(), { getPath: () => DATA, getVersion: () => '2.5.0-lab', isPackaged: false, getAppPath: () => path.resolve('.') }),
  shell: { openExternal: async () => {}, trashItem: async p => fs.rmSync(p, { recursive: true, force: true }), showItemInFolder() {} },
  BrowserWindow: class { static getAllWindows() { return []; } },
  dialog: {}, ipcMain: { handle() {}, on() {} }, Notification: class { static isSupported() { return false; } },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) }, powerMonitor: new Em(), net: {}
};
const { Authenticator } = require('minecraft-launcher-core');
const konto = { username: 'VortexLab', type: 'offline' };
const accountsMock = {
  current: () => konto,
  idOf: () => 'lab',
  freshAuth: async () => Authenticator.getAuth('VortexLab'),
  currentSummary: () => ({ username: 'VortexLab' }),
  list: () => []
};
const load = Module._load;
Module._load = function (req, parent) {
  if (req === 'electron') return electron;
  if (req === './accounts' && parent && /src[\\/]main/.test(parent.filename)) return accountsMock;
  if (req === './discord') return { update() {}, stop() {} };
  return load.apply(this, arguments);
};

// Das echte Vortex-Manifest nicht holen: sonst ersetzt es unser lokales (mit der Test-Jar)
const echtesFetch = global.fetch;
global.fetch = (url, ...rest) => {
  if (/vortex-files\/manifest/.test(String(url))) return Promise.reject(new Error('lab: no remote manifest'));
  return echtesFetch(url, ...rest);
};

(async () => {
  const src = path.resolve('src', 'main');
  const core = require(path.join(src, 'core'));
  // Alle Meldungen (auch die Ausgabe des Spiels) mitschreiben -- VOR dem Laden
  // der anderen Module, die "log" beim Laden uebernehmen.
  const zeilen = [];
  const logDatei = path.join(OUT, `launcher-${V}.log`);
  const origLog = core.log;
  core.log = (m, l) => { const t = `[${l || 'info'}] ${m}`; zeilen.push(String(m)); fs.appendFileSync(logDatei, t + '\n'); if (l !== 'game') console.log(t); };
  const settings = require(path.join(src, 'settings'));
  const instances = require(path.join(src, 'instances'));
  const launch = require(path.join(src, 'launch'));
  const java = require(path.join(src, 'java'));

  say(`=== Start-Labor Minecraft ${V} ===`);
  pruefe('Legacy-Version erkannt', core.isLegacyVersion(V) === /^1\.(\d|1[0-3])(\.|$)/.test(V), `isLegacy=${core.isLegacyVersion(V)}, loader=${core.modLoader(V)}`);
  pruefe('braucht Java', true, `Java ${java.requiredJavaMajor(V)}`);

  // Version hinzufuegen (fragt die (Legacy-)Fabric-Meta)
  try {
    const v = await instances.addVersion(V);
    pruefe('Version hinzugefuegt', v === V);
  } catch (e) { pruefe('Version hinzugefuegt', false, e.message); return fin(); }

  settings.set({ selectedVersion: V, javaPath: process.env.LAB_JAVA || '', width: 1280, height: 720, memoryMax: 2048, memoryMin: 1024, jvmPreset: 'default' });

  // Vortex-Jar wie eine veroeffentlichte Vortex-Datei (lokales Manifest) -- so wie Spieler sie bekommen
  if (process.env.LAB_JAR) {
    const crypto = require('crypto');
    const buf = fs.readFileSync(process.env.LAB_JAR);
    const name = `vortexclient-fabric-${V}-lab+${V}.jar`;
    const dir = path.join(core.paths.dataRoot, 'vortex-files');
    fs.mkdirSync(path.join(dir, V), { recursive: true });
    fs.writeFileSync(path.join(dir, V, name), buf);
    core.writeJson(path.join(dir, 'manifest.json'), { schema: 1, versions: { [V]: { files: { vortexclient: {
      file: name, version: `lab+${V}`, name: 'Vortex Client', sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length } } } } });
    pruefe('1.8.9 ist eine Vortex-Version', instances.bundledVersions().includes(V), instances.bundledVersions().join(', '));
  }

  let sitzung;
  try {
    const t0 = Date.now();
    sitzung = await launch.start({ version: V });
    pruefe('Minecraft gestartet', Boolean(sitzung), `${Math.round((Date.now() - t0) / 1000)} s bis zum Prozess`);
  } catch (e) {
    pruefe('Minecraft gestartet', false, e.message);
    return fin();
  }

  // Bis zu 4 Minuten auf das Fenster / den Vortex Client warten
  const gameLog = () => {
    try { return fs.readFileSync(path.join(core.paths.instanceRoot(V), 'logs', 'latest.log'), 'utf8'); } catch (_) { return ''; }
  };
  let vortex = false, sound = false, title = false;
  for (let i = 0; i < 48 && !(vortex && title); i++) {
    await sleep(5000);
    const g = gameLog() + '\n' + zeilen.join('\n');
    vortex = vortex || /\[Vortex\] Vortex Client for 1\.8\.9 loaded/.test(g);
    sound = sound || /Sound engine started|SoundSystem started/i.test(g);
    title = title || /Created: \d+x\d+ textures-atlas|Sound engine started/i.test(g);
    if (/Crash report saved|---- Minecraft Crash Report ----|Exception in thread "main"/.test(g)) { pruefe('kein Absturz', false); break; }
  }
  pruefe('Vortex Client geladen', vortex);
  pruefe('Spiel bis zum Hauptmenue (Texturen/Sound)', title, sound ? 'Sound an' : 'ohne Sound (normal in CI)');
  await sleep(8000);
  try {
    execFileSync('import', ['-window', 'root', path.join(OUT, `screen-${V}.png`)], { env: process.env });
    say(`Bild: screen-${V}.png`);
  } catch (e) { say(`Kein Bild: ${e.message}`); }
  try { fs.copyFileSync(path.join(core.paths.instanceRoot(V), 'logs', 'latest.log'), path.join(OUT, `latest-${V}.log`)); } catch (_) {}
  // Fabric-Profil und Bibliotheken fuer die Fehlersuche
  try {
    const vdir = path.join(core.paths.instanceRoot(V), 'versions');
    for (const d of fs.readdirSync(vdir)) { const j = path.join(vdir, d, `${d}.json`); if (fs.existsSync(j)) fs.copyFileSync(j, path.join(OUT, `profile-${d}.json`)); }
    const libs = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else libs.push(`${fs.statSync(p).size}\t${path.relative(core.paths.instanceRoot(V), p)}`); } };
    walk(path.join(core.paths.instanceRoot(V), 'libraries'));
    fs.writeFileSync(path.join(OUT, `libraries-${V}.txt`), libs.join('\n'));
  } catch (e) { say(`Profil/Bibliotheken: ${e.message}`); }
  try { launch.stop(sitzung.id || sitzung); } catch (_) {}
  try { execFileSync('pkill', ['-f', 'net.fabricmc.loader']); } catch (_) {}
  core.log = origLog;
  fin();
})().catch(e => { pruefe('Labor lief durch', false, e.stack || e.message); fin(); });
