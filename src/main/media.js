'use strict';
/**
 * Welten (inkl. Backups), Screenshots und Shader-Packs einer Instanz.
 *
 * Backups sind einfache Ordnerkopien unter %APPDATA%\Vortex Client\backups.
 * Welt-Dateien sind schon komprimiert -- ZIP wuerde kaum Platz sparen, aber
 * bei grossen Welten (> 4 GB) Probleme machen.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { shell, nativeImage, clipboard } = require('electron');
const { paths, ensureDir, exists, loadJson, writeJson, log } = require('./core');
const instances = require('./instances');

const savesRoot = v => path.join(paths.instanceRoot(v), 'saves');
const backupsRoot = v => path.join(paths.dataRoot, 'backups', v);
const screenshotsRoot = v => path.join(paths.instanceRoot(v), 'screenshots');
const safeDirName = n => typeof n === 'string' && n && n === path.basename(n) && !n.startsWith('.') && !/[<>:"|?*]/.test(n);

function stamp(d = new Date()) {
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function dirSize(dir, cap = 200000) {
  let total = 0, count = 0;
  const stack = [dir];
  while (stack.length && count < cap) {
    const d = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      count++;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { total += (await fsp.stat(p)).size; } catch (_) {} }
    }
  }
  return total;
}

/** Weltname aus level.dat (NBT, gzip) -- nur das Feld "LevelName". */
function levelName(dir) {
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'level.dat')));
    const key = Buffer.from([0x08, 0x00, 0x09, ...Buffer.from('LevelName')]);
    const i = raw.indexOf(key);
    if (i < 0) return null;
    const len = raw.readUInt16BE(i + key.length);
    return raw.toString('utf8', i + key.length + 2, i + key.length + 2 + len).slice(0, 64) || null;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Welten
// ---------------------------------------------------------------------------

async function listWorlds(version) {
  const v = instances.requireVersion(version);
  const dir = savesRoot(v);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && exists(path.join(dir, e.name, 'level.dat'))); } catch (_) {}
  const backups = listBackupsRaw(v);
  const worlds = await Promise.all(entries.map(async e => {
    const wdir = path.join(dir, e.name);
    let icon = null;
    try { const ip = path.join(wdir, 'icon.png'); if (exists(ip) && fs.statSync(ip).size < 256 * 1024) icon = `data:image/png;base64,${fs.readFileSync(ip).toString('base64')}`; } catch (_) {}
    let lastPlayed = null;
    try { lastPlayed = fs.statSync(path.join(wdir, 'level.dat')).mtime.toISOString(); } catch (_) {}
    return {
      folder: e.name, name: levelName(wdir) || e.name, icon, lastPlayed,
      size: await dirSize(wdir),
      backups: backups.filter(b => b.folder === e.name)
    };
  }));
  // Backups von geloeschten Welten auch zeigen (zum Wiederherstellen)
  const orphans = [...new Set(backups.map(b => b.folder))].filter(f => !worlds.some(w => w.folder === f))
    .map(f => ({ folder: f, name: backups.find(b => b.folder === f)?.name || f, icon: null, lastPlayed: null, size: 0, missing: true, backups: backups.filter(b => b.folder === f) }));
  return [...worlds, ...orphans].sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
}

function listBackupsRaw(v) {
  const root = backupsRoot(v);
  const out = [];
  let worlds = [];
  try { worlds = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()); } catch (_) {}
  for (const w of worlds) {
    let snaps = [];
    try { snaps = fs.readdirSync(path.join(root, w.name), { withFileTypes: true }).filter(e => e.isDirectory()); } catch (_) {}
    for (const s of snaps) {
      const meta = loadJson(path.join(root, w.name, s.name, 'vortex-backup.json'), {});
      out.push({ id: `${w.name}/${s.name}`, folder: w.name, name: meta.name || w.name, createdAt: meta.createdAt || null, size: meta.size || 0, reason: meta.reason || 'manual' });
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function backupWorld(version, folder, reason = 'manual') {
  const v = instances.requireVersion(version);
  if (!safeDirName(folder)) throw new Error('Invalid world.');
  const src = path.join(savesRoot(v), folder);
  if (!exists(path.join(src, 'level.dat'))) throw new Error('This world no longer exists.');
  let target = path.join(backupsRoot(v), folder, stamp());
  for (let n = 2; exists(target); n++) target = path.join(backupsRoot(v), folder, `${stamp()}_${n}`);   // nie ein Backup ueberschreiben
  ensureDir(path.dirname(target));
  await fsp.cp(src, target, { recursive: true, filter: p => path.basename(p) !== 'session.lock' });
  const size = await dirSize(target);
  writeJson(path.join(target, 'vortex-backup.json'), { name: levelName(src) || folder, createdAt: new Date().toISOString(), size, reason });
  // Automatische Backups: nur die letzten 5 je Welt behalten
  if (reason !== 'manual') {
    const autos = listBackupsRaw(v).filter(b => b.folder === folder && b.reason !== 'manual');
    for (const old of autos.slice(5)) await fsp.rm(path.join(backupsRoot(v), old.id), { recursive: true, force: true }).catch(() => {});
  }
  log(`Backup of "${folder}" (${v}) created.`);
  return { id: `${folder}/${path.basename(target)}`, size };
}

async function backupAll(version, reason) {
  const v = instances.requireVersion(version);
  let n = 0;
  let folders = [];
  try { folders = fs.readdirSync(savesRoot(v), { withFileTypes: true }).filter(e => e.isDirectory() && exists(path.join(savesRoot(v), e.name, 'level.dat'))).map(e => e.name); } catch (_) {}
  for (const f of folders) { try { await backupWorld(v, f, reason); n++; } catch (e) { log(`Backup of ${f} failed: ${e.message}`, 'warn'); } }
  return n;
}

function backupPath(v, id) {
  const [folder, snap] = String(id || '').split('/');
  if (!safeDirName(folder) || !safeDirName(snap)) throw new Error('Invalid backup.');
  const p = path.join(backupsRoot(v), folder, snap);
  if (!exists(p)) throw new Error('This backup no longer exists.');
  return { folder, p };
}

async function restoreBackup(version, id) {
  const v = instances.requireVersion(version);
  const { folder, p } = backupPath(v, id);
  if (require('./hosting').isHosted(v, folder)) throw new Error('You are hosting this world right now. Stop the server first.');
  const dst = path.join(savesRoot(v), folder);
  if (exists(dst)) {
    if (exists(path.join(dst, 'session.lock'))) {
      try { fs.rmSync(path.join(dst, 'session.lock')); } catch (_) { throw new Error('Close Minecraft first -- the world is open.'); }
    }
    await backupWorld(v, folder, 'before restore');
    await fsp.rm(dst, { recursive: true, force: true });
  }
  ensureDir(savesRoot(v));
  await fsp.cp(p, dst, { recursive: true, filter: s => path.basename(s) !== 'vortex-backup.json' });
  log(`World "${folder}" (${v}) restored from backup.`);
  return {};
}

async function deleteBackup(version, id) {
  const v = instances.requireVersion(version);
  const { p } = backupPath(v, id);
  await fsp.rm(p, { recursive: true, force: true });
  return {};
}

async function deleteWorld(version, folder) {
  const v = instances.requireVersion(version);
  if (!safeDirName(folder)) throw new Error('Invalid world.');
  const p = path.join(savesRoot(v), folder);
  if (!exists(p)) return {};
  await shell.trashItem(p);
  return {};
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

function listScreenshots(version) {
  const v = instances.requireVersion(version);
  const dir = screenshotsRoot(v);
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => /\.(png|jpe?g)$/i.test(n)); } catch (_) {}
  return files.map(n => {
    let st = null;
    try { st = fs.statSync(path.join(dir, n)); } catch (_) {}
    return { file: n, size: st?.size || 0, takenAt: st ? st.mtime.toISOString() : null };
  }).sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)));
}

const thumbCache = new Map();
function shotPath(v, file) {
  const f = String(file || '');
  if (!/\.(png|jpe?g)$/i.test(f) || f !== path.basename(f)) throw new Error('Invalid file.');
  const p = path.join(screenshotsRoot(instances.requireVersion(v)), f);
  if (!exists(p)) throw new Error('The screenshot no longer exists.');
  return p;
}

function thumbnail(version, file) {
  const p = shotPath(version, file);
  const key = `${p}|${fs.statSync(p).mtimeMs}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const img = nativeImage.createFromPath(p);
  const data = img.isEmpty() ? null : `data:image/jpeg;base64,${img.resize({ width: 480, quality: 'good' }).toJPEG(82).toString('base64')}`;
  if (thumbCache.size > 400) thumbCache.clear();
  thumbCache.set(key, data);
  return data;
}

function fullImage(version, file) {
  const img = nativeImage.createFromPath(shotPath(version, file));
  if (img.isEmpty()) return null;
  const { width } = img.getSize();
  const out = width > 2560 ? img.resize({ width: 2560, quality: 'best' }) : img;
  return `data:image/jpeg;base64,${out.toJPEG(92).toString('base64')}`;
}

function copyScreenshot(version, file) { clipboard.writeImage(nativeImage.createFromPath(shotPath(version, file))); return {}; }
function showScreenshot(version, file) { shell.showItemInFolder(shotPath(version, file)); return {}; }
async function deleteScreenshot(version, file) { await shell.trashItem(shotPath(version, file)); return {}; }

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------

function listShaders(version) {
  const v = instances.requireVersion(version);
  const dir = paths.shaderPacksRoot(v);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) {}
  const shaders = entries.filter(e => (e.isFile() && /\.zip$/i.test(e.name)) || e.isDirectory()).map(e => {
    let size = 0;
    try { if (e.isFile()) size = fs.statSync(path.join(dir, e.name)).size; } catch (_) {}
    return { file: e.name, folder: e.isDirectory(), size, name: e.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ') };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const mods = instances.modsWithIds(v);
  const iris = mods.find(m => m.id === 'iris');
  return { shaders, iris: iris ? { enabled: iris.enabled, version: iris.version } : null };
}

async function removeShader(version, file) {
  const v = instances.requireVersion(version);
  const f = path.basename(String(file || ''));
  if (!f || f !== String(file) || f.startsWith('.')) throw new Error('Invalid file name.');
  const p = path.join(paths.shaderPacksRoot(v), f);
  if (exists(p)) await shell.trashItem(p);
  return {};
}

module.exports = {
  listWorlds, backupWorld, backupAll, restoreBackup, deleteBackup, deleteWorld,
  listScreenshots, thumbnail, fullImage, copyScreenshot, showScreenshot, deleteScreenshot,
  listShaders, removeShader, savesRoot, backupsRoot
};
