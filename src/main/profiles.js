'use strict';
/**
 * Mod-Profile (Launcher 2.5): mehrere Mod-Zusammenstellungen je
 * Minecraft-Version, z. B. "PvP", "Survival mit Minimap", ein importiertes
 * Modpack. Umschalten mit einem Klick.
 *
 * Aufbau im Instanz-Ordner:
 *   vortex-profiles/state.json          { active, profiles:[{id,name,created,source}] }
 *   vortex-profiles/<id>/mods/          Mods des Profils, solange es NICHT aktiv ist
 *   vortex-profiles/<id>/config/        Mod-Einstellungen des Profils (ohne Vortex)
 *   vortex-profiles/<id>/projects.json  Modrinth-Zuordnung (fuer Updates)
 *
 * Das aktive Profil liegt ganz normal in mods/ und config/ -- Minecraft,
 * Export, Updates und alles andere sehen also keinen Unterschied. Beim
 * Umschalten werden nur die eigenen Dateien verschoben (rename, kein
 * Kopieren); Vortex-Dateien (Client, Addon, mitgelieferte Mods) und die
 * Vortex-Einstellungen bleiben immer, wo sie sind.
 *
 * Wenn beim Verschieben etwas schiefgeht (Datei gesperrt), wird alles
 * Verschobene zurueckgelegt -- es gibt keinen halben Zustand.
 */
const path = require('path');
const fs = require('fs');
const { shell } = require('electron');
const { paths, ensureDir, exists, loadJson, writeJson, log } = require('./core');
const instances = require('./instances');

const DEFAULT_ID = 'default';
const MAX_PROFILES = 30;

function root(v) { return path.join(paths.instanceRoot(v), 'vortex-profiles'); }
function stateFile(v) { return path.join(root(v), 'state.json'); }
function store(v, id) { return path.join(root(v), id); }

/** Gemeinsam fuer alle Profile: Vortex selbst, Fabric. */
function sharedConfig(name) { return /^(vortex|pvpclient|fabric)/i.test(name); }

function cleanName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!n) throw new Error('Please enter a name.');
  return n;
}

function loadState(v) {
  const s = loadJson(stateFile(v), null);
  const profiles = Array.isArray(s?.profiles) ? s.profiles.filter(p => p && /^[a-z0-9-]{1,48}$/.test(p.id)) : [];
  if (!profiles.some(p => p.id === DEFAULT_ID)) profiles.unshift({ id: DEFAULT_ID, name: 'Standard', created: 0, source: 'default' });
  const active = profiles.some(p => p.id === s?.active) ? s.active : DEFAULT_ID;
  return { active, profiles };
}
function saveState(v, s) { ensureDir(root(v)); writeJson(stateFile(v), s); }

function newId(s, name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'profile';
  let id = base, i = 2;
  while (id === DEFAULT_ID || s.profiles.some(p => p.id === id)) id = `${base}-${i++}`;
  return id;
}

/** Eigene (nicht von Vortex verwaltete) Mods, die gerade in mods/ liegen. */
function ownMods(v) {
  return instances.listMods(v).filter(m => !m.managed && m.source !== 'vortex' && m.source !== 'addon').map(m => m.file);
}
function ownConfig(v) {
  const dir = path.join(paths.instanceRoot(v), 'config');
  try { return fs.readdirSync(dir).filter(n => !sharedConfig(n)); } catch (_) { return []; }
}
function listDir(dir, filter = () => true) {
  try { return fs.readdirSync(dir).filter(filter); } catch (_) { return []; }
}
const isJar = n => /\.jar(\.disabled)?$/i.test(n);

function baseName(f) { return String(f).replace(/\.disabled$/i, '').toLowerCase(); }
function splitProjects(map, files) {
  const set = new Set(files.map(baseName));
  const mine = {}, rest = {};
  for (const [pid, rec] of Object.entries(map)) {
    const f = typeof rec === 'string' ? rec : rec?.fileName;
    (set.has(String(f || '').toLowerCase()) ? mine : rest)[pid] = rec;
  }
  return { mine, rest };
}

function laeuft(v) {
  try { return require('./launch').sessionList().some(x => x.version === v); } catch (_) { return false; }
}
function assertStopped(v) {
  if (laeuft(v)) throw new Error('Close Minecraft first -- the mods of a running game cannot be switched.');
}

/** Verschiebt mit Ruecknahme-Liste. */
function mover() {
  const done = [];
  return {
    move(from, to) {
      ensureDir(path.dirname(to));
      if (exists(to)) throw new Error(`${path.basename(to)} is in the way.`);
      fs.renameSync(from, to);
      done.push([from, to]);
    },
    rollback() {
      for (const [from, to] of done.reverse()) {
        try { fs.renameSync(to, from); } catch (e) { log(`Profile rollback: ${path.basename(to)}: ${e.message}`, 'warn'); }
      }
    }
  };
}

function list(version) {
  const v = instances.requireVersion(version);
  const s = loadState(v);
  return {
    active: s.active,
    running: laeuft(v),
    profiles: s.profiles.map(p => {
      const aktiv = p.id === s.active;
      const mods = aktiv ? ownMods(v) : listDir(path.join(store(v, p.id), 'mods'), isJar);
      return {
        id: p.id, name: p.name, created: p.created || 0, source: p.source || 'manual',
        active: aktiv,
        mods: mods.filter(n => !/\.disabled$/i.test(n)).length,
        disabled: mods.filter(n => /\.disabled$/i.test(n)).length
      };
    })
  };
}

function summaryName(version) {
  try { const s = loadState(version); return { profile: s.profiles.find(p => p.id === s.active)?.name || 'Standard', profiles: s.profiles.length }; }
  catch (_) { return { profile: 'Standard', profiles: 1 }; }
}

/** Aktives Profil in seinen Speicher legen (mods/ + config/ werden leer bis auf Vortex). */
function stash(v, id, mv) {
  const modsDir = paths.modsRoot(v);
  const cfgDir = path.join(paths.instanceRoot(v), 'config');
  const to = store(v, id);
  // Reste eines abgebrochenen Wechsels nicht ueberschreiben, sondern beiseitelegen.
  if (listDir(path.join(to, 'mods')).length || listDir(path.join(to, 'config')).length) {
    const alt = path.join(root(v), `.old-${id}-${Date.now()}`);
    fs.renameSync(to, alt);
    log(`${v}: leftover files of profile ${id} moved to ${path.basename(alt)}.`, 'warn');
  }
  const files = ownMods(v);
  for (const f of files) mv.move(path.join(modsDir, f), path.join(to, 'mods', f));
  for (const n of ownConfig(v)) mv.move(path.join(cfgDir, n), path.join(to, 'config', n));
  const { mine, rest } = splitProjects(instances.projectMap(v), files);
  return { mine, rest };
}

/** Profil aus seinem Speicher nach mods/ + config/ holen. */
function unstash(v, id, mv) {
  const modsDir = paths.modsRoot(v);
  const cfgDir = path.join(paths.instanceRoot(v), 'config');
  const from = store(v, id);
  ensureDir(modsDir);
  for (const f of listDir(path.join(from, 'mods'), isJar)) mv.move(path.join(from, 'mods', f), path.join(modsDir, f));
  for (const n of listDir(path.join(from, 'config'))) mv.move(path.join(from, 'config', n), path.join(cfgDir, n));
  return loadJson(path.join(from, 'projects.json'), {}) || {};
}

function switchTo(version, id) {
  const v = instances.requireVersion(version);
  assertStopped(v);
  const s = loadState(v);
  if (!s.profiles.some(p => p.id === id)) throw new Error('This profile does not exist.');
  if (s.active === id) return list(v);
  const mv = mover();
  try {
    const { mine, rest } = stash(v, s.active, mv);
    const theirs = unstash(v, id, mv);
    // Erst wenn alle Dateien liegen, die Zuordnungen schreiben.
    writeJson(path.join(store(v, s.active), 'projects.json'), mine);
    instances.saveProjectMap(v, { ...rest, ...theirs });
    try { fs.rmSync(path.join(store(v, id), 'projects.json'), { force: true }); } catch (_) {}
  } catch (e) {
    mv.rollback();
    log(`${v}: switching profile failed: ${e.message}`, 'warn');
    throw new Error(`Could not switch the profile: ${e.code === 'EBUSY' || e.code === 'EPERM' ? 'a file is in use. Close Minecraft and try again.' : e.message}`);
  }
  s.active = id;
  saveState(v, s);
  instances.markChanged(v);
  log(`${v}: profile "${s.profiles.find(p => p.id === id).name}" active.`);
  return list(v);
}

/**
 * Neues Profil. from: 'empty' | Profil-ID (Kopie davon, auch das aktive).
 * Wird nicht aktiviert -- das macht der Aufrufer (UI fragt).
 */
function create(version, name, from = 'empty', source = 'manual') {
  const v = instances.requireVersion(version);
  const s = loadState(v);
  if (s.profiles.length >= MAX_PROFILES) throw new Error(`At most ${MAX_PROFILES} profiles per version.`);
  const n = cleanName(name);
  if (s.profiles.some(p => p.name.toLowerCase() === n.toLowerCase())) throw new Error('A profile with this name already exists.');
  const id = newId(s, n);
  const dir = store(v, id);
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(path.join(dir, 'mods'));
  if (from && from !== 'empty') {
    const src = s.profiles.find(p => p.id === from);
    if (!src) throw new Error('This profile does not exist.');
    if (src.id === s.active) {
      const files = ownMods(v);
      for (const f of files) fs.copyFileSync(path.join(paths.modsRoot(v), f), path.join(dir, 'mods', f));
      const cfg = path.join(paths.instanceRoot(v), 'config');
      ensureDir(path.join(dir, 'config'));
      for (const c of ownConfig(v)) fs.cpSync(path.join(cfg, c), path.join(dir, 'config', c), { recursive: true });
      writeJson(path.join(dir, 'projects.json'), splitProjects(instances.projectMap(v), files).mine);
    } else {
      fs.cpSync(store(v, src.id), dir, { recursive: true });
    }
  }
  s.profiles.push({ id, name: n, created: Date.now(), source });
  saveState(v, s);
  return { id, ...list(v) };
}

function rename(version, id, name) {
  const v = instances.requireVersion(version);
  const s = loadState(v);
  const p = s.profiles.find(x => x.id === id);
  if (!p) throw new Error('This profile does not exist.');
  const n = cleanName(name);
  if (s.profiles.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('A profile with this name already exists.');
  p.name = n;
  saveState(v, s);
  return list(v);
}

async function remove(version, id) {
  const v = instances.requireVersion(version);
  const s = loadState(v);
  if (id === s.active) throw new Error('Switch to another profile first.');
  if (id === DEFAULT_ID) throw new Error('The standard profile cannot be removed.');
  const p = s.profiles.find(x => x.id === id);
  if (!p) return list(v);
  const dir = store(v, id);
  // In den Papierkorb: ein Fehlklick kostet so nichts.
  if (exists(dir)) { try { await shell.trashItem(dir); } catch (_) { fs.rmSync(dir, { recursive: true, force: true }); } }
  s.profiles = s.profiles.filter(x => x.id !== id);
  saveState(v, s);
  return list(v);
}

/** Fuer den Modpack-Import: neues leeres Profil anlegen und aktivieren. */
function createAndActivate(version, name, source) {
  const v = instances.requireVersion(version);
  assertStopped(v);
  const s = loadState(v);
  let n = cleanName(name || 'Modpack'), i = 2;
  const base = n;
  while (s.profiles.some(p => p.name.toLowerCase() === n.toLowerCase())) n = `${base.slice(0, 36)} (${i++})`;
  const r = create(v, n, 'empty', source);
  switchTo(v, r.id);
  return r.id;
}

module.exports = { list, switchTo, create, rename, remove, createAndActivate, summaryName, DEFAULT_ID, sharedConfig };
