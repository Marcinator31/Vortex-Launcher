'use strict';
/**
 * Dateien des gehosteten Servers bearbeiten (Hosting -> Files).
 *
 * Gezeigt werden nur Textdateien, die man wirklich einstellt: die Server-
 * Dateien im Hauptordner (server.properties, bukkit.yml, spigot.yml ...),
 * die Paper-Einstellungen in config/ und alles in den Plugin-Ordnern
 * (plugins/<Plugin>/config.yml, messages.yml ...). Welten, Bibliotheken,
 * Logs und Jars bleiben aussen vor.
 *
 * Sicherheit: jeder Pfad wird gegen den Server-Ordner geprueft (kein "..",
 * keine absoluten Pfade), nur Text-Endungen, hoechstens 1 MB.
 *
 * Speichern: YAML ohne Tabs zum Einruecken und JSON gueltig, sonst Fehler (ein kaputtes
 * config.yml laesst viele Plugins gar nicht erst starten). Vor dem
 * Ueberschreiben kommt eine Sicherung nach .vortex-backups/ (die letzten 5
 * je Datei). Hat ein Plugin die Datei seit dem Oeffnen selbst geaendert,
 * wird nicht still ueberschrieben.
 */
const fs = require('fs');
const path = require('path');
const { ensureDir, exists } = require('./core');
const instances = require('./instances');
const plugins = require('./plugins');

const TEXT = /\.(ya?ml|json|properties|txt|conf|cfg|toml|ini|lang|csv|sk|md|xml|hocon)$/i;
const MAX_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['libraries', 'versions', 'cache', 'logs', 'crash-reports', 'worlds', '.paper', '.vortex-backups', '.paper-remapped', 'debug']);
const BACKUPS = '.vortex-backups';

const root = version => plugins.serverDir(instances.requireVersion(version));

/** Relativer Pfad -> absoluter, nur innerhalb des Server-Ordners. */
function resolve(version, rel) {
  const base = path.resolve(root(version));
  const clean = String(rel || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean) || clean.split('/').some(p => p === '..' || p === '')) throw new Error('Invalid file.');
  const abs = path.resolve(base, clean);
  if (!abs.startsWith(base + path.sep)) throw new Error('Invalid file.');
  if (!TEXT.test(abs)) throw new Error('Only text files can be edited here.');
  if (clean.split('/').some(p => SKIP_DIRS.has(p))) throw new Error('This file cannot be edited here.');
  return abs;
}

/** Alle bearbeitbaren Dateien, gruppiert: "Server" und je Plugin-Ordner. */
function list(version) {
  const base = root(version);
  const files = [];
  const walk = (dir, rel, tiefe) => {
    if (tiefe > 6 || files.length >= 3000) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Im Hauptordner nur config/ und plugins/ -- der Rest sind Welten, Logs ...
        if (tiefe === 0 && e.name !== 'config' && e.name !== 'plugins') continue;
        walk(abs, r, tiefe + 1);
      } else if (TEXT.test(e.name)) {
        let st;
        try { st = fs.statSync(abs); } catch (_) { continue; }
        if (st.size > MAX_BYTES) continue;
        const teile = r.split('/');
        const group = teile[0] === 'plugins' && teile.length > 2 ? teile[1] : 'Server';
        files.push({ path: r, group, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  if (exists(base)) walk(base, '', 0);
  // "Server" zuerst, dann die Plugins nach Name; innerhalb einer Gruppe nach Pfad
  const rang = f => (f.group === 'Server' ? '' : `~${f.group.toLowerCase()}`);
  files.sort((a, b) => rang(a).localeCompare(rang(b)) || a.path.localeCompare(b.path));
  return { files };
}

function read(version, rel) {
  const abs = resolve(version, rel);
  if (!exists(abs)) throw new Error('This file no longer exists.');
  const st = fs.statSync(abs);
  if (st.size > MAX_BYTES) throw new Error('This file is too big to edit here (max 1 MB).');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw new Error('This is not a text file.');
  return { path: rel, text: buf.toString('utf8'), mtime: st.mtimeMs };
}

/** YAML: Tabs zum Einruecken sind verboten -- der haeufigste Grund fuer kaputte Configs. */
function checkYaml(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^ *\t/.test(lines[i])) return `Line ${i + 1}: YAML does not allow tabs for indenting -- use spaces.`;
  }
  return null;
}

function write(version, rel, text, { mtime = null, force = false } = {}) {
  const abs = resolve(version, rel);
  const body = String(text ?? '');
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('This file is too big (max 1 MB).');
  if (/\.ya?ml$/i.test(abs)) { const err = checkYaml(body); if (err) throw new Error(err); }
  if (/\.json$/i.test(abs) && body.trim()) {
    try { JSON.parse(body); } catch (e) { throw new Error(`This is not valid JSON: ${e.message}`); }
  }
  if (exists(abs)) {
    const st = fs.statSync(abs);
    if (!force && mtime && Math.abs(st.mtimeMs - Number(mtime)) > 1) {
      const e = new Error('The file was changed meanwhile (probably by the plugin). Reload it or save again to overwrite.');
      e.conflict = true;
      throw e;
    }
    backup(version, rel, abs);
  }
  ensureDir(path.dirname(abs));
  const tmp = `${abs}.vortex-tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, abs);
  return { saved: true, mtime: fs.statSync(abs).mtimeMs };
}

function backup(version, rel, abs) {
  try {
    const dir = path.join(root(version), BACKUPS, path.dirname(rel));
    ensureDir(dir);
    const name = path.basename(rel);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(abs, path.join(dir, `${name}.${stamp}`));
    const alte = fs.readdirSync(dir).filter(f => f.startsWith(`${name}.`)).sort();
    for (const f of alte.slice(0, Math.max(0, alte.length - 5))) fs.rmSync(path.join(dir, f), { force: true });
  } catch (_) { /* eine Sicherung darf das Speichern nicht verhindern */ }
}

module.exports = { list, read, write, checkYaml, resolve };
