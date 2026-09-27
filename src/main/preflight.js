'use strict';
/**
 * Pruefung VOR dem Start: Stimmen die Mods zusammen?
 *
 * Bisher gab es nur die Absturz-Analyse -- also erst NACH dem Absturz. Die
 * haeufigsten Ursachen lassen sich aber schon vorher an den fabric.mod.json
 * der Jars erkennen:
 *
 *  1. FEHLENDE ABHAENGIGKEIT: eine Mod verlangt eine andere, die nicht da ist
 *     -> automatisch von Modrinth installieren (gleiche MC-Version, Fabric).
 *  2. DOPPELT: dieselbe Mod-ID in zwei Jars (Fabric bricht dann ab)
 *     -> die aeltere wird deaktiviert (nicht geloescht).
 *  3. UNVERTRAEGLICH: eine Mod erklaert "breaks" gegen eine andere, die
 *     installiert ist -> Warnung (automatisch abschalten waere zu frech:
 *     vielleicht will man gerade die eine statt der anderen).
 *
 * Mitgezaehlt werden auch Mods, die IN einer Jar stecken (Jar-in-Jar): die
 * Fabric API bringt so ihre ~40 Module mit, und viele Mods verlangen genau
 * diese Module einzeln.
 *
 * Vortex-Dateien (Client, Addon, Fabric API aus dem Launcher) werden nie
 * angefasst -- die verwaltet der Launcher selbst.
 */
const fs = require('fs');
const path = require('path');
const { log, compareVersions } = require('./core');
const instances = require('./instances');

/** Stellt die Umgebung selbst bereit -- nie als Mod installieren. */
const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'mixinextras']);

/** Alte Kurznamen -> heutige Mod-ID bzw. Modrinth-Projekt. */
const ALIAS = { fabric: 'fabric-api' };

const clean = v => String(v || '').split('+')[0];

/**
 * Deckt eine "breaks"-Bedingung jede Version ab? Nur dann warnen wir --
 * Versionsbereiche ("<1.2") koennen wir nicht sicher auswerten und wuerden
 * sonst Fehlalarme melden.
 */
const breaksAll = cond => /^\s*(\*|)\s*$/.test(String(cond || '')) || /^\s*>=?\s*0(\.0)*\s*$/.test(String(cond || ''));

/**
 * @param {string} version
 * @param {(id:string, v:string)=>Promise<any>} install Modrinth-Installation (modrinth.installMod)
 * @returns {Promise<{installed:string[], disabled:string[], warnings:string[]}>}
 */
async function run(version, install) {
  const v = instances.requireVersion(version);
  const result = { installed: [], disabled: [], warnings: [] };
  const managed = new Set(instances.activeBundle(v).map(n => n.toLowerCase()));
  let mods = instances.modsWithIds(v).filter(m => m.enabled && m.id);

  // --- 2. Doppelte Mod-IDs ----------------------------------------------------
  const byId = new Map();
  for (const m of mods) (byId.get(m.id) || byId.set(m.id, []).get(m.id)).push(m);
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    // Behalten: die vom Launcher verwaltete, sonst die neueste Version
    list.sort((a, b) => (managed.has(b.file.toLowerCase()) - managed.has(a.file.toLowerCase()))
      || compareVersions(clean(b.version), clean(a.version)));
    for (const extra of list.slice(1)) {
      if (managed.has(extra.file.toLowerCase())) continue;
      try {
        fs.renameSync(extra.path, `${extra.path}.disabled`);
        result.disabled.push(`${extra.name} ${clean(extra.version)}`);
        log(`Preflight: ${extra.file} disabled -- ${id} is installed twice.`);
      } catch (e) { result.warnings.push(`${extra.name} is installed twice. Remove one of them.`); }
    }
  }
  if (result.disabled.length) mods = instances.modsWithIds(v).filter(m => m.enabled && m.id);

  // --- Was ist vorhanden? (IDs, "provides", eingebettete Jars) ----------------
  const have = new Set();
  for (const m of mods) {
    have.add(m.id);
    for (const p of m.provides || []) have.add(p);
    for (const n of m.nested || []) have.add(n);
  }
  const hasApi = have.has('fabric-api');

  // --- 1. Fehlende Abhaengigkeiten -------------------------------------------
  const missing = new Map();          // dep -> [wer braucht es]
  for (const m of mods) {
    for (const raw of m.depends || []) {
      const dep = ALIAS[raw] || raw;
      if (BUILTIN.has(dep) || have.has(dep)) continue;
      // Einzelne Module der Fabric API ("fabric-networking-api-v1") sind da,
      // wenn die ganze Fabric API da ist -- auch wenn eine alte Fassung ein
      // Modul anders nennt.
      if (hasApi && /^fabric-.*-v\d+$/.test(dep)) continue;
      (missing.get(dep) || missing.set(dep, []).get(dep)).push(m.name);
    }
  }
  const versucht = new Set();
  for (const [dep, needers] of missing) {
    const target = /^fabric-.*-v\d+$/.test(dep) ? 'fabric-api' : dep;
    if (versucht.has(target)) continue;
    versucht.add(target);
    try {
      const r = await install(target, v);
      if (r?.installed?.length) {
        result.installed.push(...r.installed);
        log(`Preflight: ${target} installed (needed by ${needers.join(', ')}).`);
      }
    } catch (e) {
      result.warnings.push(`${needers.slice(0, 2).join(', ')} needs "${dep}", which could not be found on Modrinth.`);
    }
  }

  // --- 3. Unvertraegliche Mods ("breaks") -----------------------------------------
  const enabledIds = new Map(mods.map(m => [m.id, m]));
  for (const m of mods) {
    for (const [other, cond] of Object.entries(m.breaks || {})) {
      const o = enabledIds.get(other);
      if (o && o !== m && breaksAll(cond)) {
        result.warnings.push(`${m.name} does not work together with ${o.name}. Disable one of them.`);
      }
    }
  }
  return result;
}

module.exports = { run };
