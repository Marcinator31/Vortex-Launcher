'use strict';
/**
 * Modrinth: Mods und Resource Packs suchen und installieren.
 *
 * Die Suche filtert direkt auf "Fabric + gewaehlte Minecraft-Version". Der
 * alte Launcher fragte danach fuer JEDEN Treffer einzeln nach einer
 * passenden Datei (18 zusaetzliche Anfragen pro Seite) -- das machte die
 * Suche traege. Die passende Datei wird jetzt erst beim Installieren
 * bestimmt, samt Pflicht-Abhaengigkeiten.
 *
 * Jede Datei: nur HTTPS, Groessengrenze, SHA-512-Pruefung (wenn Modrinth eine
 * Pruefsumme liefert), keine Pfade im Dateinamen.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { paths, ensureDir, exists, log, modLoader } = require('./core');
const instances = require('./instances');
const { readModInfo } = require('./jarinfo');

const API = 'https://api.modrinth.com/v2';
const UA = () => `VortexClient/Vortex-Launcher/${app.getVersion()} (vortex-client.onrender.com)`;
const PAGE = 20;

async function api(route, body) {
  const init = { headers: { Accept: 'application/json', 'User-Agent': UA() }, signal: AbortSignal.timeout(20000) };
  if (body !== undefined) { init.method = 'POST'; init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(`${API}${route}`, init);
  if (!r.ok) throw new Error(`Modrinth answered ${r.status}.`);
  return r.json();
}

/** Slug ("sodium") -> Projekt-ID ("AANobbMI"). */
const idCache = new Map();
async function resolveProject(idOrSlug) {
  const key = String(idOrSlug);
  if (/^[A-Za-z0-9]{8}$/.test(key)) return key;
  if (idCache.has(key)) return idCache.get(key);
  const p = await api(`/project/${encodeURIComponent(key)}`);
  idCache.set(key, p.id);
  return p.id;
}

function installedIds(version) {
  const map = instances.projectMap(version);
  const dir = paths.modsRoot(version);
  const ids = new Set();
  for (const [pid, rec] of Object.entries(map)) {
    const f = typeof rec === 'string' ? rec : rec?.fileName;
    if (f && (exists(path.join(dir, f)) || exists(path.join(dir, `${f}.disabled`)))) ids.add(pid);
  }
  return ids;
}

function hitSummary(h) {
  return {
    projectId: h.project_id, slug: h.slug, title: h.title, author: h.author || '',
    description: h.description || '', iconUrl: /^https:\/\/cdn\.modrinth\.com\//.test(h.icon_url || '') ? h.icon_url : null,
    downloads: h.downloads || 0, follows: h.follows || 0,
    categories: (h.display_categories || h.categories || []).filter(c => c !== 'fabric' && c !== 'legacy-fabric').slice(0, 4)
  };
}

async function search(kind, query, version, page = 0, sort = 'relevance') {
  const v = instances.requireVersion(version);
  const q = String(query || '').trim().slice(0, 80);
  const p = Math.max(0, Math.min(200, Number(page) || 0));
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance';
  const facets = kind === 'mod'
    ? [['project_type:mod'], [`versions:${v}`], [`categories:${modLoader(v)}`]]
    : kind === 'shader'
      ? [['project_type:shader'], ['categories:iris']]
      : [['project_type:resourcepack'], [`versions:${v}`]];
  const params = new URLSearchParams({ query: q, facets: JSON.stringify(facets), limit: String(PAGE), offset: String(p * PAGE), index });
  const res = await api(`/search?${params}`);
  const have = kind === 'mod' ? installedIds(v) : new Set();
  return {
    results: (res.hits || []).map(h => ({ ...hitSummary(h), installed: have.has(h.project_id) })),
    page: p, total: res.total_hits || 0, hasNext: (p + 1) * PAGE < (res.total_hits || 0)
  };
}

const BAD_STATUS = new Set(['archived', 'draft', 'scheduled', 'unknown']);

function bestVersion(list, version, loader) {
  const usable = (list || []).filter(e =>
    Array.isArray(e.game_versions) && e.game_versions.includes(version)
    && (!loader || (Array.isArray(e.loaders) && e.loaders.includes(loader)))
    && !BAD_STATUS.has(e.status));
  for (const channel of ['release', 'beta', 'alpha']) {
    const c = usable.filter(e => e.version_type === channel);
    if (c.length) return c.reduce((a, b) => new Date(b.date_published || 0) > new Date(a.date_published || 0) ? b : a);
  }
  return null;
}

function primaryFile(files, ext) {
  return (files || []).find(f => f.primary && f.filename.toLowerCase().endsWith(ext))
    || (files || []).find(f => f.filename.toLowerCase().endsWith(ext)) || null;
}

async function downloadVerified(file, maxBytes) {
  if (!file || !/^https:\/\//i.test(file.url)) throw new Error('No safe download link.');
  if (file.size > maxBytes) throw new Error('The file is too large.');
  const r = await fetch(file.url, { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`Download failed (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('The file is too large.');
  if (file.hashes?.sha512) {
    const got = crypto.createHash('sha512').update(buf).digest('hex');
    if (got.toLowerCase() !== String(file.hashes.sha512).toLowerCase()) throw new Error('Checksum mismatch -- file rejected.');
  }
  return buf;
}

const safeJar = n => /^[a-zA-Z0-9][a-zA-Z0-9._+ -]*\.jar$/.test(n) && path.basename(n) === n;
const safeZip = n => /^[a-zA-Z0-9][a-zA-Z0-9._+ ()!-]*\.zip$/.test(n) && path.basename(n) === n;

/** Mod installieren -- mit allen Pflicht-Abhaengigkeiten. */
async function installMod(projectId, version) {
  const v = instances.requireVersion(version);
  const queue = [await resolveProject(projectId)], seen = new Set(), plan = [], missing = [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const params = new URLSearchParams({ game_versions: JSON.stringify([v]), loaders: JSON.stringify([modLoader(v)]) });
      const ver = bestVersion(await api(`/project/${encodeURIComponent(id)}/version?${params}`), v, modLoader(v));
      if (!ver) { missing.push(id); continue; }
      plan.push({ id, ver });
      for (const d of ver.dependencies || []) {
        if (d.dependency_type === 'required' && d.project_id) queue.push(d.project_id);
      }
    } catch (_) { missing.push(id); }
  }
  if (!plan.length) throw new Error(`No Fabric build of this mod exists for Minecraft ${v}.`);
  const dir = paths.modsRoot(v);
  ensureDir(dir);
  const map = instances.projectMap(v);
  const bundledPrefixes = new Set(instances.activeBundle(v)
    .map(n => (n.toLowerCase().match(/^(.*?-)\d/) || [])[1]).filter(Boolean));
  const installed = [], present = [];
  for (const { id, ver } of plan) {
    const file = primaryFile(ver.files, '.jar');
    if (!file || !safeJar(file.filename)) { missing.push(id); continue; }
    // Fabric API & Co. bringt Vortex schon mit -- nicht doppelt installieren.
    const prefix = (file.filename.match(/^(.*?-)\d/) || [])[1];
    if (prefix && bundledPrefixes.has(prefix.toLowerCase())) { present.push(file.filename); continue; }
    const target = path.join(dir, file.filename);
    const known = map[id] && (typeof map[id] === 'string' ? map[id] : map[id].fileName);
    if (exists(target) || exists(`${target}.disabled`)) { present.push(file.filename); }
    else if (known && (exists(path.join(dir, known)) || exists(path.join(dir, `${known}.disabled`)))) { present.push(known); continue; }
    else {
      try {
        fs.writeFileSync(target, await downloadVerified(file, 150 * 1024 * 1024));
        // Gleiche Mod-ID schon vorhanden (andere Datei)? Dann nicht doppelt -- Fabric wuerde abstuerzen.
        const info = readModInfo(target);
        const twin = info?.id && instances.modsWithIds(v).find(m => m.id === info.id && m.file !== file.filename);
        if (twin) { fs.rmSync(target, { force: true }); present.push(twin.file); continue; }
        installed.push(file.filename);
      } catch (e) { log(`${file.filename}: ${e.message}`, 'warn'); missing.push(id); continue; }
    }
    let meta = {};
    try { meta = await api(`/project/${encodeURIComponent(id)}`); } catch (_) {}
    map[id] = {
      fileName: file.filename, title: meta.title || '', author: '',
      iconUrl: /^https:\/\/cdn\.modrinth\.com\//.test(meta.icon_url || '') ? meta.icon_url : null,
      versionId: ver.id, versionNumber: ver.version_number
    };
  }
  instances.saveProjectMap(v, map);
  if (installed.length) instances.markChanged(v);
  if (!installed.length && !present.length) throw new Error('Nothing could be installed.');
  log(`Installed into ${v}: ${installed.join(', ') || '(already present)'}${missing.length ? ` -- not available: ${missing.length}` : ''}`);
  return { installed, present, missing };
}

/** Resource Pack oder Shader installieren. */
async function installFile(kind, projectId, version) {
  const v = instances.requireVersion(version);
  const id = await resolveProject(projectId);
  const list = await api(`/project/${encodeURIComponent(id)}/version`);
  // Shader sind meist versionsunabhaengig: passende Version bevorzugen, sonst die neueste.
  let ver = bestVersion(list, v, kind === 'shader' ? 'iris' : null);
  if (!ver && kind === 'shader') {
    const any = (list || []).filter(e => !BAD_STATUS.has(e.status) && (e.loaders || []).includes('iris'));
    ver = any.sort((a, b) => new Date(b.date_published || 0) - new Date(a.date_published || 0))[0] || null;
  }
  const file = ver && primaryFile(ver.files, '.zip');
  if (!file) throw new Error(`No build of this ${kind === 'shader' ? 'shader' : 'pack'} exists for Minecraft ${v}.`);
  if (!safeZip(file.filename)) throw new Error('The file name is not safe.');
  const dir = kind === 'shader' ? paths.shaderPacksRoot(v) : paths.resourcePacksRoot(v);
  ensureDir(dir);
  const target = path.join(dir, file.filename);
  if (exists(target)) return { file: file.filename, already: true };
  fs.writeFileSync(target, await downloadVerified(file, 600 * 1024 * 1024));
  log(`${kind === 'shader' ? 'Shader' : 'Resource pack'} installed into ${v}: ${file.filename}`);
  return { file: file.filename, already: false };
}
const installPack = (id, v) => installFile('pack', id, v);
const installShader = (id, v) => installFile('shader', id, v);

// ---------------------------------------------------------------------------
// Mod-Updates (per Datei-Pruefsumme -- klappt auch fuer selbst hinzugefuegte Jars)
// ---------------------------------------------------------------------------

const updateCache = new Map();   // version -> { at, updates }

async function checkUpdates(version) {
  const v = instances.requireVersion(version);
  const managed = new Set(instances.activeBundle(v).map(n => n.toLowerCase()));
  const mods = instances.modsWithIds(v).filter(m => !managed.has(m.file.replace(/\.disabled$/i, '').toLowerCase()));
  if (!mods.length) { updateCache.set(v, { at: Date.now(), updates: [] }); return { updates: [] }; }
  const byHash = new Map();
  for (const m of mods) {
    try { byHash.set(crypto.createHash('sha1').update(fs.readFileSync(m.path)).digest('hex'), m); } catch (_) {}
  }
  const hashes = [...byHash.keys()];
  const [current, latest] = await Promise.all([
    api('/version_files', { hashes, algorithm: 'sha1' }),
    api('/version_files/update', { hashes, algorithm: 'sha1', loaders: [modLoader(v)], game_versions: [v] })
  ]);
  const map = instances.projectMap(v);
  let mapChanged = false;
  const updates = [];
  for (const [hash, m] of byHash) {
    const cur = current?.[hash];
    const next = latest?.[hash];
    if (cur?.project_id && !map[cur.project_id]) {
      map[cur.project_id] = { fileName: m.file.replace(/\.disabled$/i, ''), title: m.name, author: '', iconUrl: null, versionId: cur.id, versionNumber: cur.version_number };
      mapChanged = true;
    }
    if (!next || !cur || next.id === cur.id) continue;
    const file = primaryFile(next.files, '.jar');
    if (!file || file.hashes?.sha1 === hash) continue;
    updates.push({ file: m.file, name: m.name, current: m.version || cur.version_number, latest: next.version_number, projectId: next.project_id, versionId: next.id, enabled: m.enabled });
  }
  if (mapChanged) instances.saveProjectMap(v, map);
  updateCache.set(v, { at: Date.now(), updates, raw: latest });
  return { updates };
}

/** Mods aktualisieren. files = Liste der Dateinamen oder null fuer alle. */
async function applyUpdates(version, files = null) {
  const v = instances.requireVersion(version);
  let cached = updateCache.get(v);
  if (!cached || Date.now() - cached.at > 10 * 60 * 1000) { await checkUpdates(v); cached = updateCache.get(v); }
  const todo = cached.updates.filter(u => !files || files.includes(u.file));
  const dir = paths.modsRoot(v);
  const map = instances.projectMap(v);
  const done = [], failed = [];
  for (const u of todo) {
    try {
      const ver = await api(`/version/${encodeURIComponent(u.versionId)}`);
      const file = primaryFile(ver.files, '.jar');
      if (!file || !safeJar(file.filename)) throw new Error('no safe file');
      const buf = await downloadVerified(file, 150 * 1024 * 1024);
      const oldPath = path.join(dir, u.file);
      const newName = u.enabled ? file.filename : `${file.filename}.disabled`;
      const newPath = path.join(dir, newName);
      fs.writeFileSync(`${newPath}.part`, buf);
      if (exists(oldPath) && oldPath !== newPath) fs.rmSync(oldPath, { force: true });
      fs.renameSync(`${newPath}.part`, newPath);
      map[u.projectId] = { ...(map[u.projectId] || {}), fileName: file.filename, versionId: ver.id, versionNumber: ver.version_number, title: map[u.projectId]?.title || u.name };
      done.push({ name: u.name, version: ver.version_number });
    } catch (e) {
      log(`Update of ${u.name} failed: ${e.message}`, 'warn');
      failed.push(u.name);
    }
  }
  instances.saveProjectMap(v, map);
  if (done.length) instances.markChanged(v);
  updateCache.delete(v);
  if (done.length) log(`Updated in ${v}: ${done.map(d => `${d.name} ${d.version}`).join(', ')}`);
  return { updated: done, failed };
}

// ---------------------------------------------------------------------------
// Pakete per Klick
// ---------------------------------------------------------------------------

const PERFORMANCE = ['sodium', 'lithium', 'entityculling'];

async function installMany(slugs, version) {
  const ok = [], unavailable = [];
  for (const slug of slugs) {
    try { const r = await installMod(slug, version); ok.push(slug); if (r.missing.length) log(`${slug}: ${r.missing.length} dependency not available`, 'warn'); }
    catch (_) { unavailable.push(slug); }
  }
  if (!ok.length) throw new Error(`None of these mods exist for Minecraft ${version} yet.`);
  return { installed: ok, unavailable };
}
const installPerformancePack = v => installMany(PERFORMANCE, v);
const installIris = v => installMany(['iris'], v);

module.exports = { api, search, installMod, installPack, installShader, checkUpdates, applyUpdates, installPerformancePack, installIris, resolveProject, primaryFile, downloadVerified, bestVersion, safeJar };
