'use strict';
/**
 * Automatische Updates ueber GitHub Releases (electron-updater).
 *
 * Funktioniert, sobald der Launcher als Release in
 * github.com/Lukas3578/Vortex-launcher veroeffentlicht wird (latest.yml +
 * Setup-EXE). Solange es dort nichts Passendes gibt, bleibt es still -- kein
 * roter Fehler bei jedem Start.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { send, log } = require('./core');

let state = { status: 'idle', current: app.getVersion(), available: null, progress: 0, error: null };
let busy = false;
let timer = null;

function set(patch) { state = { ...state, ...patch }; send('update-state', state); return state; }

function setup() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', i => set({ status: 'available', available: i.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', available: null }));
  autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => set({ status: 'ready', available: i.version, progress: 100 }));
  autoUpdater.on('error', e => {
    log(`Update check: ${e?.message || e}`, 'debug');
    set({ status: 'unavailable', error: 'No update information found.' });
  });
}

async function check() {
  if (!app.isPackaged) return set({ status: 'dev', error: 'Updates are only checked in the built app.' });
  if (busy) return state;
  busy = true;
  try { await autoUpdater.checkForUpdates(); } catch (_) { /* Fehler kommt ueber das Ereignis */ }
  finally { busy = false; }
  return state;
}

async function download() {
  if (!app.isPackaged) return state;
  try { await autoUpdater.downloadUpdate(); } catch (e) { set({ status: 'unavailable', error: e.message }); }
  return state;
}

function install() { if (state.status === 'ready') autoUpdater.quitAndInstall(false, true); }

function startBackground() {
  if (!app.isPackaged) return;
  setTimeout(() => void check(), 5000);
  timer = setInterval(() => void check(), 30 * 60 * 1000);
}
function stopBackground() { if (timer) clearInterval(timer); }

module.exports = { setup, check, download, install, startBackground, stopBackground, get: () => state };
