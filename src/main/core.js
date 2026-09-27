'use strict';
/**
 * Grundlagen: Pfade, JSON-Speicher, Log und Nachrichten an die Oberflaeche.
 *
 * Der Datenordner bleibt derselbe wie beim alten Launcher
 * (%APPDATA%\Vortex Client). So bleiben Anmeldungen, Instanzen, Welten und
 * Mods beim Umstieg erhalten.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const dataRoot = path.join(app.getPath('appData'), 'Vortex Client');
const instancesRoot = path.join(dataRoot, 'instances');
const paths = {
  dataRoot,
  instancesRoot,
  accountFile: path.join(dataRoot, 'account.json'),
  settingsFile: path.join(dataRoot, 'settings.json'),
  customVersionsFile: path.join(dataRoot, 'minecraft-versions.json'),
  serversFile: path.join(dataRoot, 'servers.json'),
  avatarsRoot: path.join(dataRoot, 'profile-images'),
  runtimeRoot: path.join(dataRoot, 'runtime'),
  launchLog: path.join(dataRoot, 'launch.log'),
  crashLog: path.join(dataRoot, 'crash.log'),
  assetsRoot: () => path.join(app.getAppPath(), 'assets'),
  // Die Mod-Pakete liegen im Build ausgepackt neben app.asar (asarUnpack),
  // damit sie als echte Dateien kopiert werden koennen.
  modpacksRoot: () => path.join(app.getAppPath(), 'assets', 'modpacks').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'),
  instanceRoot: version => path.join(instancesRoot, version),
  modsRoot: version => path.join(instancesRoot, version, 'mods'),
  resourcePacksRoot: version => path.join(instancesRoot, version, 'resourcepacks'),
  shaderPacksRoot: version => path.join(instancesRoot, version, 'shaderpacks'),
  crashReportsRoot: version => path.join(instancesRoot, version, 'crash-reports')
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function exists(file) { try { return fs.existsSync(file); } catch (_) { return false; } }

function loadJson(file, fallback) {
  try { return exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch (_) { return fallback; }
}

/** Atomar schreiben: erst in eine Temp-Datei, dann umbenennen. */
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

let mainWindow = null;
function setMainWindow(win) { mainWindow = win; }
function getMainWindow() { return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null; }

/** Nachricht an die Oberflaeche (falls offen). */
function send(channel, payload) {
  const win = getMainWindow();
  if (win) win.webContents.send(channel, payload);
}

function appendFileLog(file, message) {
  try {
    ensureDir(dataRoot);
    const line = `[${new Date().toISOString()}] ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 4000)}\n`;
    fs.appendFileSync(file, line, 'utf8');
    // Nicht endlos wachsen lassen: ueber 3 MB auf das letzte MB kuerzen.
    if (fs.statSync(file).size > 3 * 1024 * 1024) {
      fs.writeFileSync(file, fs.readFileSync(file).subarray(-1024 * 1024));
    }
  } catch (_) { /* Log darf nie etwas kaputt machen */ }
}

/**
 * Log-Zeile: in die Datei und an die Konsole der Oberflaeche.
 *
 * Gebuendelt alle 200 ms -- Minecraft schreibt beim Start hunderte Zeilen,
 * einzeln geschrieben und einzeln an die Oberflaeche geschickt waere das
 * spuerbar langsam.
 */
const logQueue = [];
let logTimer = null;
function flushLog() {
  logTimer = null;
  if (!logQueue.length) return;
  const batch = logQueue.splice(0, logQueue.length);
  try {
    ensureDir(dataRoot);
    const stamp = new Date().toISOString();
    fs.appendFileSync(paths.launchLog, batch.map(e => `[${stamp}] ${e.level.toUpperCase()} ${e.text.replace(/[\r\n]+/g, ' ')}\n`).join(''), 'utf8');
    if (fs.statSync(paths.launchLog).size > 3 * 1024 * 1024) {
      fs.writeFileSync(paths.launchLog, fs.readFileSync(paths.launchLog).subarray(-1024 * 1024));
    }
  } catch (_) {}
  send('log', batch);
}
function log(message, level = 'info') {
  const text = String(message ?? '').trim();
  if (!text) return;
  logQueue.push({ time: Date.now(), level, text: text.slice(0, 2000) });
  if (logQueue.length > 2000) logQueue.splice(0, logQueue.length - 2000);
  if (!logTimer) logTimer = setTimeout(flushLog, 200);
}

/** Kurze Statusmeldung (Toast in der Oberflaeche). */
function notify(type, message) {
  log(message, type === 'error' ? 'error' : 'info');
  send('notify', { type, message: String(message) });
}

function versionParts(value) { return String(value || '').replace(/^v/i, '').split('.').map(p => Number.parseInt(p, 10) || 0); }
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Nur Release-Versionen wie 1.20.1, 1.21.11, 26.2 oder 26.1.2. */
function isValidMinecraftVersion(version) {
  return /^(?:1\.\d{1,2}(?:\.\d{1,2})?|[2-9]\d(?:\.\d{1,2}){1,2})$/.test(String(version || '').trim());
}

function safeFileName(value) {
  return String(value || 'file').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '') || 'file';
}

module.exports = {
  paths, ensureDir, exists, loadJson, writeJson, setMainWindow, getMainWindow, send,
  appendFileLog, log, notify, compareVersions, isValidMinecraftVersion, safeFileName
};
