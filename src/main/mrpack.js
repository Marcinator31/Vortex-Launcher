'use strict';
/**
 * Instanz als Modrinth-Modpack (.mrpack) exportieren und importieren.
 * Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
 *
 * Export: Mods, die es auf Modrinth gibt, werden nur verlinkt (klein, legal);
 * alles andere (eigene Jars, Configs, optional Packs) landet in overrides/.
 * Vortex-Dateien werden nicht exportiert -- die bringt der Launcher selbst mit.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { paths, ensureDir, exists, log } = require('./core');
const instances = require('./instances');
const modrinth = require('./modrinth');
const zip = require('./zip');
const { readModInfo } = require('./jarinfo');

const MAX_TOTAL = 1024 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);

function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function exportPack(version, target, opts = {}) {
  const v = instances.requireVersion(version);
  const root = paths.instanceRoot(v);
  const managed = new Set(instances.activeBundle(v).map(n => n.toLowerCase()));
  const mods = instances.modsWithIds(v).filter(m => m.enabled && !managed.has(m.file.toLowerCase()));
  const items = [];
  const files = [];
  let total = 0;
  const addOverride = (rel, abs) => {
    const data = fs.readFileSync(abs);
    total += data.length;
    if (total > MAX_TOTAL) throw new Error('The pack would be larger than 1 GB. Leave out resource packs or shaders.');
    items.push({ name: `overrides/${rel}`, data });
  };

  // Mods: auf Modrinth suchen (per SHA-1)
  const hashes = new Map();
  for (const m of mods) {
    const buf = fs.readFileSync(m.path);
    hashes.set(crypto.createHash('sha1').update(buf).digest('hex'), { m, buf });
  }
  let found = {};
  if (hashes.size) {
    try { found = await modrinth.api('/version_files', { hashes: [...hashes.keys()], algorithm: 'sha1' }); } catch (_) { found = {}; }
  }
  let linked = 0, bundled = 0;
  for (const [sha1, { m, buf }] of hashes) {
    const ver = found[sha1];
    const file = ver?.files?.find(f => f.hashes?.sha1 === sha1);
    if (file && /^https:\/\/cdn\.modrinth\.com\//.test(file.url)) {
      files.push({
        path: `mods/${file.filename}`,
        hashes: { sha1, sha512: crypto.createHash('sha512').update(buf).digest('hex') },
        env: { client: 'required', server: 'optional' },
        downloads: [file.url],
        fileSize: buf.length
      });
      linked++;
    } else {
      addOverride(`mods/${m.file}`, m.path);
      bundled++;
    }
  }
  const dirs = [['config', opts.config !== false], ['resourcepacks', Boolean(opts.resourcePacks)], ['shaderpacks', Boolean(opts.shaders)]];
  for (const [d, on] of dirs) {
    if (!on) continue;
    for (const rel of walk(path.join(root, d))) addOverride(`${d}/${rel}`, path.join(root, d, ...rel.split('/')));
  }
  if (opts.options && exists(path.join(root, 'options.txt'))) addOverride('options.txt', path.join(root, 'options.txt'));

  const fabric = await instances.ensureFabric(v).catch(() => null);
  const index = {
    formatVersion: 1, game: 'minecraft', versionId: new Date().toISOString().slice(0, 10),
    name: String(opts.name || `Vortex ${v}`).slice(0, 60),
    summary: 'Exported from the Vortex Client Launcher',
    files,
    dependencies: { minecraft: v, ...(fabric ? { 'fabric-loader': fabric.loaderVersion } : {}) }
  };
  items.unshift({ name: 'modrinth.index.json', data: Buffer.from(JSON.stringify(index, null, 2)) });
  zip.write(target, items);
  log(`Exported ${v} to ${target} (${linked} linked, ${bundled} included).`);
  return { file: target, linked, included: bundled, overrides: items.length - 1 };
}

function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.split('/').some(x => x === '..' || x === '')) return null;
  return s;
}

async function importPack(file) {
  const z = zip.open(file);
  const raw = z.read('modrinth.index.json', 8 * 1024 * 1024);
  if (!raw) throw new Error('This is not a Modrinth modpack (.mrpack).');
  let index;
  try { index = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('The modpack index is broken.'); }
  if (index.game !== 'minecraft' || !index.dependencies?.minecraft) throw new Error('This modpack is not for Minecraft: Java Edition.');
  if (!index.dependencies['fabric-loader']) {
    const loader = Object.keys(index.dependencies).find(k => k !== 'minecraft') || 'vanilla';
    throw new Error(`This modpack uses ${loader}. Only Fabric modpacks are supported.`);
  }
  const v = index.dependencies.minecraft;
  if (!instances.isKnown(v)) await instances.addVersion(v);
  const root = paths.instanceRoot(v);
  ensureDir(root);

  const added = [], skipped = [], failed = [];
  for (const f of Array.isArray(index.files) ? index.files : []) {
    const rel = safeRel(f.path);
    if (!rel) { failed.push(String(f.path)); continue; }
    if (f.env?.client === 'unsupported') continue;
    const url = (f.downloads || []).find(u => { try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED_HOSTS.has(x.hostname); } catch (_) { return false; } });
    if (!url) { failed.push(rel); continue; }
    const target = path.join(root, ...rel.split('/'));
    if (exists(target)) { skipped.push(rel); continue; }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (f.hashes?.sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== String(f.hashes.sha1).toLowerCase()) throw new Error('checksum');
      if (f.hashes?.sha512 && crypto.createHash('sha512').update(buf).digest('hex') !== String(f.hashes.sha512).toLowerCase()) throw new Error('checksum');
      ensureDir(path.dirname(target));
      fs.writeFileSync(target, buf);
      added.push(rel);
    } catch (e) { log(`${rel}: ${e.message}`, 'warn'); failed.push(rel); }
  }
  // overrides/ und client-overrides/
  for (const name of z.names) {
    const m = name.match(/^(?:client-)?overrides\/(.+)$/);
    if (!m || name.endsWith('/')) continue;
    const rel = safeRel(m[1]);
    if (!rel) continue;
    const target = path.join(root, ...rel.split('/'));
    const data = z.read(name, 300 * 1024 * 1024);
    if (!data) { failed.push(rel); continue; }
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, data);
    added.push(rel);
  }
  // Doppelte Mod-IDs (z. B. zweite Fabric API neben der von Vortex) entfernen
  instances.syncBundled && instances.bundledVersions().includes(v) && instances.syncBundled(v);
  const seenIds = new Map();
  for (const m of instances.modsWithIds(v)) {
    if (!m.id) continue;
    if (seenIds.has(m.id)) { try { fs.rmSync(m.path, { force: true }); } catch (_) {} } else seenIds.set(m.id, m.file);
  }
  log(`Imported modpack "${index.name || file}" into ${v}: ${added.length} files.`);
  return { version: v, name: String(index.name || ''), added: added.length, skipped: skipped.length, failed };
}

module.exports = { exportPack, importPack, readModInfo };
