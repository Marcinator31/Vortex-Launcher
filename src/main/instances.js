'use strict';
/**
 * Instanzen: eine Minecraft-Version = ein eigener Ordner mit eigenen Mods,
 * Welten, Einstellungen.
 *
 * Vortex-Versionen bringen ihre Mods mit (assets/modpacks/<version>). Diese
 * "verwalteten" Mods werden beim Vorbereiten eingespielt und aktuell gehalten;
 * alte Vortex-Jars werden dabei entfernt. Alle anderen Versionen laufen mit
 * reinem Fabric.
 *
 * BEHOBEN gegenueber dem alten Launcher:
 *  - Die Wartung lief JEDE SEKUNDE und rechnete Pruefsummen ueber alle Jars.
 *    Jetzt: einmal beim Start und vor jedem Spielstart.
 *  - Ohne Internet startete nichts, weil das Fabric-Profil jedes Mal neu aus
 *    dem Netz kam. Jetzt: vorhandenes Profil wird benutzt, wenn das Netz fehlt.
 *  - Eine zweite fabric-api/modmenu-Datei (eigene Version) neben der
 *    mitgelieferten liess Fabric abstuerzen (doppelte Mod-ID). Jetzt wird die
 *    doppelte ersetzt.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { shell } = require('electron');
const {
  paths, ensureDir, exists, loadJson, writeJson, log, compareVersions, isValidMinecraftVersion, fabricMeta, isLegacyVersion
} = require('./core');
const settings = require('./settings');
const { readModInfo } = require('./jarinfo');
const vortexfiles = require('./vortexfiles');

// ---------------------------------------------------------------------------
// Versionen
// ---------------------------------------------------------------------------

/** Versionen mit mitgelieferten Dateien (assets/modpacks). */
function packagedVersions() {
  const dir = paths.modpacksRoot();
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && isValidMinecraftVersion(e.name)).map(e => e.name);
  } catch (_) { return []; }
}

/** Vortex-Versionen: mitgeliefert ODER im Admin-Bereich hochgeladen. */
function bundledVersions() {
  return [...new Set([...packagedVersions(), ...vortexfiles.versions()])];
}

function customVersions() {
  const stored = loadJson(paths.customVersionsFile, []);
  return Array.isArray(stored) ? stored.map(String).filter(isValidMinecraftVersion) : [];
}

function allVersions() {
  return [...new Set([...bundledVersions(), ...customVersions()])].sort(compareVersions).reverse();
}

function isKnown(version) { return allVersions().includes(String(version || '')); }

function requireVersion(version) {
  const v = String(version || '').trim();
  if (!isValidMinecraftVersion(v) || !isKnown(v)) throw new Error(`Unknown Minecraft version "${v}".`);
  return v;
}

async function addVersion(version) {
  const v = String(version || '').trim().replace(/^v/i, '');
  if (!isValidMinecraftVersion(v)) throw new Error('Enter a release version such as 1.21.4 or 26.2.');
  if (isKnown(v)) return v;
  // Pruefen, ob Fabric diese Version ueberhaupt kennt -- sonst gibt es spaeter
  // einen unverstaendlichen Fehler beim Start.
  const res = await fetch(`${fabricMeta(v)}/v2/versions/loader/${encodeURIComponent(v)}`,
    { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res || !res.ok) throw new Error('Fabric could not be reached to check this version. Check your internet connection and try again.');
  const list = await res.json().catch(() => []);
  if (!Array.isArray(list) || !list.length) throw new Error(`Fabric does not support Minecraft ${v} (yet).`);
  writeJson(paths.customVersionsFile, [...new Set([...customVersions(), v])].sort(compareVersions).reverse());
  return v;
}

function removeCustomVersion(version) {
  const v = String(version || '');
  if (bundledVersions().includes(v)) throw new Error('Vortex versions cannot be removed from the list.');
  writeJson(paths.customVersionsFile, customVersions().filter(x => x !== v));
  return true;
}

// ---------------------------------------------------------------------------
// Mitgelieferte Mods
// ---------------------------------------------------------------------------

const isAddonJar = name => /^vortex[-_]plus[-_]addon.*\.jar$/i.test(name);
const isCoreJar = name => /^vortexclient.*\.jar$/i.test(name);
const isVortexJar = name => isAddonJar(name) || isCoreJar(name);
const fallbackId = name => (isCoreJar(name) ? 'vortexclient' : isAddonJar(name) ? 'vortexplusaddon' : (name.match(/^(.*?)-\d/) || [])[1]?.toLowerCase() || name.toLowerCase());
const isAddonId = id => vortexfiles.ADDON_IDS.has(id);
const isCoreId = id => vortexfiles.CORE_IDS.has(id);

/** Mitgelieferte Dateien einer Version: [{id, name, file, version, source}]. */
function packagedEntries(version) {
  const dir = path.join(paths.modpacksRoot(), version);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.jar')); } catch (_) {}
  return names.map(name => {
    const file = path.join(dir, name);
    const info = readModInfo(file);
    return { id: info?.id || fallbackId(name), name, file, version: info?.version || jarVersion(name) || '', source: 'bundled' };
  });
}

/**
 * Alle Vortex-Dateien einer Version. Pro Mod-ID gewinnt die neuere Datei:
 * mitgeliefert oder online (Admin-Bereich).
 */
function bundleEntries(version) {
  // Schluessel je MOD-ART, nicht je ID: das alte 1.21.11-Addon hiess
  // "vortex_plus_addon", das neue "vortexplusaddon". Mit der ID als
  // Schluessel waeren beide aktiv -- doppelte Klassen, Absturz beim Start.
  const key = id => (isCoreId(id) ? 'client' : isAddonId(id) ? 'addon' : id);
  const byId = new Map();
  for (const e of packagedEntries(version)) byId.set(key(e.id), e);
  for (const e of vortexfiles.entries(version)) {
    const cur = byId.get(key(e.id));
    if (!cur || vortexfiles.isNewer(e.version, cur.version)) byId.set(key(e.id), e);
  }
  return [...byId.values()].map(e => ({ ...e, kind: vortexfiles.kindOf(e.id) }));
}

/** Kompatibel zu frueher: nur die Dateinamen. */
function bundledJars(version) { return bundleEntries(version).map(e => e.name); }

/** Die Dateien, die in dieser Instanz liegen sollen (Addon je nach Einstellung). */
function activeEntries(version) {
  const withAddon = settings.get().includeAddon;
  return bundleEntries(version).filter(e => withAddon || e.kind !== 'addon');
}
function activeBundle(version) { return activeEntries(version).map(e => e.name); }

function jarVersion(name) {
  const m = String(name).match(/-(\d+\.\d+(?:\.\d+)?)(?:\+[^/]*)?\.jar$/i);
  return m ? m[1] : null;
}

function bundleInfo(version) {
  const all = bundleEntries(version);
  const core = all.find(e => e.kind === 'client');
  const addon = all.find(e => e.kind === 'addon');
  return {
    vortex: Boolean(core),
    clientVersion: core ? vortexfiles.cleanVersion(core.version) : null,
    clientSource: core ? core.source : null,
    addonVersion: addon ? vortexfiles.cleanVersion(addon.version) : null,
    addonSource: addon ? addon.source : null,
    extras: all.filter(e => e.kind === 'extra').map(e => e.name)
  };
}

/** "fabric-api-0.158.0+26.2.jar" -> "fabric-api-" : alles bis vor die Versionsnummer. */
function jarPrefix(name) {
  const m = String(name).match(/^(.*?-)\d/);
  return m ? m[1].toLowerCase() : null;
}

function sameContent(a, b) {
  try {
    const sa = fs.statSync(a), sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    const h = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    return h(a) === h(b);
  } catch (_) { return false; }
}

/**
 * Vortex-Dateien einspielen und alte/doppelte entfernen.
 * Doppelt = gleiche Mod-ID wie eine Vortex-Datei (z. B. eine zweite
 * fabric-api) -- Fabric wuerde sonst abstuerzen.
 * @returns {{copied:number, removed:number}}
 */
function syncBundled(version) {
  const mods = paths.modsRoot(version);
  ensureDir(mods);
  const all = bundleEntries(version);
  const active = activeEntries(version);
  const keep = new Set(active.map(e => e.name.toLowerCase()));
  const ids = new Set(all.map(e => e.id));
  let removed = 0, copied = 0;
  const locked = [];
  for (const name of staleFiles(mods, keep, ids)) {
    try { fs.rmSync(path.join(mods, name), { force: true }); removed++; }
    catch (e) {
      // Windows: Eine Jar, die ein laufendes Minecraft geoeffnet hat, laesst sich
      // nicht loeschen. Dann bleibt sie liegen -- und wuerde beim naechsten Start
      // doppelt geladen. Merken und spaeter (Spielende/naechster Start) nochmal.
      locked.push(name);
      log(`${version}: old Vortex file ${name} could not be removed (${e.code || e.message}).`, 'warn');
    }
  }
  for (const e of active) {
    const to = path.join(mods, e.name);
    if (!exists(to) || !sameContent(e.file, to)) {
      try { fs.copyFileSync(e.file, to); copied++; }
      catch (err) { locked.push(e.name); log(`${version}: ${e.name} could not be written (${err.code || err.message}).`, 'warn'); }
    }
  }
  if (copied || removed) log(`${version}: ${copied} Vortex file(s) updated, ${removed} outdated file(s) removed.`);
  return { copied, removed, locked };
}

/**
 * Jars im Mods-Ordner, die zu Vortex (oder einer mitgelieferten Mod-ID)
 * gehoeren, aber nicht die aktuelle Datei sind -- egal wie sie heissen und
 * ob sie deaktiviert sind.
 */
function staleFiles(mods, keep, ids) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(mods); } catch (_) { return out; }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (keep.has(lower) || !/\.jar(\.disabled)?$/.test(lower)) continue;
    const base = lower.replace(/\.disabled$/, '');
    let id = null;
    if (isVortexJar(base)) id = fallbackId(base);
    else id = readModInfo(path.join(mods, name))?.id || null;
    if (id && (ids.has(id) || isCoreId(id) || isAddonId(id))) out.push(name);
  }
  return out;
}

/** Liegt eine Fabric API in der Instanz? (Neue Versionen aus dem Admin-Bereich bringen evtl. keine mit.) */
function hasFabricApi(version) {
  const dir = paths.modsRoot(version);
  try {
    return fs.readdirSync(dir).some(n => n.toLowerCase().endsWith('.jar') && (readModInfo(path.join(dir, n))?.id === 'fabric-api'));
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

function cachedFabricProfile(version) {
  const dir = path.join(paths.instanceRoot(version), 'versions');
  try {
    const ids = fs.readdirSync(dir)
      .filter(n => n.startsWith('fabric-loader-') && n.endsWith(`-${version}`)
        && exists(path.join(dir, n, `${n}.json`)));
    ids.sort((a, b) => compareVersions(a.split('-')[2], b.split('-')[2]));
    return ids.length ? ids[ids.length - 1] : null;
  } catch (_) { return null; }
}

/** Fabric-Profil sicherstellen. Ohne Netz: das vorhandene benutzen. */
async function ensureFabric(version) {
  const cached = cachedFabricProfile(version);
  try {
    const res = await fetch(`${fabricMeta(version)}/v2/versions/loader/${encodeURIComponent(version)}`,
      { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Fabric meta answered ${res.status}`);
    const loaders = await res.json();
    const pick = loaders.find(e => e.loader?.stable) || loaders[0];
    if (!pick?.loader?.version) throw new Error(`No Fabric Loader exists for Minecraft ${version}.`);
    const id = `fabric-loader-${pick.loader.version}-${version}`;
    if (cached === id) return { profileId: id, loaderVersion: pick.loader.version };
    const pr = await fetch(`${fabricMeta(version)}/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(pick.loader.version)}/profile/json`,
      { signal: AbortSignal.timeout(15000) });
    if (!pr.ok) throw new Error(`Fabric profile answered ${pr.status}`);
    const profile = await pr.json();
    profile.id = id;
    writeJson(path.join(paths.instanceRoot(version), 'versions', id, `${id}.json`), profile);
    log(`Fabric Loader ${pick.loader.version} prepared for ${version}.`);
    return { profileId: id, loaderVersion: pick.loader.version };
  } catch (error) {
    if (cached) {
      log(`Fabric could not be checked online (${error.message}); using the existing profile ${cached}.`, 'warn');
      return { profileId: cached, loaderVersion: cached.split('-')[2] };
    }
    throw new Error(`Fabric for Minecraft ${version} could not be prepared: ${error.message}. Check your internet connection.`);
  }
}

/**
 * Legacy Fabric (1.8.9 ...) liefert LWJGL 2 neu, inkl. der nativen Teile als
 * Bibliothek mit "natives" (lwjgl-platform). minecraft-launcher-core kennt
 * dieses Format bei eigenen Profilen nicht: Es laedt eine (nicht existierende)
 * normale Jar -- 404-Seite im Klassenpfad, Fabric bricht ab ("error in opening
 * zip file"). Deshalb: solche Eintraege aus dem Profil nehmen und die nativen
 * Dateien selbst in den natives-Ordner legen, den MCLC benutzt.
 */
function nativeKey() {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
}
function fixLegacyProfile(version, profileId) {
  const file = path.join(paths.instanceRoot(version), 'versions', profileId, `${profileId}.json`);
  const profile = loadJson(file, null);
  if (!profile || !Array.isArray(profile.libraries)) return [];
  const natives = profile.libraries.filter(l => l && l.natives && l.url);
  if (!natives.length) return Array.isArray(profile.vortexNatives) ? profile.vortexNatives : [];
  profile.libraries = profile.libraries.filter(l => !(l && l.natives && l.url));
  profile.vortexNatives = [...(profile.vortexNatives || []), ...natives];
  writeJson(file, profile);
  log(`${version}: ${natives.length} native librar${natives.length === 1 ? 'y' : 'ies'} moved out of the Fabric profile.`);
  return profile.vortexNatives;
}
async function ensureLegacyNatives(version, profileId) {
  const libs = fixLegacyProfile(version, profileId);
  if (!libs.length) return;
  const dir = path.join(paths.instanceRoot(version), 'natives', version);
  const marker = path.join(dir, '.vortex-natives.json');
  const want = libs.map(l => `${l.name}:${l.natives[nativeKey()] || ''}`).join('|');
  if (loadJson(marker, {}).libs === want) return;
  // Alte (z. B. von Mojang) entfernen -- sonst nimmt MCLC den Ordner wie er ist
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const zip = require('./zip');
  for (const l of libs) {
    const classifier = String(l.natives[nativeKey()] || '').replace('${arch}', process.arch === 'ia32' ? '32' : '64');
    if (!classifier) continue;
    const [group, artifact, ver] = String(l.name).split(':');
    const url = `${l.url.replace(/\/?$/, '/')}${group.replace(/\./g, '/')}/${artifact}/${ver}/${artifact}-${ver}-${classifier}.jar`;
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Native files for Minecraft ${version} could not be downloaded (${res.status}).`);
    const tmp = path.join(dir, `${artifact}-${classifier}.jar`);
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const z = zip.open(tmp);
    const exclude = (l.extract && Array.isArray(l.extract.exclude)) ? l.extract.exclude : ['META-INF/'];
    for (const name of z.names) {
      if (name.endsWith('/') || exclude.some(e => name.startsWith(e))) continue;
      const rel = name.split('/').filter(x => x && x !== '..').join(path.sep);
      const data = z.read(name, 64 * 1024 * 1024);
      if (!data || !rel) continue;
      ensureDir(path.dirname(path.join(dir, rel)));
      fs.writeFileSync(path.join(dir, rel), data);
    }
    fs.rmSync(tmp, { force: true });
  }
  writeJson(marker, { libs: want });
  log(`${version}: native files (${libs.map(l => l.name.split(':')[1]).join(', ')}) prepared.`);
}

/** Ist Minecraft fuer diese Version schon heruntergeladen? (MCLC legt das Jar in den Fabric-Ordner.) */
function isInstalled(version) {
  const id = cachedFabricProfile(version);
  return Boolean(id) && exists(path.join(paths.instanceRoot(version), 'versions', id, `${id}.jar`));
}

/**
 * Wie syncBundled -- aber sind Dateien gesperrt, erst haengengebliebene
 * Minecraft-Prozesse dieser Instanz (ohne Fenster) beenden und nochmal.
 */
async function syncBundledCleaning(version) {
  let sync = syncBundled(version);
  if (sync.locked.length) {
    const n = await require('./javaprocs').killOrphans(paths.instanceRoot(version)).catch(() => 0);
    if (n) {
      const again = syncBundled(version);
      sync = { copied: sync.copied + again.copied, removed: sync.removed + again.removed, locked: again.locked, ended: n };
    }
  }
  return sync;
}

/** Alles vorbereiten, was vor dem Start noetig ist. */
async function prepare(version) {
  const v = requireVersion(version);
  ensureDir(paths.modsRoot(v));
  ensureDir(paths.resourcePacksRoot(v));
  const sync = await syncBundledCleaning(v);
  if (sync.locked.length) {
    throw new Error(`An old Vortex file is still in use (${sync.locked.join(', ')}). Is Minecraft ${v} still running? Close it (or end "OpenJDK Platform binary" in the Task Manager) and press Play again.`);
  }
  const fabric = await ensureFabric(v);
  if (isLegacyVersion(v)) await ensureLegacyNatives(v, fabric.profileId);
  return { version: v, ...fabric, ...sync, vortex: bundledVersions().includes(v), hasFabricApi: hasFabricApi(v) };
}

/** Einmal beim Start des Launchers: Vortex-Mods aktuell halten (ohne Netz). */
function maintainAll() {
  for (const v of bundledVersions()) {
    try { if (exists(paths.instanceRoot(v))) syncBundled(v); }
    catch (e) { log(`Maintenance of ${v} failed: ${e.message}`, 'warn'); }
  }
}

// ---------------------------------------------------------------------------
// Uebersicht
// ---------------------------------------------------------------------------

const metaFile = () => path.join(paths.dataRoot, 'instances-meta.json');
function markPlayed(version) {
  const meta = loadJson(metaFile(), {});
  meta[version] = { ...(meta[version] || {}), lastPlayed: new Date().toISOString() };
  writeJson(metaFile(), meta);
}

/**
 * Spielzeit: nach jeder Sitzung die Dauer dazuzaehlen. Sitzungen ueber
 * 24 Stunden (vergessenes Fenster ueber Nacht) zaehlen hoechstens 24 h.
 */
function addPlaytime(version, ms) {
  const dauer = Math.max(0, Math.min(Number(ms) || 0, 24 * 3600 * 1000));
  if (dauer < 5000) return;
  const meta = loadJson(metaFile(), {});
  const e = meta[version] || (meta[version] = {});
  e.playtime = (Number(e.playtime) || 0) + dauer;
  e.sessions = (Number(e.sessions) || 0) + 1;
  e.longest = Math.max(Number(e.longest) || 0, dauer);
  writeJson(metaFile(), meta);
}

/** Mods/Vortex-Dateien wurden seit dem letzten Start geaendert (fuer Auto-Backup). */
function markChanged(version) {
  const meta = loadJson(metaFile(), {});
  meta[version] = { ...(meta[version] || {}), contentChanged: true };
  writeJson(metaFile(), meta);
}
function consumeChanged(version) {
  const meta = loadJson(metaFile(), {});
  const changed = Boolean(meta[version]?.contentChanged);
  if (changed) { meta[version].contentChanged = false; writeJson(metaFile(), meta); }
  return changed;
}

function summary(version) {
  const mods = paths.modsRoot(version);
  let files = [];
  try { files = fs.readdirSync(mods); } catch (_) {}
  const enabled = files.filter(n => n.toLowerCase().endsWith('.jar')).length;
  const disabled = files.filter(n => n.toLowerCase().endsWith('.jar.disabled')).length;
  const info = bundleInfo(version);
  const meta = loadJson(metaFile(), {})[version] || {};
  return {
    version,
    ...info,
    custom: !bundledVersions().includes(version),
    installed: isInstalled(version),
    modCount: enabled,
    disabledCount: disabled,
    lastPlayed: meta.lastPlayed || null,
    playtime: Number(meta.playtime) || 0,
    sessions: Number(meta.sessions) || 0,
    longest: Number(meta.longest) || 0
  };
}

// ---------------------------------------------------------------------------
// Mods
// ---------------------------------------------------------------------------

function projectsFile(version) { return path.join(paths.instanceRoot(version), 'vortex-installed-projects.json'); }
function projectMap(version) {
  const m = loadJson(projectsFile(version), {});
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}
function saveProjectMap(version, map) { writeJson(projectsFile(version), map); }

function checkFileName(name, allowed) {
  const n = path.basename(String(name || ''));
  if (n !== String(name) || !allowed.test(n)) throw new Error('Invalid file name.');
  return n;
}

function prettyName(file) {
  return file.replace(/\.jar(\.disabled)?$/i, '').replace(/[-_]\d.*$/, '').replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase()) || file;
}

function listMods(version) {
  const v = requireVersion(version);
  const dir = paths.modsRoot(v);
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => /\.jar(\.disabled)?$/i.test(n)); } catch (_) {}
  const bundle = new Set(bundledJars(v).map(n => n.toLowerCase()));
  // Alte Vortex-Dateien, die gerade nicht geloescht werden konnten (Spiel
  // laeuft noch), nicht als zweiten Client/zweites Addon anzeigen -- sie
  // werden beim Spielende bzw. naechsten Start entfernt.
  const stale = new Set(bundledVersions().includes(v)
    ? staleFiles(dir, new Set(activeBundle(v).map(n => n.toLowerCase())), new Set(bundleEntries(v).map(e => e.id)))
    : []);
  files = files.filter(f => !stale.has(f));
  const projects = projectMap(v);
  const byFile = {};
  for (const [pid, rec] of Object.entries(projects)) {
    const f = typeof rec === 'string' ? rec : rec?.fileName;
    if (f) byFile[String(f).toLowerCase()] = { projectId: pid, ...(typeof rec === 'object' ? rec : {}) };
  }
  const mods = files.map(file => {
    const base = file.replace(/\.disabled$/i, '');
    const info = readModInfo(path.join(dir, file)) || {};
    const project = byFile[base.toLowerCase()];
    const managed = bundle.has(base.toLowerCase());
    let source = 'local';
    if (isCoreId(info.id) || (!info.id && isCoreJar(base))) source = 'vortex';
    else if (isAddonId(info.id) || (!info.id && isAddonJar(base))) source = 'addon';
    else if (managed) source = 'bundled';
    else if (project) source = 'modrinth';
    return {
      file,
      id: info.id || '',
      enabled: !/\.disabled$/i.test(file),
      managed,
      source,
      name: info.name || project?.title || prettyName(file),
      version: info.version || '',
      description: info.description || '',
      authors: info.authors || (project?.author ? [project.author] : []),
      icon: info.icon || null,
      iconUrl: !info.icon && project?.iconUrl ? project.iconUrl : null,
      projectId: project?.projectId || null
    };
  });
  const order = { vortex: 0, addon: 1, bundled: 2, modrinth: 3, local: 3 };
  return mods.sort((a, b) => (order[a.source] - order[b.source]) || a.name.localeCompare(b.name));
}

/** Alle Jars einer Instanz mit Mod-ID (auch deaktivierte). */
function modsWithIds(version) {
  const dir = paths.modsRoot(version);
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => /\.jar(\.disabled)?$/i.test(n)); } catch (_) {}
  return files.map(file => {
    const info = readModInfo(path.join(dir, file)) || {};
    return { file, path: path.join(dir, file), enabled: !/\.disabled$/i.test(file), id: info.id || '', name: info.name || file, version: info.version || '', provides: info.provides || [], depends: info.depends || [], breaks: info.breaks || {}, nested: info.nested || [] };
  });
}

function toggleMod(version, file) {
  const v = requireVersion(version);
  const f = checkFileName(file, /\.jar(\.disabled)?$/i);
  const base = f.replace(/\.disabled$/i, '');
  if (bundledJars(v).map(n => n.toLowerCase()).includes(base.toLowerCase())) {
    throw new Error(isAddonJar(base)
      ? 'The Vortex Plus Addon is switched on and off in Settings.'
      : 'This file belongs to Vortex and is managed by the launcher.');
  }
  const dir = paths.modsRoot(v);
  const from = path.join(dir, f);
  const to = path.join(dir, f.endsWith('.disabled') ? base : `${base}.disabled`);
  if (!exists(from)) throw new Error('The file no longer exists.');
  if (exists(to)) throw new Error('A file with that name already exists.');
  fs.renameSync(from, to);
  return { enabled: !to.endsWith('.disabled') };
}

async function removeMod(version, file) {
  const v = requireVersion(version);
  const f = checkFileName(file, /\.jar(\.disabled)?$/i);
  const base = f.replace(/\.disabled$/i, '');
  if (bundledJars(v).map(n => n.toLowerCase()).includes(base.toLowerCase())) {
    throw new Error('This file belongs to Vortex and is managed by the launcher.');
  }
  const target = path.join(paths.modsRoot(v), f);
  if (!exists(target)) return true;
  // In den Papierkorb statt endgueltig loeschen: ein Fehlklick kostet so nichts.
  try { await shell.trashItem(target); } catch (_) { fs.rmSync(target, { force: true }); }
  const map = projectMap(v);
  let changed = false;
  for (const [pid, rec] of Object.entries(map)) {
    const recFile = typeof rec === 'string' ? rec : rec?.fileName;
    if (String(recFile || '').toLowerCase() === base.toLowerCase()) { delete map[pid]; changed = true; }
  }
  if (changed) saveProjectMap(v, map);
  return true;
}

function importMods(version, files) {
  const v = requireVersion(version);
  const dir = paths.modsRoot(v);
  ensureDir(dir);
  const added = [], skipped = [];
  for (const src of files || []) {
    const name = path.basename(String(src));
    if (!/\.jar$/i.test(name) || !exists(src)) { skipped.push(name); continue; }
    const to = path.join(dir, name);
    if (exists(to)) { skipped.push(name); continue; }
    // Gleiche Mod-ID schon da? Dann wuerde Fabric abstuerzen.
    const id = readModInfo(String(src))?.id;
    if (id && modsWithIds(v).some(m => m.id === id)) { skipped.push(`${name} (already installed)`); continue; }
    fs.copyFileSync(src, to);
    added.push(name);
  }
  if (added.length) markChanged(v);
  return { added, skipped };
}

// ---------------------------------------------------------------------------
// Resource Packs
// ---------------------------------------------------------------------------

function listPacks(version) {
  const v = requireVersion(version);
  const dir = paths.resourcePacksRoot(v);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) {}
  return entries
    .filter(e => (e.isFile() && /\.zip$/i.test(e.name)) || e.isDirectory())
    .map(e => {
      let size = 0;
      try { if (e.isFile()) size = fs.statSync(path.join(dir, e.name)).size; } catch (_) {}
      return { file: e.name, folder: e.isDirectory(), size, name: e.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function removePack(version, file) {
  const v = requireVersion(version);
  const f = path.basename(String(file || ''));
  if (!f || f !== String(file) || f.startsWith('.')) throw new Error('Invalid file name.');
  const target = path.join(paths.resourcePacksRoot(v), f);
  if (!exists(target)) return true;
  try { await shell.trashItem(target); } catch (_) { fs.rmSync(target, { recursive: true, force: true }); }
  return true;
}

module.exports = {
  allVersions, bundledVersions, isKnown, requireVersion, addVersion, removeCustomVersion,
  bundleInfo, activeBundle, syncBundled, ensureFabric, prepare, maintainAll, summary, markPlayed,
  listMods, toggleMod, removeMod, importMods, projectMap, saveProjectMap, listPacks, removePack,
  isAddonJar, isCoreJar, bundleEntries, packagedEntries, syncBundledCleaning, packagedVersions, hasFabricApi, isInstalled,
  modsWithIds, markChanged, consumeChanged, cachedFabricProfile, addPlaytime
};
