'use strict';
/**
 * Microsoft-/Minecraft-Konten (msmc). Mehrere Konten, eines aktiv.
 *
 * Das Dateiformat (account.json, schemaVersion 2) ist dasselbe wie im alten
 * Launcher -- bereits angemeldete Konten bleiben angemeldet.
 */
const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');
const { Auth, tokenUtils } = require('msmc');
const { paths, ensureDir, exists, loadJson, writeJson, log } = require('./core');

let accounts = [];
let active = null;

const idOf = (a = {}) => {
  const uuid = String(a.uuid || '').trim().toLowerCase();
  return uuid || `name:${String(a.username || '').trim().toLowerCase()}`;
};

function load() {
  const stored = loadJson(paths.accountFile, null);
  if (stored && Array.isArray(stored.accounts)) {
    const unique = new Map();
    for (const e of stored.accounts) if (e && typeof e === 'object' && e.auth) unique.set(idOf(e), e);
    accounts = [...unique.values()];
    active = accounts.find(e => idOf(e) === stored.activeAccountId) || accounts[0] || null;
  } else {
    accounts = stored && stored.auth ? [stored] : [];
    active = accounts[0] || null;
  }
}

function save() {
  writeJson(paths.accountFile, { schemaVersion: 2, activeAccountId: active ? idOf(active) : null, accounts });
}

function summary(a) {
  return a ? { id: idOf(a), username: String(a.username || 'Player'), uuid: String(a.uuid || '') } : null;
}
function list() { return accounts.map(summary); }
function current() { return active; }
function currentSummary() { return summary(active); }

function upsert(value, makeActive = true) {
  const id = idOf(value);
  accounts = [value, ...accounts.filter(e => idOf(e) !== id)];
  if (makeActive || (active && idOf(active) === id)) active = value;
  save();
  return value;
}

async function login() {
  const auth = new Auth('select_account');
  const xbox = await auth.launch('electron', {
    width: 520, height: 700, resizable: false, title: 'Sign in with Microsoft', backgroundColor: '#0E0B16'
  });
  const mc = await xbox.getMinecraft();
  const profile = mc.profile || {};
  if (!profile.id) throw new Error('This Microsoft account does not own Minecraft: Java Edition.');
  const value = upsert({ username: profile.name || 'Player', uuid: profile.id, auth: mc.mclc(true) });
  log(`Signed in as ${value.username}.`);
  return summary(value);
}

function select(id) {
  const a = accounts.find(e => idOf(e) === String(id || ''));
  if (!a) throw new Error('Account not found.');
  active = a;
  save();
  return summary(a);
}

function remove(id) {
  const target = String(id || '');
  accounts = accounts.filter(e => idOf(e) !== target);
  if (active && idOf(active) === target) active = accounts[0] || null;
  save();
  return true;
}

async function tokenValid(auth) {
  if (!auth?.access_token) return false;
  try {
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${auth.access_token}` }, signal: AbortSignal.timeout(10000)
    });
    return r.status !== 401;       // nur ein klares 401 heisst "ungueltig"
  } catch (_) { return true; }       // offline / Dienst gestoert: nicht blockieren
}

/**
 * Frische Anmeldedaten fuer den Start. Erneuert den Token still ueber den
 * Refresh-Token; nur wenn das nicht geht, oeffnet sich das Login-Fenster.
 */
async function freshAuth(account, { interactive = true } = {}) {
  const prev = account?.auth;
  const refresh = prev?.meta?.refresh;
  if (!prev?.access_token || !refresh) {
    if (!interactive) return prev || null;
    log('This account needs to sign in again.');
    await login();
    return active.auth;
  }
  try {
    const manager = new Auth('select_account');
    const mc = await tokenUtils.fromMclcToken(manager, prev, true);
    const next = mc?.mclc?.(true);
    if (!next?.access_token || !mc?.profile?.id) throw new Error('incomplete session');
    const updated = { ...account, username: mc.profile.name || account.username, uuid: mc.profile.id, auth: next };
    upsert(updated, active && idOf(active) === idOf(account));
    if (!(await tokenValid(next)) && interactive) {
      log('The saved session is no longer valid. Please sign in again.');
      await login();
      return active.auth;
    }
    return next;
  } catch (error) {
    // Ohne Netz ist ein noch gueltiger Token besser als gar keiner.
    if (await tokenValid(prev)) return prev;
    if (!interactive) return prev;
    throw new Error(`Your Minecraft session could not be renewed (${error.message || error}). Sign in again.`);
  }
}

async function refreshAllQuietly() {
  for (const a of [...accounts]) {
    try { await freshAuth(a, { interactive: false }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Avatar: Gesicht aus dem echten Minecraft-Skin (offizielle Mojang-API)
// ---------------------------------------------------------------------------

function faceFromSkin(skin) {
  const out = new PNG({ width: 8, height: 8 });
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const face = ((8 + y) * skin.width + (8 + x)) << 2;
    const hat = ((8 + y) * skin.width + (40 + x)) << 2;
    const t = (y * 8 + x) << 2;
    const src = skin.data[hat + 3] ? hat : face;
    out.data[t] = skin.data[src]; out.data[t + 1] = skin.data[src + 1];
    out.data[t + 2] = skin.data[src + 2]; out.data[t + 3] = 255;
  }
  return PNG.sync.write(out);
}

async function avatar(id) {
  const a = accounts.find(e => idOf(e) === String(id || ''));
  return faceByUuid(a?.uuid);
}

/** Gesicht (8x8, mit Huttschicht) zu einer beliebigen UUID -- auch fuer Freunde. */
async function faceByUuid(raw) {
  const uuid = String(raw || '').replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(uuid)) return null;
  const file = path.join(paths.avatarsRoot, `face-${uuid}.png`);
  const fresh = exists(file) && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600 * 1000;
  if (!fresh) {
    try {
      const p = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, { signal: AbortSignal.timeout(10000) });
      if (p.ok) {
        const prof = await p.json();
        const prop = (prof.properties || []).find(e => e.name === 'textures');
        const url = prop ? JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'))?.textures?.SKIN?.url : null;
        if (/^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(url || '')) {
          const s = await fetch(url.replace(/^http:/, 'https:'), { signal: AbortSignal.timeout(10000) });
          if (s.ok) {
            const skin = PNG.sync.read(Buffer.from(await s.arrayBuffer()));
            if (skin.width === 64 && skin.height >= 32) {
              ensureDir(paths.avatarsRoot);
              fs.writeFileSync(file, faceFromSkin(skin));
            }
          }
        }
      }
    } catch (_) {}
  }
  return exists(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : null;
}

/** Gesicht sofort aus einem neuen Skin erzeugen (nach dem Skin-Wechsel). */
function writeFace(uuidRaw, pngBuffer) {
  const uuid = String(uuidRaw || '').replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(uuid)) return;
  try {
    const skin = PNG.sync.read(pngBuffer);
    if (skin.width !== 64 || skin.height < 32) return;
    ensureDir(paths.avatarsRoot);
    fs.writeFileSync(path.join(paths.avatarsRoot, `face-${uuid}.png`), faceFromSkin(skin));
  } catch (_) {}
}

module.exports = { load, list, current, currentSummary, login, select, remove, freshAuth, refreshAllQuietly, avatar, faceByUuid, idOf, writeFace };
