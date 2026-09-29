'use strict';
/**
 * Abgesicherter Modus: Minecraft einmal NUR mit den Vortex-Dateien und der
 * Fabric API starten (plus dem, was diese selbst brauchen).
 *
 * Wozu: Stuerzt das Spiel ab und die Analyse findet keinen klaren Schuldigen,
 * zeigt ein Start im abgesicherten Modus sofort, ob es an einer eigenen Mod
 * liegt. Laeuft es so, war es eine der ausgeschalteten.
 *
 * Die ausgeschalteten Mods werden in safe-mode.json gemerkt und nach dem
 * Spielende wieder eingeschaltet. Stuerzt der Launcher dazwischen ab, holt der
 * naechste Start das nach (restoreLeftovers) -- es bleibt nichts aus.
 */
const path = require('path');
const { paths, log, loadJson, writeJson, exists } = require('./core');
const instances = require('./instances');

const file = () => path.join(paths.dataRoot, 'safe-mode.json');
const BASIS = new Set(['fabric-api', 'fabric', 'fabricloader', 'java', 'minecraft']);

function state() {
  const d = loadJson(file(), {});
  return d && typeof d === 'object' ? d : {};
}

/** Schaltet alle eigenen Mods aus. Gibt die Anzahl zurueck. */
function enter(version) {
  const mods = instances.modsWithIds(version);
  const managed = new Set(instances.activeBundle(version).map(n => n.toLowerCase()));
  // Was bleibt an: Vortex-Dateien, Fabric API und deren Abhaengigkeiten.
  const behalten = new Set();
  const ids = new Set(BASIS);
  for (const m of mods) {
    if (!m.enabled) continue;
    if (managed.has(m.file.toLowerCase()) || BASIS.has(m.id)) {
      behalten.add(m.file);
      for (const d of m.depends || []) ids.add(d);
    }
  }
  // Abhaengigkeiten der behaltenen Mods ebenfalls behalten (zwei Runden reichen praktisch immer).
  for (let runde = 0; runde < 3; runde++) {
    for (const m of mods) {
      if (!m.enabled || behalten.has(m.file)) continue;
      if (ids.has(m.id) || (m.provides || []).some(p => ids.has(p))) {
        behalten.add(m.file);
        for (const d of m.depends || []) ids.add(d);
      }
    }
  }
  const aus = [];
  for (const m of mods) {
    if (!m.enabled || behalten.has(m.file)) continue;
    try {
      instances.toggleMod(version, m.file);
      aus.push(`${m.file}.disabled`);
    } catch (e) {
      log(`Safe mode: ${m.file} could not be switched off: ${e.message}`, 'warn');
    }
  }
  const s = state();
  s[version] = [...new Set([...(s[version] || []), ...aus])];
  writeJson(file(), s);
  log(`Safe mode for ${version}: ${aus.length} mod(s) switched off for this start.`);
  return aus.length;
}

/** Nach dem Spiel: alles wieder einschalten, was der abgesicherte Modus ausgeschaltet hat. */
function leave(version) {
  const s = state();
  const liste = s[version] || [];
  let n = 0;
  for (const f of liste) {
    try {
      if (exists(path.join(paths.modsRoot(version), f))) { instances.toggleMod(version, f); n++; }
    } catch (e) {
      log(`Safe mode: ${f} could not be switched back on: ${e.message}`, 'warn');
    }
  }
  delete s[version];
  writeJson(file(), s);
  if (n) log(`Safe mode for ${version} ended: ${n} mod(s) switched back on.`);
  return n;
}

function active(version) {
  return Boolean(state()[version]);
}

/** Beim Launcher-Start: Reste eines abgebrochenen abgesicherten Starts aufraeumen. */
function restoreLeftovers() {
  for (const v of Object.keys(state())) {
    try { leave(v); } catch (e) { log(`Safe mode cleanup for ${v}: ${e.message}`, 'warn'); }
  }
}

module.exports = { enter, leave, active, restoreLeftovers };
