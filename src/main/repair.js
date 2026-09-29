'use strict';
/**
 * Instanz gruendlich pruefen und reparieren (2.4.0).
 *
 * "Pruefen & reparieren" hat bisher nur Fabric und die Vortex-Dateien
 * eingerichtet. Kaputte Spieldateien (abgebrochener Download, voller
 * Datentraeger, Virenscanner) blieben liegen -- der Launcher sah nur, DASS
 * eine Datei da ist, nicht ob sie stimmt.
 *
 * Jetzt wird jede Datei mit der Pruefsumme verglichen, die Mojang/Fabric
 * dafuer angeben: Client-Jar, Bibliotheken, Asset-Index und alle Assets.
 * Was nicht stimmt, wird geloescht -- der naechste Start laedt es frisch.
 * Kaputte Mod-Jars (kein gueltiges ZIP) werden ausgeschaltet.
 *
 * NIE angefasst: Welten, Einstellungen (options.txt, config/), Screenshots,
 * Resource Packs und Shader.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths, exists, loadJson, log } = require('./core');
const instances = require('./instances');

const pause = () => new Promise(r => setImmediate(r));

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/** "net.fabricmc:fabric-loader:0.19.3" -> "net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar" */
function mavenPfad(name) {
  const [g, a, v, klass] = String(name || '').split(':');
  if (!g || !a || !v) return null;
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${klass ? `-${klass}` : ''}.jar`;
}

/**
 * @param {string} version
 * @param {(p:{label:string, percent:number|null})=>void} melde
 */
async function run(version, melde = () => {}) {
  const v = instances.requireVersion(version);
  const root = paths.instanceRoot(v);
  const start = Date.now();
  const bericht = { version: v, checked: 0, replaced: [], disabledMods: [], missingIndex: false, durationMs: 0 };

  // Liste aller zu pruefenden Dateien: [Pfad, sha1, Anzeigename]
  const liste = [];
  const vanilla = loadJson(path.join(root, 'versions', v, `${v}.json`), null);
  if (vanilla) {
    const c = vanilla.downloads?.client;
    if (c?.sha1) liste.push([path.join(root, 'versions', v, `${v}.jar`), c.sha1, `Minecraft ${v}`]);
    for (const lib of vanilla.libraries || []) {
      const art = lib.downloads?.artifact;
      if (art?.path && art?.sha1) liste.push([path.join(root, 'libraries', art.path), art.sha1, path.basename(art.path)]);
      for (const cl of Object.values(lib.downloads?.classifiers || {})) {
        if (cl?.path && cl?.sha1) liste.push([path.join(root, 'libraries', cl.path), cl.sha1, path.basename(cl.path)]);
      }
    }
  }
  // Fabric-Profil(e): Bibliotheken mit Pruefsumme (Fabric gibt nicht fuer alle eine an)
  try {
    for (const d of fs.readdirSync(path.join(root, 'versions'))) {
      if (d === v) continue;
      const prof = loadJson(path.join(root, 'versions', d, `${d}.json`), null);
      for (const lib of prof?.libraries || []) {
        const p = mavenPfad(lib.name);
        if (p && lib.sha1) liste.push([path.join(root, 'libraries', p), lib.sha1, path.basename(p)]);
      }
    }
  } catch (_) {}

  // Assets: erst den Index selbst, dann jedes Objekt
  let objekte = [];
  const ai = vanilla?.assetIndex;
  if (ai?.id) {
    const indexDatei = path.join(root, 'assets', 'indexes', `${ai.id}.json`);
    let indexOk = exists(indexDatei);
    if (indexOk && ai.sha1) {
      try { indexOk = sha1(indexDatei) === ai.sha1; } catch (_) { indexOk = false; }
      if (!indexOk) { fs.rmSync(indexDatei, { force: true }); bericht.replaced.push(`Asset index ${ai.id}`); }
    }
    if (indexOk) {
      const idx = loadJson(indexDatei, {});
      objekte = Object.entries(idx.objects || {}).map(([name, o]) => [path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash), o.hash, name, o.size]);
    } else {
      bericht.missingIndex = true;
    }
  }

  const gesamt = liste.length + objekte.length;
  let n = 0, letzteMeldung = 0;
  const fortschritt = label => {
    const jetzt = Date.now();
    if (jetzt - letzteMeldung < 150) return;
    letzteMeldung = jetzt;
    melde({ label, percent: gesamt ? Math.round(n / gesamt * 100) : null });
  };

  for (const [datei, soll, name] of liste) {
    n++;
    if (!exists(datei)) continue;          // fehlt: laedt der naechste Start ohnehin
    bericht.checked++;
    let ok = false;
    try { ok = sha1(datei) === soll; } catch (_) {}
    if (!ok) { fs.rmSync(datei, { force: true }); bericht.replaced.push(name); }
    fortschritt('Checking game files');
    if (n % 20 === 0) await pause();
  }
  for (const [datei, soll, name, groesse] of objekte) {
    n++;
    if (!exists(datei)) continue;
    bericht.checked++;
    let ok = false;
    try {
      // Groesse zuerst: schnell und faengt abgebrochene Downloads
      ok = fs.statSync(datei).size === groesse && sha1(datei) === soll;
    } catch (_) {}
    if (!ok) { fs.rmSync(datei, { force: true }); bericht.replaced.push(name); }
    fortschritt('Checking assets');
    if (n % 40 === 0) await pause();
  }

  // Mods: jede Jar muss ein gueltiges ZIP sein
  melde({ label: 'Checking mods', percent: 100 });
  const zip = require('./zip');
  const verwaltet = new Set(instances.activeBundle(v).map(x => x.toLowerCase()));
  let vortexKaputt = false;
  for (const m of instances.modsWithIds(v)) {
    if (!m.enabled) continue;
    let gut = false;
    try { gut = Boolean(zip.readEntries(fs.readFileSync(m.path))); } catch (_) {}
    if (gut) continue;
    if (verwaltet.has(m.file.toLowerCase())) {
      fs.rmSync(m.path, { force: true });
      vortexKaputt = true;
      bericht.replaced.push(m.file);
    } else {
      try { instances.toggleMod(v, m.file); bericht.disabledMods.push(m.name || m.file); } catch (_) {}
    }
    await pause();
  }
  // Vortex-Dateien neu einspielen, falls eine kaputt war
  if (vortexKaputt) { try { instances.syncBundled(v); } catch (e) { log(`Repair: Vortex files: ${e.message}`, 'warn'); } }

  bericht.durationMs = Date.now() - start;
  log(`Repair of ${v}: ${bericht.checked} files checked, ${bericht.replaced.length} replaced, ${bericht.disabledMods.length} broken mod(s) disabled (${Math.round(bericht.durationMs / 1000)} s).`);
  melde({ label: 'Done', percent: 100, done: true });
  return bericht;
}

module.exports = { run };
