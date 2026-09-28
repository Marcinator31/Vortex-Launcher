'use strict';
/**
 * Vortex-Dateien aus dem Admin-Bereich (Client, Addon, Fabric API ...).
 *
 * Der Besitzer laedt im Admin-Bereich Jars hoch. Sie landen im GitHub-Release
 * "vortex-files" des Launcher-Repos, zusammen mit einer manifest.json:
 *
 *   { schema: 1, updatedAt, versions: { "26.2": { files: {
 *       "vortexclient": { file, version, name, sha256, size, uploadedAt }, ... } } } }
 *
 * Jeder Launcher liest dieses Manifest (oeffentlich, ohne Anmeldung), laedt
 * neuere Dateien nach %APPDATA%\Vortex Client\vortex-files\<version>\ und
 * prueft sie per SHA-256. Beim Spielstart gewinnt pro Mod-ID die neuere
 * Version: mitgeliefert (im Launcher) oder online (Admin-Bereich).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const { paths, ensureDir, exists, loadJson, writeJson, log, compareVersions, isValidMinecraftVersion } = require('./core');

const CORE_IDS = new Set(['vortexclient']);
const ADDON_IDS = new Set(['vortexplusaddon', 'vortex_plus_addon']);
const kindOf = id => (CORE_IDS.has(id) ? 'client' : ADDON_IDS.has(id) ? 'addon' : 'extra');

const root = () => path.join(paths.dataRoot, 'vortex-files');
const manifestFile = () => path.join(root(), 'manifest.json');
const baseUrl = () => `https://github.com/${config.github.owner}/${config.github.repo}/releases/download/${config.filesTag}`;
const assetUrl = name => `${baseUrl()}/${encodeURIComponent(name)}`;

/** "4.6.2+26.2" -> "4.6.2" */
const cleanVersion = v => String(v || '').split('+')[0].replace(/^v/i, '');
const isNewer = (a, b) => compareVersions(cleanVersion(a), cleanVersion(b)) > 0;
const safeName = n => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$/.test(String(n || ''));

let lastCheck = { at: 0, ok: null, error: null };

/**
 * Beta-Kanal: neue Builds landen zuerst in manifest-beta.json. Nur wer Beta
 * eingeschaltet hat (und darf -- Admins/Tester, siehe main.js), bekommt sie.
 * Alle anderen erst, wenn der Besitzer sie in manifest.json freigibt.
 */
let betaCheck = () => false;
function setBetaCheck(fn) { betaCheck = typeof fn === 'function' ? fn : () => false; }

async function fetchManifest(name) {
  const res = await fetch(`${baseUrl()}/${name}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'VortexClientLauncher', 'Cache-Control': 'no-cache' } });
  if (res.status === 404) return { schema: 1, versions: {}, news: [] };      // noch nichts hochgeladen
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return validManifest(await res.json());
}

/** Stabil + Beta zusammenlegen: pro Version und Mod-ID gewinnt die neuere Datei. */
function mergeBeta(stable, beta) {
  const out = JSON.parse(JSON.stringify(stable));
  for (const [v, e] of Object.entries(beta.versions || {})) {
    const target = out.versions[v] || (out.versions[v] = { files: {} });
    for (const [id, f] of Object.entries(e.files)) {
      const cur = target.files[id];
      if (!cur || isNewer(f.version, cur.version) || (cleanVersion(f.version) === cleanVersion(cur.version) && f.sha256 !== cur.sha256)) {
        target.files[id] = { ...f, channel: 'beta' };
      }
    }
  }
  return out;
}

function validManifest(m) {
  if (!m || typeof m !== 'object' || typeof m.versions !== 'object') return { schema: 1, versions: {}, news: [] };
  const out = { schema: 1, updatedAt: String(m.updatedAt || ''), versions: {} };
  for (const [v, entry] of Object.entries(m.versions || {})) {
    if (!isValidMinecraftVersion(v) || !entry || typeof entry.files !== 'object') continue;
    const files = {};
    for (const [id, f] of Object.entries(entry.files)) {
      if (!/^[a-z0-9_-]{1,64}$/i.test(id) || !f || !safeName(f.file) || !/^[a-f0-9]{64}$/i.test(String(f.sha256 || ''))) continue;
      files[id] = {
        file: f.file, version: String(f.version || ''), name: String(f.name || id).slice(0, 80),
        sha256: String(f.sha256).toLowerCase(), size: Number(f.size) || 0, uploadedAt: String(f.uploadedAt || ''),
        notes: String(f.notes || '').slice(0, 4000),
        channel: f.channel === 'beta' ? 'beta' : 'stable'
      };
    }
    if (Object.keys(files).length) out.versions[v] = { files };
  }
  out.news = (Array.isArray(m.news) ? m.news : []).filter(n => n && typeof n.title === 'string').slice(0, 30).map(n => ({
    id: String(n.id || '').slice(0, 20), title: n.title.slice(0, 100), body: String(n.body || '').slice(0, 1500), date: String(n.date || '')
  }));
  return out;
}

function manifest() { return validManifest(loadJson(manifestFile(), null)); }

/** MC-Versionen, fuer die online ein Vortex-Client liegt. */
function versions() {
  return Object.entries(manifest().versions).filter(([, e]) => Object.keys(e.files).some(id => CORE_IDS.has(id))).map(([v]) => v);
}

function localPath(version, file) { return path.join(root(), version, file); }

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Verifizierte, heruntergeladene Dateien einer Version. */
function entries(version) {
  const e = manifest().versions[version];
  if (!e) return [];
  const out = [];
  for (const [id, f] of Object.entries(e.files)) {
    const file = localPath(version, f.file);
    if (!exists(file)) continue;
    try { if (fs.statSync(file).size !== f.size && f.size) continue; } catch (_) { continue; }
    out.push({ id, kind: kindOf(id), name: f.file, file, version: f.version, source: 'online', uploadedAt: f.uploadedAt });
  }
  return out;
}

async function download(url, expectedSha, maxSize) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'VortexClientLauncher' } });
  if (!res.ok) throw new Error(`download answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxSize) throw new Error('file too large');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (expectedSha && sha !== expectedSha) throw new Error('checksum does not match');
  return buf;
}

/**
 * Manifest holen und fehlende/neuere Dateien laden.
 * @param {(v:string)=>{id:string,version:string}[]} bundledFor mitgelieferte Dateien je Version
 * @returns {Promise<{updated:{version,id,name,version_:string}[], error?:string}>}
 */
async function refresh(bundledFor, { versionsOnly = null } = {}) {
  let remote;
  try {
    remote = await fetchManifest('manifest.json');
    if (betaCheck()) {
      try { remote = mergeBeta(remote, await fetchManifest('manifest-beta.json')); }
      catch (e) { log(`Beta manifest: ${e.message}`, 'warn'); }
    }
  } catch (e) {
    lastCheck = { at: Date.now(), ok: false, error: e.message };
    return { updated: [], error: e.message };
  }
  ensureDir(root());
  writeJson(manifestFile(), remote);
  const updated = [];
  for (const [v, e] of Object.entries(remote.versions)) {
    if (versionsOnly && !versionsOnly.includes(v)) continue;
    const bundled = bundledFor(v);
    for (const [id, f] of Object.entries(e.files)) {
      const b = bundled.find(x => x.id === id);
      if (b && !isNewer(f.version, b.version)) continue;                 // mitgeliefert ist gleich neu oder neuer
      const target = localPath(v, f.file);
      if (exists(target)) {
        try { if (sha256File(target) === f.sha256) continue; } catch (_) {}
      }
      try {
        const buf = await download(assetUrl(f.file), f.sha256, 200 * 1024 * 1024);
        ensureDir(path.dirname(target));
        fs.writeFileSync(`${target}.part`, buf);
        fs.renameSync(`${target}.part`, target);
        updated.push({ version: v, id, kind: kindOf(id), name: f.name, newVersion: cleanVersion(f.version), notes: f.notes || '', channel: f.channel || 'stable' });
        log(`Vortex update: ${f.name} ${cleanVersion(f.version)} for Minecraft ${v} downloaded.`);
      } catch (err) {
        log(`Vortex update ${f.file}: ${err.message}`, 'warn');
      }
    }
  }
  // Alte Dateien aufraeumen
  try {
    for (const v of fs.readdirSync(root())) {
      const dir = path.join(root(), v);
      if (!fs.statSync(dir).isDirectory()) continue;
      const keep = new Set(Object.values(remote.versions[v]?.files || {}).map(f => f.file));
      for (const f of fs.readdirSync(dir)) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch (_) {}
  lastCheck = { at: Date.now(), ok: true, error: null };
  return { updated };
}

module.exports = {
  CORE_IDS, ADDON_IDS, kindOf, cleanVersion, isNewer, safeName,
  manifest, validManifest, versions, entries, refresh, assetUrl, sha256File, setBetaCheck, mergeBeta,
  betaActive: () => { try { return Boolean(betaCheck()); } catch (_) { return false; } },
  status: () => lastCheck
};
