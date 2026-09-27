'use strict';
/**
 * Liest fabric.mod.json (Name, Version, Beschreibung) und das Mod-Icon direkt
 * aus einer .jar -- ohne Zusatzbibliothek. Eine .jar ist ein ZIP: am Ende
 * steht das Inhaltsverzeichnis, daraus holen wir genau zwei Dateien.
 *
 * Ergebnis wird je Datei (Pfad + Groesse + Aenderungszeit) zwischengespeichert.
 */
const fs = require('fs');

const { readEntries, extract } = require('./zip');

const cache = new Map();

function pickIcon(icon) {
  if (typeof icon === 'string') return icon;
  if (icon && typeof icon === 'object') {
    const sizes = Object.keys(icon).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const best = sizes.find(s => s >= 64) || sizes[sizes.length - 1];
    return best !== undefined ? icon[String(best)] : null;
  }
  return null;
}

/** IDs (und "provides") aller eingebetteten Jars, bis zu zwei Ebenen tief. */
function nestedIds(buf, entries, meta, depth) {
  const out = [];
  if (depth > 1 || !Array.isArray(meta?.jars)) return out;
  for (const j of meta.jars.slice(0, 120)) {
    try {
      const inner = extract(buf, entries.get(String(j?.file || '').replace(/^\//, '')), 32 * 1024 * 1024);
      if (!inner) continue;
      const innerEntries = readEntries(inner);
      const raw = innerEntries && extract(inner, innerEntries.get('fabric.mod.json'));
      if (!raw) continue;
      const m = JSON.parse(raw.toString('utf8').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' '));
      if (m.id) out.push(String(m.id));
      if (Array.isArray(m.provides)) out.push(...m.provides.map(String));
      out.push(...nestedIds(inner, innerEntries, m, depth + 1));
    } catch (_) {}
  }
  return out;
}

/** { id, name, version, description, authors, icon (data-URL), minecraft, depends, provides, breaks, nested } oder null. */
function readModInfo(file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return null; }
  if (!stat.isFile() || stat.size > 200 * 1024 * 1024) return null;
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const buf = fs.readFileSync(file);
    const entries = readEntries(buf);
    const metaRaw = entries && extract(buf, entries.get('fabric.mod.json'));
    if (metaRaw) {
      // Manche Mods haben Steuerzeichen in Strings -- vorsichtig parsen.
      const meta = JSON.parse(metaRaw.toString('utf8').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' '));
      let icon = null;
      const iconPath = pickIcon(meta.icon);
      if (iconPath && /\.png$/i.test(iconPath)) {
        const img = extract(buf, entries.get(iconPath.replace(/^\//, '')));
        if (img && img.length < 512 * 1024) icon = `data:image/png;base64,${img.toString('base64')}`;
      }
      const authors = Array.isArray(meta.authors)
        ? meta.authors.map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean).slice(0, 3) : [];
      result = {
        id: String(meta.id || ''),
        name: String(meta.name || meta.id || ''),
        version: String(meta.version || ''),
        description: String(meta.description || '').slice(0, 300),
        authors,
        icon,
        // Fuer Admin-Bereich und Absturz-Analyse
        minecraft: typeof meta.depends?.minecraft === 'string' ? meta.depends.minecraft
          : Array.isArray(meta.depends?.minecraft) ? meta.depends.minecraft.join(' || ') : '',
        depends: meta.depends && typeof meta.depends === 'object' ? Object.keys(meta.depends) : [],
        provides: Array.isArray(meta.provides) ? meta.provides.map(String) : [],
        // "breaks": { modId: Versionsbedingung } -- fuer die Pruefung vor dem Start
        breaks: meta.breaks && typeof meta.breaks === 'object' && !Array.isArray(meta.breaks)
          ? Object.fromEntries(Object.entries(meta.breaks).map(([k, v]) => [k, Array.isArray(v) ? v.join(' || ') : String(v)])) : {},
        // Mods, die IN dieser Jar stecken (Jar-in-Jar, z. B. die Module der Fabric API)
        nested: nestedIds(buf, entries, meta, 0)
      };
    }
  } catch (_) { result = null; }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}

module.exports = { readModInfo };
