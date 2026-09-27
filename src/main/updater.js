'use strict';
/**
 * Automatische Updates ueber GitHub Releases (electron-updater).
 *
 * Quelle ist das OEFFENTLICHE Release-Repo aus config.js (package.json ->
 * build.publish). Der Code selbst kann in einem privaten Repo liegen; die
 * GitHub Action dort baut bei jeder Aenderung und veroeffentlicht die EXE im
 * oeffentlichen Repo.
 *
 * Ablauf fuer Spieler: Launcher prueft beim Start und alle 30 Minuten ->
 * "Neues Update" erscheint in der Seitenleiste -> ein Klick auf
 * "Aktualisieren" laedt es und startet den Launcher neu.
 *
 * Die Portable-EXE kann sich nicht selbst ersetzen: dort oeffnet der Knopf
 * die Download-Seite.
 */
const { app, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const config = require('./config');
const { send, log } = require('./core');

const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
const releasesPage = `https://github.com/${config.github.owner}/${config.github.repo}/releases/latest`;

let state = { status: 'idle', current: app.getVersion(), available: null, progress: 0, error: null, portable };
let busy = false;
let timer = null;
let installWhenReady = false;

function set(patch) { state = { ...state, ...patch }; send('update-state', state); return state; }
const keep = () => ['available', 'downloading', 'ready'].includes(state.status);

function setup() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;          // das Release "vortex-files" (Admin) ist ein Pre-Release und wird ignoriert
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => { if (!keep()) set({ status: 'checking', error: null }); });
  autoUpdater.on('update-available', i => { if (!keep() || state.available !== i.version) set({ status: 'available', available: i.version, progress: 0 }); });
  autoUpdater.on('update-not-available', () => { if (!keep()) set({ status: 'latest', available: null }); });
  autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => {
    set({ status: 'ready', available: i.version, progress: 100 });
    if (installWhenReady) setTimeout(() => autoUpdater.quitAndInstall(false, true), 1200);
  });
  autoUpdater.on('error', e => {
    log(`Update check: ${e?.message || e}`, 'debug');
    installWhenReady = false;
    if (state.status === 'downloading') set({ status: 'available', error: 'The download failed. Try again.' });
    else if (!keep()) set({ status: 'unavailable', error: 'No update information found.' });
  });
}

async function check() {
  if (!app.isPackaged) return set({ status: 'dev', error: 'Updates are only checked in the built app.' });
  if (busy || state.status === 'downloading' || state.status === 'ready') return state;
  busy = true;
  try { await autoUpdater.checkForUpdates(); } catch (_) { /* Fehler kommt ueber das Ereignis */ }
  finally { busy = false; }
  return state;
}

async function download() {
  if (!app.isPackaged) return state;
  try { await autoUpdater.downloadUpdate(); } catch (e) { set({ status: 'available', error: e.message }); }
  return state;
}

/** Ein Klick: laden und danach sofort neu starten (Portable: Download-Seite oeffnen). */
async function update() {
  if (portable) { await shell.openExternal(releasesPage); return state; }
  if (state.status === 'ready') { install(); return state; }
  if (state.status !== 'available') return state;
  installWhenReady = true;
  set({ status: 'downloading', progress: 0, error: null });
  void download();
  return state;
}

function install() { if (state.status === 'ready') autoUpdater.quitAndInstall(false, true); }

function startBackground() {
  if (!app.isPackaged) return;
  setTimeout(() => void check(), 5000);
  timer = setInterval(() => void check(), 30 * 60 * 1000);
}
function stopBackground() { if (timer) clearInterval(timer); }

module.exports = { setup, check, download, update, install, startBackground, stopBackground, get: () => state };
