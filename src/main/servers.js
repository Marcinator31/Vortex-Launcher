'use strict';
/**
 * Server-Bibliothek mit Live-Status (Favicon, MOTD, Spieler, Ping).
 * VortexPvP ist fest dabei; eigene Server werden in servers.json gespeichert
 * (gleiches Format wie im alten Launcher).
 */
const crypto = require('crypto');
const { paths, loadJson, writeJson } = require('./core');
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
function withStatus(s) { return { ...s, status: cache.get(s.id)?.status || null }; }
function list() { return all().map(withStatus); }

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
  const task = getMinecraftServerStatus(s.address).then(st => { cache.set(s.id, { status: st, at: Date.now() }); return st; });
  pending.set(s.id, task);
  try { return await task; } finally { pending.delete(s.id); }
}

module.exports = { list, add, remove, status, byId, OFFICIAL, normalizeAddress };
