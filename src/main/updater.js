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
 *
 * Wenn die Installation NICHT klappt (2.5.32): Der stille Installer kann auf
 * manchen PCs scheitern, ohne etwas zu sagen -- der Launcher geht zu, kommt
 * nicht wieder, und beim naechsten Start steht wieder "Aktualisieren" da.
 * Deshalb merkt sich der Launcher jeden Versuch (update-attempt.json) und
 * prueft beim naechsten Start, ob die Version wirklich angekommen ist:
 *   1. Versuch: still (wie bisher)
 *   2. Versuch: mit sichtbarem Installer (fragt bei Bedarf nach Admin-Rechten,
 *      zeigt Fehler an)
 *   3. Versuch und weitere: den vollstaendigen Installer in "Downloads"
 *      speichern und oeffnen -- ganz ohne den Update-Zwischenspeicher.
 */
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const config = require('./config');
const { send, log, compareVersions } = require('./core');

const VERSUCH = () => path.join(app.getPath('userData'), 'update-attempt.json');
function leseVersuch() {
  try { const v = JSON.parse(fs.readFileSync(VERSUCH(), 'utf8')); return v && typeof v.version === 'string' ? v : null; } catch (_) { return null; }
}
function schreibeVersuch(v) {
  try { fs.mkdirSync(path.dirname(VERSUCH()), { recursive: true }); fs.writeFileSync(VERSUCH(), JSON.stringify(v)); } catch (e) { log(`Update: ${e.message}`, 'warn'); }
}

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
  // Hat der letzte Update-Versuch geklappt?
  const v = leseVersuch();
  if (v) {
    if (compareVersions(app.getVersion(), v.version) >= 0) {
      log(`Launcher-Update auf ${v.version} installiert.`, 'info');
      try { fs.rmSync(VERSUCH(), { force: true }); } catch (_) {}
    } else {
      log(`Launcher-Update auf ${v.version} wurde NICHT installiert (Versuch ${v.tries}, Modus ${v.mode}).`, 'warn');
      state = { ...state, failed: { version: v.version, tries: v.tries || 1 } };
    }
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;          // das Release "vortex-files" (Admin) ist ein Pre-Release und wird ignoriert
  // Fehler des Updaters landen im Launcher-Protokoll (fuer die Fehlersuche)
  autoUpdater.logger = { info() {}, debug() {}, warn: m => log(`Updater: ${m}`, 'warn'), error: m => log(`Updater: ${m}`, 'warn') };
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
    // Wie oft wurde genau diese Version schon versucht?
    const vorher = leseVersuch();
    const tries = (vorher && vorher.version === geladen ? vorher.tries || 1 : 0) + 1;
    if (tries >= 3) {
      holen = false; installWhenReady = false;
      await manuell(geladen, tries);
      return;
    }
    const still = tries < 2;
    schreibeVersuch({ version: geladen, tries, mode: still ? 'silent' : 'visible', at: Date.now() });
    set({ status: 'ready', available: geladen, progress: 100 });
    log(`Launcher-Update: installiere ${geladen} (${still ? 'still' : 'mit Installer-Fenster'}, Versuch ${tries})`, 'info');
    setTimeout(() => autoUpdater.quitAndInstall(still, true), 1200);
  } catch (e) {
    log(`Update: ${e?.message || e}`, 'debug');
    holen = false; installWhenReady = false;
    set(geladen ? { status: 'ready', available: geladen, progress: 100, error: null }
                : { status: 'available', error: 'The download failed. Try again.' });
  }
}

/**
 * Letzter Ausweg: den vollstaendigen Installer von GitHub in "Downloads"
 * speichern und oeffnen. Er laeuft wie bei der ersten Installation (mit
 * Fenster, fragt bei Bedarf nach Admin-Rechten); alle Daten bleiben erhalten.
 */
async function manuell(version, tries) {
  const name = `Vortex-Client-Setup-${version}.exe`;
  const url = `https://github.com/${config.github.owner}/${config.github.repo}/releases/download/v${version}/${name}`;
  try {
    set({ status: 'downloading', available: version, progress: 0, error: null });
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const gesamt = Number(r.headers.get('content-length')) || 0;
    const teile = [];
    let n = 0;
    for await (const t of r.body) {
      teile.push(Buffer.from(t));
      n += t.length;
      if (gesamt) set({ status: 'downloading', progress: Math.round(n / gesamt * 100) });
    }
    const ziel = path.join(app.getPath('downloads'), name);
    fs.writeFileSync(ziel, Buffer.concat(teile));
    schreibeVersuch({ version, tries, mode: 'manual', at: Date.now() });
    log(`Launcher-Update: Installer gespeichert unter ${ziel} -- wird geoeffnet.`, 'info');
    const fehler = await shell.openPath(ziel);
    if (fehler) {
      shell.showItemInFolder(ziel);
      set({ status: 'available', progress: 0, error: 'Could not start the installer. It is in your Downloads folder.' });
      return;
    }
    set({ status: 'ready', available: version, progress: 100 });
    setTimeout(() => app.quit(), 1500);
  } catch (e) {
    log(`Launcher-Update (Download des Installers): ${e?.message || e}`, 'warn');
    await shell.openExternal(releasesPage);
    set({ status: 'available', progress: 0, error: 'The update could not be installed automatically. The download page is open -- install the Setup file from there.' });
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
