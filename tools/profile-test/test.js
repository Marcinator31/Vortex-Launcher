'use strict';
/**
 * Test fuer die Mod-Profile (src/main/profiles.js) ohne Electron:
 * electron wird ersetzt, Daten landen in einem Temp-Ordner.
 *   node tools/profile-test/test.js
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-prof-'));
const trash = [];
const fakeElectron = {
  app: { getPath: () => tmp, getVersion: () => '0.0.0', isPackaged: false, getAppPath: () => path.join(__dirname, '..', '..') },
  shell: { trashItem: async p => { trash.push(p); fs.rmSync(p, { recursive: true, force: true }); } },
  BrowserWindow: { getAllWindows: () => [] }
};
const load = Module._load;
let running = false;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return fakeElectron;
  if (req === './launch' && parent && /profiles\.js$/.test(parent.filename)) return { sessionList: () => running ? [{ version: V }] : [] };
  return load.apply(this, arguments);
};

const src = path.join(__dirname, '..', '..', 'src', 'main');
const core = require(path.join(src, 'core'));
const instances = require(path.join(src, 'instances'));
const profiles = require(path.join(src, 'profiles'));

// Eine eigene (nicht von Vortex verwaltete) Version nehmen, damit keine Bundle-Dateien noetig sind.
const V = '1.20.1';
const { paths } = core;
// Version bekannt machen, ohne Netz
core.writeJson(paths.customVersionsFile, [V]);
instances.requireVersion(V);

const mods = paths.modsRoot(V);
const cfg = path.join(paths.instanceRoot(V), 'config');
fs.mkdirSync(mods, { recursive: true });
fs.mkdirSync(path.join(cfg, 'sodium'), { recursive: true });
const jar = (name) => fs.writeFileSync(path.join(mods, name), 'PK-fake-' + name);
jar('sodium-0.5.jar'); jar('iris-1.7.jar'); jar('minimap.jar.disabled');
fs.writeFileSync(path.join(cfg, 'sodium', 'options.json'), '{"a":1}');
fs.writeFileSync(path.join(cfg, 'vortexclient.json'), '{"vortex":true}');
fs.writeFileSync(path.join(cfg, 'iris.properties'), 'x=1');
instances.saveProjectMap(V, { AANT: { fileName: 'sodium-0.5.jar', title: 'Sodium' }, OTHER: { fileName: 'gone.jar' } });

const names = () => fs.readdirSync(mods).sort();
const cfgs = () => fs.readdirSync(cfg).sort();

let r = profiles.list(V);
assert.strictEqual(r.active, 'default');
assert.strictEqual(r.profiles.length, 1);
assert.strictEqual(r.profiles[0].mods, 2);
assert.strictEqual(r.profiles[0].disabled, 1);

// leeres Profil anlegen + aktivieren
r = profiles.create(V, 'PvP', 'empty');
assert.strictEqual(r.id, 'pvp');
profiles.switchTo(V, 'pvp');
assert.deepStrictEqual(names(), [], 'mods/ leer im neuen Profil');
assert.deepStrictEqual(cfgs(), ['vortexclient.json'], 'nur Vortex-Einstellungen bleiben');
assert.deepStrictEqual(Object.keys(instances.projectMap(V)), ['OTHER'], 'Modrinth-Zuordnung wandert mit');
jar('pvp-hud.jar');
fs.writeFileSync(path.join(cfg, 'pvphud.json'), '{}');

// zurueck
r = profiles.switchTo(V, 'default');
assert.deepStrictEqual(names(), ['iris-1.7.jar', 'minimap.jar.disabled', 'sodium-0.5.jar']);
assert.deepStrictEqual(cfgs(), ['iris.properties', 'sodium', 'vortexclient.json']);
assert.strictEqual(fs.readFileSync(path.join(cfg, 'sodium', 'options.json'), 'utf8'), '{"a":1}');
assert.ok(instances.projectMap(V).AANT, 'Sodium-Zuordnung wieder da');
assert.strictEqual(r.profiles.find(p => p.id === 'pvp').mods, 1);

// Kopie des aktiven
r = profiles.create(V, 'Survival', 'default');
profiles.switchTo(V, r.id);
assert.deepStrictEqual(names(), ['iris-1.7.jar', 'minimap.jar.disabled', 'sodium-0.5.jar']);
assert.ok(instances.projectMap(V).AANT);
fs.rmSync(path.join(mods, 'iris-1.7.jar'));
profiles.switchTo(V, 'default');
assert.ok(names().includes('iris-1.7.jar'), 'Original unveraendert');

// Doppelter Name, ungueltige Namen
assert.throws(() => profiles.create(V, 'pvp'), /already exists/);
assert.throws(() => profiles.create(V, '   '), /enter a name/);

// Laufendes Spiel blockiert
running = true;
assert.throws(() => profiles.switchTo(V, 'pvp'), /Close Minecraft/);
running = false;

// Gesperrte Datei -> komplette Ruecknahme
const realRename = fs.renameSync;
let calls = 0;
fs.renameSync = function (a, b) { if (++calls === 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return realRename.apply(this, arguments); };
assert.throws(() => profiles.switchTo(V, 'pvp'), /in use/);
fs.renameSync = realRename;
assert.deepStrictEqual(names(), ['iris-1.7.jar', 'minimap.jar.disabled', 'sodium-0.5.jar'], 'nach Fehler alles wie vorher');
assert.strictEqual(profiles.list(V).active, 'default');
profiles.switchTo(V, 'pvp');
assert.deepStrictEqual(names(), ['pvp-hud.jar']);
assert.ok(cfgs().includes('pvphud.json'));
profiles.switchTo(V, 'default');

// Umbenennen, Loeschen
profiles.rename(V, 'pvp', 'PvP 1.8 Feel');
assert.strictEqual(profiles.list(V).profiles.find(p => p.id === 'pvp').name, 'PvP 1.8 Feel');
(async () => {
  await assert.rejects(() => profiles.remove(V, 'default'), /Switch to another|standard/);
  await profiles.remove(V, 'pvp');
  assert.ok(!profiles.list(V).profiles.some(p => p.id === 'pvp'));
  assert.strictEqual(trash.length, 1);

  // createAndActivate (Modpack-Import) mit Namenskonflikt
  const id1 = profiles.createAndActivate(V, 'Fabulously Optimized');
  profiles.switchTo(V, 'default');
  const id2 = profiles.createAndActivate(V, 'Fabulously Optimized');
  assert.notStrictEqual(id1, id2);
  assert.strictEqual(profiles.list(V).profiles.find(p => p.id === id2).name, 'Fabulously Optimized (2)');
  assert.deepStrictEqual(names(), []);
  profiles.switchTo(V, 'default');
  assert.deepStrictEqual(names(), ['iris-1.7.jar', 'minimap.jar.disabled', 'sodium-0.5.jar']);
  console.log('PROFILE TESTS PASSED');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
