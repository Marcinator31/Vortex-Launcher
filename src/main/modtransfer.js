'use strict';
/**
 * Mods beim ersten Versionswechsel mitnehmen (2.5.0).
 *
 * Wer z. B. von 26.2 zum ersten Mal auf 1.21.11 wechselt, hat dort keine
 * seiner Mods. Der Launcher bietet dann EINMAL an, alle eigenen Mods der
 * bisherigen Version auch fuer die neue herunterzuladen -- in der Fassung
 * fuer die neue Minecraft-Version (Modrinth, per Pruefsumme der Jar),
 * samt Pflicht-Abhaengigkeiten.
 *
 * Gefragt wird pro Richtung ("26.2 > 1.21.11") genau einmal -- egal ob mit
 * Ja oder Nein beantwortet -- und nur, wenn in der neuen Version wirklich
 * Mods fehlen. Vortex Client, Addon und mitgelieferte Mods (Fabric API usw.)
 * zaehlen nicht; die bringt der Launcher selbst fuer jede Version mit.
 *
 * Die Arbeit macht derselbe Code wie "Profil aus anderem Launcher
 * uebernehmen" (importer.importProfile): Mods ohne Modrinth-Eintrag werden
 * nur kopiert, wenn sie laut fabric.mod.json auch zur neuen Version passen.
 * In der alten Version wird nichts veraendert.
 */
const path = require('path');
const { paths, loadJson, writeJson, log } = require('./core');
const instances = require('./instances');

const FILE = () => path.join(paths.dataRoot, 'mod-transfer.json');
const key = (from, to) => `${from}>${to}`;

function gefragt() {
  const d = loadJson(FILE(), {});
  return d && typeof d.asked === 'object' && d.asked ? d.asked : {};
}

function merke(from, to, antwort) {
  const asked = gefragt();
  asked[key(from, to)] = { answer: antwort, at: Date.now() };
  writeJson(FILE(), { asked });
}

/** Eigene, eingeschaltete Mods einer Version (ohne Vortex & Mitgeliefertes). */
function eigeneMods(v) {
  try { return instances.listMods(v).filter(m => m.enabled && (m.source === 'modrinth' || m.source === 'local')); } catch (_) { return []; }
}

/** Welche eigenen Mods aus "from" fehlen in "to"? */
function fehlende(from, to) {
  const ziel = instances.modsWithIds(to);
  const ids = new Set();
  const namen = new Set();
  for (const m of ziel) {
    if (m.id) ids.add(m.id);
    for (const p of m.provides || []) ids.add(p);
    namen.add(m.file.replace(/\.disabled$/i, '').toLowerCase());
  }
  return eigeneMods(from).filter(m => m.id ? !ids.has(m.id) : !namen.has(m.file.toLowerCase()));
}

/**
 * Soll beim Wechsel von "from" nach "to" gefragt werden?
 * @returns {null | {from, to, mods: {name, version}[]}}
 */
function angebot(from, to) {
  if (!from || !to || from === to) return null;
  try { instances.requireVersion(from); instances.requireVersion(to); } catch (_) { return null; }
  // Zwischen alten (1.8.9, Legacy Fabric) und neuen Versionen gibt es keine
  // gemeinsamen Mods -- AppleSkin, Shulker-Vorschau usw. existieren fuer 1.8 nicht.
  const { isLegacyVersion } = require('./core');
  if (isLegacyVersion(from) || isLegacyVersion(to)) return null;
  if (gefragt()[key(from, to)]) return null;
  const mods = fehlende(from, to);
  if (!mods.length) return null;
  return { from, to, mods: mods.map(m => ({ name: m.name, version: m.version || '' })) };
}

function ablehnen(from, to) {
  if (from && to) merke(String(from), String(to), 'no');
  return {};
}

/** Fehlende Mods (und auf Wunsch deren Einstellungen) nach "to" holen. */
async function uebertragen(from, to, opts, importer, modrinth) {
  const a = instances.requireVersion(from);
  const b = instances.requireVersion(to);
  const mods = fehlende(a, b);
  merke(a, b, 'yes');
  const profil = {
    launcherName: 'Vortex Launcher', name: `Minecraft ${a}`,
    gameDir: paths.instanceRoot(a),
    mods: mods.map(m => path.join(paths.modsRoot(a), m.file))
  };
  const r = await importer.importProfile(profil, b, { mods: true, config: Boolean(opts && opts.config) }, modrinth);
  log(`Mods from ${a} to ${b}: ${r.installed.length} downloaded, ${r.copied.length} copied, ${r.unavailable.length} not available.`);
  return r;
}

module.exports = { angebot, ablehnen, uebertragen };
