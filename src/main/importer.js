'use strict';
/**
 * Profile aus anderen Launchern uebernehmen: Mods, Configs, Resource Packs,
 * Shader, Einstellungen/Tastenbelegung und Server.
 *
 * ERKANNT (Pfade und Dateiformate aus dem Quellcode der Launcher geprueft,
 * Stand September 2026 -- Lunar ist Closed Source, dort nur das Belegte):
 *   Modrinth App   %APPDATA%\ModrinthApp\app.db (SQLite) + profiles\<path>\
 *                  (alt: com.modrinth.theseus\profiles\<name>\profile.json)
 *   NoRisk Client  %APPDATA%\norisk\NoRiskClientV3\meta\app.db (SQLite)
 *                  (alt: profiles.json), Mods im gemeinsamen meta\mod_cache\
 *   CurseForge     %USERPROFILE%\curseforge\minecraft\Instances\<n>\minecraftinstance.json
 *   Prism/MultiMC  %APPDATA%\PrismLauncher\instances\<n>\mmc-pack.json + minecraft\
 *   ATLauncher     %APPDATA%\ATLauncher\instances\<n>\instance.json
 *   GDLauncher     %APPDATA%\gdlauncher_carbon\data\instances\<n>\instance.json + instance\
 *   Lunar Client   Spielordner = %APPDATA%\.minecraft, Fabric-Mods in
 *                  %USERPROFILE%\.lunarclient\profiles\<id>\mods. Lunars
 *                  eigene Modul-Einstellungen sind ein geschlossenes Format
 *                  und lassen sich nicht uebertragen.
 *   Minecraft      %APPDATA%\.minecraft
 *   + jeder Ordner von Hand
 *
 * MODS FUER DIE RICHTIGE VERSION: Jede Jar wird per SHA-1 bei Modrinth
 * nachgeschlagen ("version_files/update") -- so kommt dieselbe Mod in der
 * Fassung fuer DEINE Minecraft-Version und fuer Fabric, samt Abhaengigkeiten.
 * Unbekannte Jars werden nur kopiert, wenn sie zu Fabric und zur Version passen.
 *
 * Nichts wird im anderen Launcher veraendert -- nur gelesen.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths, exists, ensureDir, loadJson, log, send } = require('./core');
const instances = require('./instances');
const servers = require('./servers');
const { readModInfo } = require('./jarinfo');

const HOME = os.homedir();
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const APPDATA = process.env.APPDATA || (MAC ? path.join(HOME, 'Library', 'Application Support') : path.join(HOME, '.local', 'share'));
const DOT_MINECRAFT = WIN ? path.join(APPDATA, '.minecraft') : MAC ? path.join(HOME, 'Library', 'Application Support', 'minecraft') : path.join(HOME, '.minecraft');

const LAUNCHERS = {
  modrinth: 'Modrinth App', norisk: 'NoRisk Client', curseforge: 'CurseForge', prism: 'Prism Launcher',
  multimc: 'MultiMC', atlauncher: 'ATLauncher', gdlauncher: 'GDLauncher', lunar: 'Lunar Client', vanilla: 'Minecraft Launcher', folder: 'Folder'
};

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const list = dir => { try { return fs.readdirSync(dir); } catch (_) { return []; } };
const jars = dir => list(dir).filter(n => /\.jar$/i.test(n)).map(n => path.join(dir, n));

/** SQLite-Datei lesen, ohne den anderen Launcher zu stoeren: Kopie oeffnen (WAL mit). */
function withDb(file, fn) {
  if (!exists(file)) return null;
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch (_) { return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-import-'));
  try {
    for (const ext of ['', '-wal', '-shm']) if (exists(file + ext)) fs.copyFileSync(file + ext, path.join(tmp, `db${ext}`));
    const db = new sqlite.DatabaseSync(path.join(tmp, 'db'));
    try { return fn(db); } finally { try { db.close(); } catch (_) {} }
  } catch (e) {
    log(`Import: ${file}: ${e.message}`, 'warn');
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}
const q = (db, sql, ...args) => { try { return db.prepare(sql).all(...args); } catch (_) { return null; } };

/** Wenn Metadaten fehlen: Minecraft-Version aus den Mods ablesen. */
function guessVersion(modFiles) {
  const count = new Map();
  for (const f of modFiles.slice(0, 40)) {
    const m = String(readModInfo(f)?.minecraft || '').match(/(\d+\.\d+(?:\.\d+)?)/);
    if (m) count.set(m[1], (count.get(m[1]) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function profile(launcher, name, gameDir, { gameVersion = null, loader = null, mods = null, note = null } = {}) {
  const modFiles = [...new Set(mods || jars(path.join(gameDir, 'mods')))].filter(f => exists(f));
  return {
    id: crypto.createHash('sha1').update(`${launcher}|${gameDir}|${name}`).digest('hex').slice(0, 12),
    launcher, launcherName: LAUNCHERS[launcher] || launcher, name: String(name || path.basename(gameDir)),
    gameDir, gameVersion: gameVersion || guessVersion(modFiles), loader: loader ? String(loader).toLowerCase() : null,
    mods: modFiles, note,
    has: {
      config: isDir(path.join(gameDir, 'config')), resourcepacks: list(path.join(gameDir, 'resourcepacks')).length > 0,
      shaderpacks: list(path.join(gameDir, 'shaderpacks')).length > 0, options: exists(path.join(gameDir, 'options.txt')),
      servers: exists(path.join(gameDir, 'servers.dat'))
    }
  };
}

// ---------------------------------------------------------------------------
// Launcher erkennen
// ---------------------------------------------------------------------------

function modrinthApp() {
  const out = [];
  const root = path.join(APPDATA, 'ModrinthApp');
  const rows = withDb(path.join(root, 'app.db'), db => {
    let profilesDir = path.join(root, 'profiles');
    const custom = q(db, 'SELECT custom_dir FROM settings LIMIT 1')?.[0]?.custom_dir;
    if (custom && isDir(path.join(custom, 'profiles'))) profilesDir = path.join(custom, 'profiles');
    const neu = q(db, `SELECT i.path AS path, i.name AS name, s.game_version AS gv, s.loader AS loader
                       FROM instances i LEFT JOIN instance_content_sets s ON s.id = i.applied_content_set_id`);
    const alt = neu && neu.length ? neu : q(db, 'SELECT path, name, game_version AS gv, mod_loader AS loader FROM profiles');
    return (alt || []).map(r => ({ ...r, dir: path.join(profilesDir, ...String(r.path).split('/')) }));
  }) || [];
  for (const r of rows) if (isDir(r.dir)) out.push(profile('modrinth', r.name, r.dir, { gameVersion: r.gv, loader: r.loader }));
  // Alte Modrinth App (Theseus)
  const theseus = path.join(APPDATA, 'com.modrinth.theseus', 'profiles');
  for (const n of list(theseus)) {
    const meta = loadJson(path.join(theseus, n, 'profile.json'), null)?.metadata;
    if (meta) out.push(profile('modrinth', meta.name || n, path.join(theseus, n), { gameVersion: meta.game_version, loader: meta.loader }));
  }
  return out;
}

function noRisk() {
  const out = [];
  const root = WIN ? path.join(APPDATA, 'norisk', 'NoRiskClientV3')
    : MAC ? path.join(HOME, 'Library', 'Application Support', 'gg.norisk.NoRiskClientV3') : path.join(HOME, '.local', 'share', 'noriskclientv3');
  if (!isDir(root)) return out;
  const custom = loadJson(path.join(root, 'launcher_config.json'), {})?.custom_game_directory || null;
  const dataRoot = custom || (WIN ? path.join(root, 'data') : root);
  const profilesDir = path.join(dataRoot, 'profiles');
  const cache = custom ? path.join(custom, 'mod_cache') : path.join(root, 'meta', 'mod_cache');

  const gameDirOf = p => {
    const normal = path.join(profilesDir, ...String(p.path || '').split('/'));
    const group = String(p.group_name ?? p.group ?? '').toLowerCase();
    if (p.use_shared_minecraft_folder && group && !['server', 'modpacks'].includes(group)) {
      const shared = /norisk/.test(group) ? path.join(profilesDir, 'noriskclient', 'new') : path.join(profilesDir, 'groups', group.replace(/[^a-z0-9._-]/g, '_'));
      if (isDir(shared)) return shared;
    }
    return normal;
  };
  const localMods = dir => [
    ...jars(path.join(dir, 'mods')),
    ...list(path.join(dir, 'mods')).filter(n => /^nrc-/.test(n)).flatMap(n => jars(path.join(dir, 'mods', n))),
    ...jars(path.join(dir, 'custom_mods'))
  ];

  const fromDb = withDb(path.join(root, 'meta', 'app.db'), db => {
    const profs = q(db, 'SELECT id, name, path, game_version, loader, group_name, use_shared_minecraft_folder FROM profiles') || [];
    const cols = (q(db, 'PRAGMA table_info(profile_mods)') || []).map(c => c.name);
    const fk = cols.find(c => /profile/.test(c) && c !== 'profile_mods');
    return profs.map(p => ({
      ...p,
      files: fk ? (q(db, `SELECT file_name, enabled FROM profile_mods WHERE ${fk} = ?`, p.id) || []).filter(m => m.enabled !== 0).map(m => path.join(cache, String(m.file_name))) : []
    }));
  });
  const profs = fromDb && fromDb.length ? fromDb
    : (loadJson(path.join(root, 'profiles.json'), null) || []).map(p => ({
      ...p, files: (p.mods || []).filter(m => m.enabled !== false).map(m => m.source?.file_name || m.file_name).filter(Boolean).map(f => path.join(cache, f))
    }));
  for (const p of profs) {
    const dir = gameDirOf(p);
    if (!isDir(dir)) continue;
    out.push(profile('norisk', p.name, dir, { gameVersion: p.game_version, loader: p.loader, mods: [...p.files, ...localMods(dir)], note: 'NoRisk\'s own client mods are not copied -- Vortex replaces them.' }));
  }
  return out;
}

function curseForge() {
  const out = [];
  for (const base of [path.join(HOME, 'curseforge', 'minecraft', 'Instances'), path.join(HOME, 'Documents', 'curseforge', 'minecraft', 'Instances')]) {
    for (const n of list(base)) {
      const dir = path.join(base, n);
      const meta = loadJson(path.join(dir, 'minecraftinstance.json'), null);
      if (!meta) continue;
      const loader = meta.baseModLoader?.name ? String(meta.baseModLoader.name).split('-')[0] : 'vanilla';
      out.push(profile('curseforge', meta.name || n, dir, { gameVersion: meta.gameVersion || meta.baseModLoader?.minecraftVersion, loader }));
    }
  }
  return out;
}

function prism() {
  const out = [];
  for (const [key, root, cfgName] of [['prism', path.join(APPDATA, 'PrismLauncher'), 'prismlauncher.cfg'], ['multimc', path.join(APPDATA, 'MultiMC'), 'multimc.cfg']]) {
    if (!isDir(root)) continue;
    let instDir = 'instances';
    try { const m = fs.readFileSync(path.join(root, cfgName), 'utf8').match(/^InstanceDir=(.+)$/m); if (m) instDir = m[1].trim(); } catch (_) {}
    const base = path.isAbsolute(instDir) ? instDir : path.join(root, instDir);
    for (const n of list(base)) {
      const dir = path.join(base, n);
      if (!exists(path.join(dir, 'instance.cfg'))) continue;
      let name = n;
      try { const m = fs.readFileSync(path.join(dir, 'instance.cfg'), 'utf8').match(/^name=(.+)$/m); if (m) name = m[1].trim(); } catch (_) {}
      const comps = loadJson(path.join(dir, 'mmc-pack.json'), {})?.components || [];
      const ver = c => c ? (c.version || c.cachedVersion) : null;
      const mc = ver(comps.find(c => c.uid === 'net.minecraft'));
      const ld = comps.find(c => /fabric-loader|quilt-loader|minecraftforge|neoforged/.test(c.uid || ''));
      const loader = !ld ? 'vanilla' : /fabric/.test(ld.uid) ? 'fabric' : /quilt/.test(ld.uid) ? 'quilt' : /neoforged/.test(ld.uid) ? 'neoforge' : 'forge';
      const game = isDir(path.join(dir, 'minecraft')) ? path.join(dir, 'minecraft') : path.join(dir, '.minecraft');
      if (isDir(game)) out.push(profile(key, name, game, { gameVersion: mc, loader }));
    }
  }
  return out;
}

function atLauncher() {
  const out = [];
  const base = path.join(APPDATA, 'ATLauncher', 'instances');
  for (const n of list(base)) {
    const dir = path.join(base, n);
    const meta = loadJson(path.join(dir, 'instance.json'), null);
    if (!meta) continue;
    out.push(profile('atlauncher', meta.launcher?.name || n, dir, { gameVersion: meta.id, loader: meta.launcher?.loaderVersion?.type || 'vanilla' }));
  }
  return out;
}

function gdLauncher() {
  const out = [];
  const base = path.join(APPDATA, 'gdlauncher_carbon', 'data', 'instances');
  for (const n of list(base)) {
    const meta = loadJson(path.join(base, n, 'instance.json'), null);
    if (!meta) continue;
    const v = meta.game_configuration?.version;
    const game = path.join(base, n, 'instance');
    if (isDir(game)) out.push(profile('gdlauncher', meta.name || n, game, { gameVersion: v?.release, loader: v?.modloaders?.[0]?.type || 'vanilla' }));
  }
  return out;
}

function lunarAndVanilla() {
  const out = [];
  if (isDir(DOT_MINECRAFT)) {
    const lp = loadJson(path.join(DOT_MINECRAFT, 'launcher_profiles.json'), {});
    const last = Object.values(lp.profiles || {}).sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')))[0];
    const lv = String(last?.lastVersionId || '');
    const m = lv.match(/fabric-loader-[\d.]+-(\d+\.\d+(?:\.\d+)?)/) || lv.match(/^(\d+\.\d+(?:\.\d+)?)$/);
    out.push(profile('vanilla', '.minecraft', DOT_MINECRAFT, { gameVersion: m ? m[1] : null, loader: /fabric/.test(lv) ? 'fabric' : null }));
  }
  const lunarProfiles = path.join(HOME, '.lunarclient', 'profiles');
  if (isDir(path.join(HOME, '.lunarclient'))) {
    const withMods = list(lunarProfiles).map(n => ({ n, mods: jars(path.join(lunarProfiles, n, 'mods')) })).filter(x => x.mods.length);
    const note = 'Lunar\'s own module settings use a closed format and cannot be transferred.';
    if (!withMods.length) out.push(profile('lunar', 'Lunar Client', DOT_MINECRAFT, { mods: [], note }));
    withMods.forEach((x, i) => out.push(profile('lunar', withMods.length > 1 ? `Lunar Client (Fabric ${i + 1})` : 'Lunar Client (Fabric)', DOT_MINECRAFT, { mods: x.mods, loader: 'fabric', note })));
  }
  return out;
}

/** Alle gefundenen Profile anderer Launcher. */
function scan() {
  const out = [];
  for (const fn of [modrinthApp, noRisk, curseForge, prism, atLauncher, gdLauncher, lunarAndVanilla]) {
    try { out.push(...fn()); } catch (e) { log(`Import scan ${fn.name}: ${e.message}`, 'warn'); }
  }
  return { profiles: out };
}

/** Ein beliebiger Ordner (Instanz oder .minecraft). */
function scanFolder(dir) {
  const d = String(dir || '');
  if (!isDir(d)) throw new Error('Choose a folder.');
  const game = [path.join(d, 'minecraft'), path.join(d, '.minecraft'), path.join(d, 'instance')].find(p => isDir(path.join(p, 'mods')) || exists(path.join(p, 'options.txt'))) || d;
  return { profile: profile('folder', path.basename(d), game) };
}

// ---------------------------------------------------------------------------
// Uebernehmen
// ---------------------------------------------------------------------------

const VORTEX_IDS = new Set(['vortexclient', 'vortexplusaddon', 'vortex_plus_addon', 'fabric-api']);

function mcPasst(bedingung, ziel) {
  const b = String(bedingung || '').trim();
  if (!b || b === '*') return true;
  const [maj, min] = ziel.split('.');
  return b.includes(ziel) || b.includes(`${maj}.${min}.x`) || b === `${maj}.${min}`;
}

function copyMissing(src, dst, filter = () => true) {
  let n = 0;
  if (!isDir(src)) return 0;
  ensureDir(dst);
  for (const name of list(src)) {
    if (!filter(name)) continue;
    const a = path.join(src, name), b = path.join(dst, name);
    if (isDir(a)) n += copyMissing(a, b, () => true);
    else if (!exists(b)) { try { fs.copyFileSync(a, b); n++; } catch (_) {} }
  }
  return n;
}

/** servers.dat (NBT, unkomprimiert): [{name, ip}] */
function readServersDat(file) {
  const buf = fs.readFileSync(file);
  let p = 0;
  const u8 = () => buf.readUInt8(p++);
  const i16 = () => { const v = buf.readInt16BE(p); p += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const str = () => { const l = buf.readUInt16BE(p); p += 2; const s = buf.toString('utf8', p, p + l); p += l; return s; };
  const payload = t => {
    switch (t) {
      case 1: return u8();
      case 2: return i16();
      case 3: return i32();
      case 4: p += 8; return 0;
      case 5: p += 4; return 0;
      case 6: p += 8; return 0;
      case 7: { const l = i32(); p += l; return null; }
      case 8: return str();
      case 9: { const et = u8(); const l = i32(); const a = []; for (let i = 0; i < l; i++) a.push(payload(et)); return a; }
      case 10: { const o = {}; for (;;) { const tt = u8(); if (tt === 0) break; const name = str(); o[name] = payload(tt); } return o; }
      case 11: { const l = i32(); p += l * 4; return null; }
      case 12: { const l = i32(); p += l * 8; return null; }
      default: throw new Error('bad NBT');
    }
  };
  if (u8() !== 10) return [];
  str();
  const root = payload(10);
  return (root.servers || []).filter(s => s && s.ip).map(s => ({ name: String(s.name || s.ip), ip: String(s.ip) }));
}

const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

/**
 * @param p Profil aus scan()/scanFolder()
 * @param version Ziel (Vortex-/Launcher-Version)
 * @param opts { mods, config, resourcepacks, shaderpacks, options, servers }
 * @param modrinth Modul (api, installMod)
 */
async function importProfile(p, version, opts, modrinth) {
  const v = instances.requireVersion(version);
  const target = paths.instanceRoot(v);
  ensureDir(target);
  const r = { installed: [], copied: [], unavailable: [], skipped: [], files: 0, servers: 0, options: false };
  const step = (label, percent = null) => send('import-progress', { label, percent });

  if (opts.mods && p.mods?.length) {
    const kandidaten = [];
    for (const f of p.mods) {
      const info = readModInfo(f);
      if (info?.id && VORTEX_IDS.has(info.id)) { r.skipped.push(path.basename(f)); continue; }
      kandidaten.push({ f, info, hash: sha1(f) });
    }
    step('Looking up mods on Modrinth', 5);
    let map = {};
    for (let i = 0; i < kandidaten.length; i += 100) {
      try {
        Object.assign(map, await modrinth.api('/version_files/update', {
          hashes: kandidaten.slice(i, i + 100).map(k => k.hash), algorithm: 'sha1', loaders: ['fabric'], game_versions: [v]
        }));
      } catch (e) { log(`Import: Modrinth lookup failed: ${e.message}`, 'warn'); }
    }
    const projekte = new Map();
    for (const k of kandidaten) {
      const ver = map[k.hash];
      if (ver?.project_id) { projekte.set(ver.project_id, k); continue; }
      // Nicht auf Modrinth: nur kopieren, wenn es eine Fabric-Mod fuer diese Version ist
      if (k.info?.id && mcPasst(k.info.minecraft, v)) {
        const res = instances.importMods(v, [k.f]);
        if (res.added.length) r.copied.push(...res.added); else r.skipped.push(path.basename(k.f));
      } else {
        r.unavailable.push(k.info?.name || path.basename(k.f));
      }
    }
    let n = 0;
    for (const [pid, k] of projekte) {
      n++;
      step(`Installing mods (${n}/${projekte.size})`, 10 + Math.round(n / projekte.size * 70));
      try {
        const res = await modrinth.installMod(pid, v);
        r.installed.push(...res.installed);
      } catch (e) { r.unavailable.push(k.info?.name || path.basename(k.f)); }
    }
  }
  step('Copying files', 85);
  if (opts.config) r.files += copyMissing(path.join(p.gameDir, 'config'), path.join(target, 'config'), n => !/^vortex/i.test(n));
  if (opts.resourcepacks) r.files += copyMissing(path.join(p.gameDir, 'resourcepacks'), path.join(target, 'resourcepacks'));
  if (opts.shaderpacks) r.files += copyMissing(path.join(p.gameDir, 'shaderpacks'), path.join(target, 'shaderpacks'));
  if (opts.options && exists(path.join(p.gameDir, 'options.txt'))) {
    const to = path.join(target, 'options.txt');
    if (exists(to)) fs.copyFileSync(to, path.join(target, 'options.before-import.txt'));
    fs.copyFileSync(path.join(p.gameDir, 'options.txt'), to);
    r.options = true;
  }
  if (opts.servers && exists(path.join(p.gameDir, 'servers.dat'))) {
    try {
      const known = new Set(servers.list().map(s => s.address));
      for (const s of readServersDat(path.join(p.gameDir, 'servers.dat'))) {
        const addr = servers.normalizeAddress(s.ip);
        if (!addr || known.has(addr)) continue;
        try { servers.add({ name: s.name.replace(/§./g, '').slice(0, 40) || addr, address: addr }); known.add(addr); r.servers++; } catch (_) {}
      }
    } catch (e) { log(`Import: servers.dat: ${e.message}`, 'warn'); }
    if (!exists(path.join(target, 'servers.dat'))) fs.copyFileSync(path.join(p.gameDir, 'servers.dat'), path.join(target, 'servers.dat'));
  }
  if (r.installed.length || r.copied.length) instances.markChanged(v);
  step('', null);
  log(`Import from ${p.launcherName} "${p.name}" into ${v}: ${r.installed.length} from Modrinth, ${r.copied.length} copied, ${r.unavailable.length} not available, ${r.files} files, ${r.servers} servers.`);
  return r;
}

module.exports = { scan, scanFolder, importProfile, readServersDat, LAUNCHERS };
