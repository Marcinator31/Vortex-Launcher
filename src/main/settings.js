'use strict';
/**
 * Einstellungen des Launchers -- alle an einer Stelle, mit Grenzen.
 *
 * Neu gegenueber dem alten Launcher: Arbeitsspeicher, eigenes Java,
 * Fenstergroesse, JVM-Argumente, Verhalten nach dem Start und ob das
 * Vortex Plus Addon mitgeladen wird. Vorher war der Speicher fest auf
 * 2-4 GB verdrahtet.
 */
const os = require('os');
const { paths, loadJson, writeJson, isValidMinecraftVersion } = require('./core');

const totalMb = Math.floor(os.totalmem() / (1024 * 1024));

const DEFAULTS = Object.freeze({
  selectedVersion: '26.2',
  selectedServerId: 'official-vortexpvp',
  memoryMax: Math.min(6144, Math.max(2048, Math.floor(totalMb / 2 / 512) * 512)),
  memoryMin: 1024,
  javaPath: '',
  width: 1280,
  height: 720,
  fullscreen: false,
  jvmArgs: '',
  afterLaunch: 'minimize',        // keep | minimize | hide
  includeAddon: true,
  showConsoleOnCrash: true,
  autoBackup: true,               // Welten sichern, bevor aktualisierte Mods/Vortex-Dateien starten
  autoUpdateMods: false,          // Mod-Updates beim Start automatisch einspielen
  discord: true,                  // Discord-Anzeige (wenn in config.js eingerichtet)
  language: 'auto'                // auto | de | en
});

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalize(raw = {}) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  const maxAllowed = Math.max(1024, totalMb - 1024);
  s.memoryMax = clampInt(s.memoryMax, 1024, maxAllowed, DEFAULTS.memoryMax);
  s.memoryMin = clampInt(s.memoryMin, 512, s.memoryMax, Math.min(DEFAULTS.memoryMin, s.memoryMax));
  s.width = clampInt(s.width, 640, 7680, DEFAULTS.width);
  s.height = clampInt(s.height, 480, 4320, DEFAULTS.height);
  s.fullscreen = Boolean(s.fullscreen);
  s.includeAddon = Boolean(s.includeAddon);
  s.showConsoleOnCrash = Boolean(s.showConsoleOnCrash);
  s.autoBackup = Boolean(s.autoBackup);
  s.autoUpdateMods = Boolean(s.autoUpdateMods);
  s.discord = Boolean(s.discord);
  s.language = ['auto', 'de', 'en'].includes(s.language) ? s.language : 'auto';
  s.javaPath = String(s.javaPath || '').slice(0, 500);
  s.jvmArgs = String(s.jvmArgs || '').replace(/[\r\n]+/g, ' ').slice(0, 1000);
  s.afterLaunch = ['keep', 'minimize', 'hide'].includes(s.afterLaunch) ? s.afterLaunch : DEFAULTS.afterLaunch;
  s.selectedVersion = isValidMinecraftVersion(s.selectedVersion) ? String(s.selectedVersion) : DEFAULTS.selectedVersion;
  s.selectedServerId = String(s.selectedServerId || DEFAULTS.selectedServerId).slice(0, 80);
  return s;
}

let cache = null;
function get() {
  if (!cache) {
    // Uebernahme aus dem alten Launcher: dort stand die Version in launcher-state.json.
    const legacy = loadJson(require('path').join(paths.dataRoot, 'launcher-state.json'), {});
    const stored = loadJson(paths.settingsFile, null);
    cache = normalize(stored || { selectedVersion: legacy.selectedVersion, selectedServerId: legacy.selectedServerId });
  }
  return { ...cache };
}

function set(patch = {}) {
  cache = normalize({ ...get(), ...patch });
  writeJson(paths.settingsFile, cache);
  return { ...cache };
}

function systemInfo() {
  return { totalMemoryMb: totalMb, maxAllowedMb: Math.max(1024, totalMb - 1024), platform: process.platform };
}

module.exports = { get, set, systemInfo, DEFAULTS };
