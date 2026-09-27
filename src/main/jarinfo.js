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

/** { id, name, version, description, authors, icon (data-URL), minecraft, depends, provides } oder null. */
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
        provides: Array.isArray(meta.provides) ? meta.provides.map(String) : []
      };
    }
  } catch (_) { result = null; }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
}

module.exports = { readModInfo };
