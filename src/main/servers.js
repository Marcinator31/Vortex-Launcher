'use strict';
/**
 * Server-Bibliothek mit Live-Status (Favicon, MOTD, Spieler, Ping).
 * VortexPvP ist fest dabei; eigene Server werden in servers.json gespeichert
 * (gleiches Format wie im alten Launcher).
 */
const crypto = require('crypto');
const path = require('path');
const { paths, loadJson, writeJson, send } = require('./core');
const { getMinecraftServerStatus } = require('./minecraft-status');

const OFFICIAL = Object.freeze({ id: 'official-vortexpvp', name: 'VortexPvP', address: 'mc.vortexpvp.eu', official: true });
const CACHE_MS = 60 * 1000;
const cache = new Map();
const pending = new Map();

function normalizeAddress(value) {
  const input = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!input || input.length > 253 || /[\s/\\@]/.test(input)) return null;
  const parts = input.split(':');
  if (parts.length > 2) return null;
  const [host, port = ''] = parts;
  const hostOk = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost';
  if (!hostOk) return null;
  if (port && (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535)) return null;
  return port ? `${host}:${Number(port)}` : host;
}

function stored() {
  const data = loadJson(paths.serversFile, {});
  const seen = new Set([OFFICIAL.address]);
  const list = Array.isArray(data?.servers) ? data.servers : [];
  return list.map(e => {
    const name = String(e?.name || '').trim().replace(/\s+/g, ' ').slice(0, 42);
    const address = normalizeAddress(e?.address);
    const id = String(e?.id || '');
    if (!name || !address || !/^[a-z0-9][a-z0-9_-]{3,60}$/i.test(id) || seen.has(address)) return null;
    seen.add(address);
    return { id, name, address, official: false, addedAt: String(e?.addedAt || '') };
  }).filter(Boolean).slice(0, 60);
}

function all() { return [OFFICIAL, ...stored()]; }
function byId(id) { return all().find(s => s.id === String(id || '')) || null; }
function byAddress(address) {
  const a = normalizeAddress(address);
  const ohnePort = x => String(x || '').replace(/:25565$/, '');
  return a ? all().find(s => ohnePort(s.address) === ohnePort(a)) || null : null;
}
function withStatus(s) {
  const h = verlauf().servers[s.id] || {};
  return { ...s, status: cache.get(s.id)?.status || null, favorite: Boolean(h.favorite), lastPlayed: h.lastPlayed || null, history: zusammenfassung(h.points || []) };
}
function list() {
  // Favoriten zuerst, sonst die gewohnte Reihenfolge (VortexPvP oben)
  const l = all().map(withStatus);
  return [...l.filter(s => s.favorite), ...l.filter(s => !s.favorite)];
}

// ---------------------------------------------------------------------------
// Verlauf: Ping und Spielerzahl, Favoriten, zuletzt gespielt
// ---------------------------------------------------------------------------
//
// Jede Statusabfrage wird gemerkt (hoechstens ein Punkt je 4 Minuten und
// Server, 7 Tage lang). Solange der Launcher offen ist, fragt er Favoriten,
// VortexPvP und kuerzlich gespielte Server alle 5 Minuten ab -- so entsteht
// auch ohne Klicken eine Kurve. Punkt = [Zeit, Ping|null, online 0/1, Spieler].

const histFile = () => path.join(paths.dataRoot, 'server-history.json');
const TAG = 24 * 60 * 60 * 1000;
let hist = null;
let saveTimer = null;

function verlauf() {
  if (!hist) {
    const d = loadJson(histFile(), {});
    hist = { v: 1, servers: d && typeof d.servers === 'object' && d.servers ? d.servers : {} };
  }
  return hist;
}

function speichernBald() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      // Eintraege geloeschter Server nicht ewig mitschleppen
      const ids = new Set(all().map(s => s.id));
      for (const id of Object.keys(hist.servers)) if (!ids.has(id)) delete hist.servers[id];
      writeJson(histFile(), hist);
    } catch (_) {}
  }, 3000);
}

function eintrag(id) {
  const h = verlauf();
  if (!h.servers[id]) h.servers[id] = { points: [] };
  if (!Array.isArray(h.servers[id].points)) h.servers[id].points = [];
  return h.servers[id];
}

function merken(id, st) {
  const e = eintrag(id);
  const jetzt = Date.now();
  const letzter = e.points[e.points.length - 1];
  if (letzter && jetzt - letzter[0] < 4 * 60 * 1000) return;
  const online = Boolean(st && st.online);
  const ping = online && Number.isFinite(st.latency) ? Math.round(st.latency) : null;
  const spieler = online && Number.isFinite(st.players?.online) ? st.players.online : 0;
  e.points.push([jetzt, ping, online ? 1 : 0, spieler]);
  e.points = e.points.filter(p => jetzt - p[0] < 7 * TAG).slice(-2100);
  speichernBald();
}

/**
 * Fuer die Anzeige: 24 Stunden in 48 Abschnitten (je 30 Minuten, hoechste
 * Spielerzahl), dazu Hoechstwert, mittlerer Ping und Anteil online.
 */
function zusammenfassung(points) {
  const jetzt = Date.now();
  const tag = points.filter(p => jetzt - p[0] < TAG);
  if (!tag.length) return null;
  const spark = new Array(48).fill(null);
  for (const p of tag) {
    const i = Math.min(47, Math.floor((p[0] - (jetzt - TAG)) / (TAG / 48)));
    if (i >= 0) spark[i] = Math.max(spark[i] ?? 0, p[2] ? p[3] : 0);
  }
  const pings = tag.map(p => p[1]).filter(x => x != null);
  return {
    spark,
    peak: Math.max(0, ...tag.map(p => (p[2] ? p[3] : 0))),
    avgPing: pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null,
    uptime: Math.round(tag.filter(p => p[2]).length / tag.length * 100),
    samples: tag.length,
    since: tag[0][0]
  };
}

function setFavorite(id, value) {
  const s = byId(id);
  if (!s) throw new Error('Server not found.');
  eintrag(s.id).favorite = Boolean(value);
  speichernBald();
  return true;
}

/** Aus dem Start: dieser Server wurde gerade betreten. */
function markPlayed(address) {
  const s = byAddress(address);
  if (!s) return;
  eintrag(s.id).lastPlayed = Date.now();
  speichernBald();
}

let poller = null;
function startHistory() {
  if (poller) return;
  const runde = async () => {
    const h = verlauf();
    const ziele = all().filter(s => s.official || h.servers[s.id]?.favorite
      || (h.servers[s.id]?.lastPlayed && Date.now() - h.servers[s.id].lastPlayed < 7 * TAG)).slice(0, 12);
    for (const s of ziele) { try { await status(s.id, true); } catch (_) {} }
    try { send('serverHistory', list()); } catch (_) {}
  };
  setTimeout(() => void runde(), 20000);
  poller = setInterval(() => void runde(), 5 * 60 * 1000);
  poller.unref?.();
}

function persist(list) {
  writeJson(paths.serversFile, { schemaVersion: 3, servers: list.filter(s => !s.official).map(({ id, name, address, addedAt }) => ({ id, name, address, addedAt })) });
}

function add({ name, address }) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 42);
  const a = normalizeAddress(address);
  if (!n) throw new Error('Give the server a name.');
  if (!a) throw new Error('That is not a valid server address.');
  const current = stored();
  if (a === OFFICIAL.address || current.some(s => s.address === a)) throw new Error('This server is already in your list.');
  const server = { id: `srv-${crypto.randomBytes(6).toString('hex')}`, name: n, address: a, official: false, addedAt: new Date().toISOString() };
  persist([...current, server]);
  return withStatus(server);
}

function remove(id) {
  const s = byId(id);
  if (!s) return true;
  if (s.official) throw new Error('The official Vortex server cannot be removed.');
  persist(stored().filter(x => x.id !== s.id));
  cache.delete(s.id);
  return true;
}

async function status(id, force = false) {
  const s = byId(id);
  if (!s) throw new Error('Server not found.');
  const c = cache.get(s.id);
  if (!force && c && Date.now() - c.at < CACHE_MS) return c.status;
  if (pending.has(s.id)) return pending.get(s.id);
  const task = getMinecraftServerStatus(s.address).then(st => {
    cache.set(s.id, { status: st, at: Date.now() });
    try { merken(s.id, st); } catch (_) {}
    return st;
  });
  pending.set(s.id, task);
  try { return await task; } finally { pending.delete(s.id); }
}

module.exports = { list, add, remove, status, byId, byAddress, OFFICIAL, normalizeAddress, setFavorite, markPlayed, startHistory };
