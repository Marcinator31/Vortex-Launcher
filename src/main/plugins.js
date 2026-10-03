'use strict';
/**
 * Plugin-Installer fuer das Hosten (Paper-Server, seit Launcher 2.5).
 *
 * Wie der Mod-Installer, nur fuer Server-Plugins: Suche auf Modrinth
 * (Projekttyp "plugin", passend zu Paper/Bukkit/Spigot/Purpur und zur
 * Minecraft-Version), Installieren mit Pruefsumme, Liste der installierten
 * Plugins, Entfernen. Eigene Jars, die jemand von Hand in den Ordner legt,
 * tauchen ebenfalls in der Liste auf (Name/Version aus plugin.yml).
 *
 * Die Plugins gelten fuer alle Welten einer Minecraft-Version
 * (<Daten>/hosting/<version>/server/plugins). Neue oder entfernte Plugins
 * wirken nach dem naechsten Serverstart.
 */
const fs = require('fs');
const path = require('path');
const { paths, ensureDir, exists, log, loadJson, writeJson } = require('./core');
const instances = require('./instances');
const modrinth = require('./modrinth');
const zip = require('./zip');

const LOADERS = ['paper', 'bukkit', 'spigot', 'purpur'];
const PAGE = 20;

const serverDir = v => path.join(paths.dataRoot, 'hosting', v, 'server');
function pluginsDir(version) {
  const d = path.join(serverDir(instances.requireVersion(version)), 'plugins');
  ensureDir(d);
  return d;
}
const metaFile = v => path.join(pluginsDir(v), '.vortex-plugins.json');

async function search(query, version, page = 0, sort = 'relevance') {
  const v = instances.requireVersion(version);
  const q = String(query || '').trim().slice(0, 80);
  const p = Math.max(0, Math.min(200, Number(page) || 0));
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : (q ? 'relevance' : 'downloads');
  const facets = [['project_type:plugin'], LOADERS.map(l => `categories:${l}`), [`versions:${v}`]];
  const params = new URLSearchParams({ query: q, facets: JSON.stringify(facets), limit: String(PAGE), offset: String(p * PAGE), index });
  const res = await modrinth.api(`/search?${params}`);
  const have = new Set(Object.values(loadJson(metaFile(v), {}) || {}).map(m => m.projectId));
  return {
    results: (res.hits || []).map(h => ({
      projectId: h.project_id, slug: h.slug, title: h.title, author: h.author || '',
      description: h.description || '', downloads: h.downloads || 0,
      iconUrl: /^https:\/\/cdn\.modrinth\.com\//.test(h.icon_url || '') ? h.icon_url : null,
      categories: (h.display_categories || h.categories || []).filter(c => !LOADERS.includes(c)).slice(0, 3),
      installed: have.has(h.project_id)
    })),
    page: p, total: res.total_hits || 0, hasNext: (p + 1) * PAGE < (res.total_hits || 0)
  };
}

/** Plugin installieren (neueste passende Fassung). Ersetzt eine aeltere Fassung desselben Plugins. */
async function install(projectId, version) {
  const v = instances.requireVersion(version);
  const id = await modrinth.resolveProject(projectId);
  const [project, list] = await Promise.all([
    modrinth.api(`/project/${encodeURIComponent(id)}`),
    modrinth.api(`/project/${encodeURIComponent(id)}/version`)
  ]);
  let ver = null;
  for (const l of LOADERS) { ver = modrinth.bestVersion(list, v, l); if (ver) break; }
  const file = ver && modrinth.primaryFile(ver.files, '.jar');
  if (!file) throw new Error(`${project.title} has no build for Minecraft ${v}.`);
  if (!modrinth.safeJar(file.filename)) throw new Error('The file name is not safe.');
  const dir = pluginsDir(v);
  const meta = loadJson(metaFile(v), {}) || {};
  // Alte Fassung desselben Plugins entfernen
  for (const [f, m] of Object.entries(meta)) {
    if (m.projectId === id && f !== file.filename) { fs.rmSync(path.join(dir, f), { force: true }); delete meta[f]; }
  }
  const buf = await modrinth.downloadVerified(file, 200 * 1024 * 1024);
  const tmp = path.join(dir, `${file.filename}.download`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, path.join(dir, file.filename));
  meta[file.filename] = {
    projectId: id, title: project.title, version: ver.version_number || '',
    iconUrl: /^https:\/\/cdn\.modrinth\.com\//.test(project.icon_url || '') ? project.icon_url : null,
    installedAt: new Date().toISOString()
  };
  writeJson(metaFile(v), meta);
  log(`Plugin installed for hosting ${v}: ${project.title} ${ver.version_number || ''}`);
  return { file: file.filename, title: project.title };
}

/** plugin.yml / paper-plugin.yml lesen (einfaches YAML: name, version, description). */
function pluginYml(file) {
  try {
    const z = zip.open(file);
    const name = ['paper-plugin.yml', 'plugin.yml'].find(n => z.entries.has(n));
    if (!name) return null;
    const text = String(z.read(name, 256 * 1024) || '');
    const val = k => { const m = text.match(new RegExp(`^${k}\\s*:\\s*["']?([^"'\\r\\n#]+)`, 'm')); return m ? m[1].trim() : ''; };
    return { name: val('name'), version: val('version'), description: val('description') };
  } catch (_) { return null; }
}

function list(version) {
  const v = instances.requireVersion(version);
  const dir = pluginsDir(v);
  const meta = loadJson(metaFile(v), {}) || {};
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.jar$/i.test(f)); } catch (_) {}
  const out = files.map(f => {
    const m = meta[f];
    const y = pluginYml(path.join(dir, f));
    let size = 0;
    try { size = fs.statSync(path.join(dir, f)).size; } catch (_) {}
    return {
      file: f, title: m?.title || y?.name || f.replace(/\.jar$/i, ''), version: m?.version || y?.version || '',
      description: y?.description || '', iconUrl: m?.iconUrl || null, projectId: m?.projectId || null, size
    };
  });
  // Eintraege zu geloeschten Dateien aufraeumen
  let changed = false;
  for (const f of Object.keys(meta)) if (!files.includes(f)) { delete meta[f]; changed = true; }
  if (changed) writeJson(metaFile(v), meta);
  return { plugins: out.sort((a, b) => a.title.localeCompare(b.title)), dir };
}

function remove(version, file) {
  const v = instances.requireVersion(version);
  if (!modrinth.safeJar(String(file || ''))) throw new Error('Invalid file.');
  const dir = pluginsDir(v);
  const target = path.join(dir, file);
  if (!exists(target)) return {};
  fs.rmSync(target, { force: true });
  const meta = loadJson(metaFile(v), {}) || {};
  delete meta[file];
  writeJson(metaFile(v), meta);
  log(`Plugin removed from hosting ${v}: ${file}`);
  return {};
}

module.exports = { search, install, list, remove, pluginsDir, serverDir };
