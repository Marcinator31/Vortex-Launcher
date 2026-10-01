'use strict';
/**
 * Minimales NBT (Minecrafts Dateiformat fuer level.dat und Spielerdaten):
 * lesen und unveraendert wieder schreiben.
 *
 * Jeder Wert ist { type, value } -- so bleibt beim Zurueckschreiben jeder Typ
 * erhalten (ein Byte bleibt ein Byte, ein Long ein BigInt-Long ...).
 *   Compound: value = Map(name -> {type, value})
 *   List:     value = { itemType, items: [value, ...] }
 */
const zlib = require('zlib');

const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

function reader(buf) {
  let o = 0;
  const need = n => { if (o + n > buf.length) throw new Error('NBT data is cut off.'); };
  const r = {
    byte() { need(1); return buf.readInt8(o++); },
    ubyte() { need(1); return buf.readUInt8(o++); },
    short() { need(2); const v = buf.readInt16BE(o); o += 2; return v; },
    int() { need(4); const v = buf.readInt32BE(o); o += 4; return v; },
    long() { need(8); const v = buf.readBigInt64BE(o); o += 8; return v; },
    float() { need(4); const v = buf.readFloatBE(o); o += 4; return v; },
    double() { need(8); const v = buf.readDoubleBE(o); o += 8; return v; },
    string() { need(2); const n = buf.readUInt16BE(o); o += 2; need(n); const s = buf.toString('utf8', o, o + n); o += n; return s; },
    raw(n) { need(n); const b = Buffer.from(buf.subarray(o, o + n)); o += n; return b; }
  };
  function payload(type, depth) {
    if (depth > 512) throw new Error('NBT is nested too deeply.');
    switch (type) {
      case T.BYTE: return r.byte();
      case T.SHORT: return r.short();
      case T.INT: return r.int();
      case T.LONG: return r.long();
      case T.FLOAT: return r.float();
      case T.DOUBLE: return r.double();
      case T.BYTE_ARRAY: { const n = r.int(); return r.raw(n); }
      case T.STRING: return r.string();
      case T.LIST: {
        const itemType = r.ubyte(), n = r.int(), items = [];
        for (let i = 0; i < n; i++) items.push(payload(itemType, depth + 1));
        return { itemType, items };
      }
      case T.COMPOUND: {
        const map = new Map();
        for (;;) {
          const t = r.ubyte();
          if (t === T.END) return map;
          const name = r.string();
          map.set(name, { type: t, value: payload(t, depth + 1) });
        }
      }
      case T.INT_ARRAY: { const n = r.int(), a = []; for (let i = 0; i < n; i++) a.push(r.int()); return a; }
      case T.LONG_ARRAY: { const n = r.int(), a = []; for (let i = 0; i < n; i++) a.push(r.long()); return a; }
      default: throw new Error(`Unknown NBT tag ${type}.`);
    }
  }
  return { r, payload };
}

/** Buffer (ungepackt) -> { name, root: {type: COMPOUND, value: Map} } */
function parse(buf) {
  const { r, payload } = reader(buf);
  const type = r.ubyte();
  if (type !== T.COMPOUND) throw new Error('Not an NBT file.');
  const name = r.string();
  return { name, root: { type, value: payload(type, 0) } };
}

function serialize({ name = '', root }) {
  const parts = [];
  const u8 = v => { const b = Buffer.alloc(1); b.writeUInt8(v); parts.push(b); };
  const i8 = v => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const i16 = v => { const b = Buffer.alloc(2); b.writeInt16BE(v); parts.push(b); };
  const i32 = v => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  const i64 = v => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); };
  const str = s => { const b = Buffer.from(String(s), 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); parts.push(l, b); };
  function payload(type, v) {
    switch (type) {
      case T.BYTE: return i8(v);
      case T.SHORT: return i16(v);
      case T.INT: return i32(v);
      case T.LONG: return i64(v);
      case T.FLOAT: { const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b); return undefined; }
      case T.DOUBLE: { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); return undefined; }
      case T.BYTE_ARRAY: i32(v.length); parts.push(Buffer.from(v)); return undefined;
      case T.STRING: return str(v);
      case T.LIST: u8(v.items.length ? v.itemType : (v.itemType || T.END)); i32(v.items.length); for (const it of v.items) payload(v.itemType, it); return undefined;
      case T.COMPOUND: for (const [k, e] of v) { u8(e.type); str(k); payload(e.type, e.value); } u8(T.END); return undefined;
      case T.INT_ARRAY: i32(v.length); for (const x of v) i32(x); return undefined;
      case T.LONG_ARRAY: i32(v.length); for (const x of v) i64(x); return undefined;
      default: throw new Error(`Unknown NBT tag ${type}.`);
    }
  }
  u8(T.COMPOUND); str(name); payload(T.COMPOUND, root.value);
  return Buffer.concat(parts);
}

const readGz = file => parse(zlib.gunzipSync(require('fs').readFileSync(file)));
const toGz = doc => zlib.gzipSync(serialize(doc));

/** Kind eines Compounds holen (oder null). */
const child = (tag, name) => (tag && tag.type === T.COMPOUND ? tag.value.get(name) || null : null);

module.exports = { T, parse, serialize, readGz, toGz, child };
