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
 *
 * Immer nur EIN Update, egal wie viele Versionen man verpasst hat: jede
 * Version enthaelt alles davor, also wird direkt die neueste geholt. Dafuer
 * fragt der Knopf GitHub vor dem Laden UND noch einmal vor dem Neustart --
 * sonst wuerde eine Info von vor bis zu 30 Minuten (oder ein vor Tagen
 * geladenes, nie installiertes Update) erst eine alte Version installieren
 * und beim naechsten Start gleich das naechste Update anbieten.
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
let holen = false;          // laeuft gerade "neueste Version holen" -> keine Zwischenstaende anzeigen
let geladen = null;         // Version, deren Installer schon heruntergeladen ist

function set(patch) { state = { ...state, ...patch }; send('update-state', state); return state; }
const keep = () => ['available', 'downloading', 'ready'].includes(state.status);

function setup() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;          // das Release "vortex-files" (Admin) ist ein Pre-Release und wird ignoriert
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => { if (!holen && !keep()) set({ status: 'checking', error: null }); });
  autoUpdater.on('update-available', i => {
    if (holen) return;
    // Schon geladen, aber inzwischen gibt es eine neuere: wieder "Update verfuegbar"
    // (und das alte Geladene NICHT beim Beenden installieren -- sonst zwei Updates hintereinander)
    if (state.status === 'ready' && geladen && i.version !== geladen) {
      autoUpdater.autoInstallOnAppQuit = false;
      set({ status: 'available', available: i.version, progress: 0 });
      return;
    }
    if (!keep() || state.available !== i.version) set({ status: 'available', available: i.version, progress: 0 });
  });
  autoUpdater.on('update-not-available', () => { if (!holen && !keep()) set({ status: 'latest', available: null }); });
  autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => {
    geladen = i.version;
    autoUpdater.autoInstallOnAppQuit = true;
    if (!holen) set({ status: 'ready', available: i.version, progress: 100 });
  });
  autoUpdater.on('error', e => {
    log(`Update check: ${e?.message || e}`, 'debug');
    if (holen) return;                      // holeNeueste() meldet selbst
    installWhenReady = false;
    if (state.status === 'downloading') set({ status: 'available', error: 'The download failed. Try again.' });
    else if (!keep()) set({ status: 'unavailable', error: 'No update information found.' });
  });
}

async function check() {
  if (!app.isPackaged) return set({ status: 'dev', error: 'Updates are only checked in the built app.' });
  // Auch im Zustand "ready" pruefen: liegt eine noch neuere Version bereit, wird sie angeboten
  if (busy || holen || state.status === 'downloading') return state;
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

/**
 * Neueste Version holen und installieren: GitHub frisch fragen, laden, vor dem
 * Neustart noch einmal fragen (wurde waehrend des Ladens eine neuere Version
 * veroeffentlicht, wird die geladen). Hoechstens 3 Runden.
 */
async function holeNeueste() {
  if (holen) return;
  holen = true;
  installWhenReady = true;
  set({ status: 'downloading', progress: 0, error: null });
  try {
    for (let runde = 0; runde < 3; runde++) {
      const r = await autoUpdater.checkForUpdates();
      const neueste = r?.isUpdateAvailable ? r.updateInfo?.version : null;
      if (!neueste) {
        if (geladen) break;                 // nichts Neueres -> das Geladene installieren
        holen = false; installWhenReady = false;
        set({ status: 'latest', available: null, progress: 0 });
        return;
      }
      if (neueste === geladen) break;       // die neueste ist schon geladen
      set({ status: 'downloading', available: neueste, progress: 0 });
      await autoUpdater.downloadUpdate();
      geladen = neueste;
    }
    set({ status: 'ready', available: geladen, progress: 100 });
    log(`Launcher-Update: installiere ${geladen}`, 'info');
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
  } catch (e) {
    log(`Update: ${e?.message || e}`, 'debug');
    holen = false; installWhenReady = false;
    set(geladen ? { status: 'ready', available: geladen, progress: 100, error: null }
                : { status: 'available', error: 'The download failed. Try again.' });
  }
}

/** Ein Klick: neueste Version laden und danach sofort neu starten (Portable: Download-Seite oeffnen). */
async function update() {
  if (portable) { await shell.openExternal(releasesPage); return state; }
  if (!app.isPackaged) return state;
  if (state.status !== 'available' && state.status !== 'ready') return state;
  void holeNeueste();
  return state;
}

function install() { if (state.status === 'ready') void holeNeueste(); }

function startBackground() {
  if (!app.isPackaged) return;
  setTimeout(() => void check(), 5000);
  timer = setInterval(() => void check(), 30 * 60 * 1000);
}
function stopBackground() { if (timer) clearInterval(timer); }

module.exports = { setup, check, download, update, install, startBackground, stopBackground, get: () => state };
