'use strict';
/**
 * Kleines ZIP-Modul ohne Zusatzbibliothek: lesen (fuer .jar/.mrpack) und
 * schreiben (fuer .mrpack-Export). Fuer Dateien bis ~2 GB gedacht -- Welten
 * werden deshalb NICHT gezippt, sondern als Ordner gesichert.
 */
const fs = require('fs');
const zlib = require('zlib');

function readEntries(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    entries.set(name, { name, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

function extract(buf, entry, maxSize = 4 * 1024 * 1024) {
  if (!entry || entry.usize > maxSize) return null;
  const l = entry.local;
  if (l + 30 > buf.length || buf.readUInt32LE(l) !== 0x04034b50) return null;
  const start = l + 30 + buf.readUInt16LE(l + 26) + buf.readUInt16LE(l + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, maxSize) });
  return null;
}

/** Ganze ZIP-Datei oeffnen: { names, read(name, max) }. */
function open(file) {
  const buf = fs.readFileSync(file);
  const entries = readEntries(buf);
  if (!entries) throw new Error('This is not a valid ZIP/JAR file.');
  return {
    names: [...entries.keys()],
    entries,
    read: (name, max) => extract(buf, entries.get(name), max)
  };
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * @param {string} file Ziel
 * @param {{name:string, data:Buffer}[]} items
 */
function write(file, items) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const it of items) {
    const name = Buffer.from(it.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(it.data) ? it.data : Buffer.from(it.data);
    const crc = zlib.crc32(raw) >>> 0;
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, ...central, end]));
}

module.exports = { readEntries, extract, open, write };
