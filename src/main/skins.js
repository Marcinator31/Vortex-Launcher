'use strict';
/**
 * Skin-Wechsler ueber die offizielle Minecraft-Schnittstelle.
 *
 * Mit dem Microsoft-Login des aktiven Kontos:
 *  - aktuellen Skin + Umhaenge lesen
 *  - Skin hochladen (classic/slim), auf Standard zuruecksetzen
 *  - Umhang waehlen oder verstecken
 * Dazu eine lokale Skin-Bibliothek (%APPDATA%\Vortex Client\skins).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { paths, ensureDir, exists, loadJson, writeJson, log } = require('./core');
const accounts = require('./accounts');

const API = 'https://api.minecraftservices.com/minecraft/profile';
const root = () => path.join(paths.dataRoot, 'skins');
const libFile = () => path.join(root(), 'library.json');

async function token() {
  const acc = accounts.current();
  if (!acc) throw new Error('Sign in with your Microsoft account first.');
  const auth = await accounts.freshAuth(acc, { interactive: true });
  if (!auth?.access_token) throw new Error('Sign in again to change your skin.');
  return { token: auth.access_token, account: accounts.current() };
}

async function mc(method, route, { body, form } = {}) {
  const { token: t } = await token();
  const init = { method, headers: { Authorization: `Bearer ${t}`, 'User-Agent': 'VortexClientLauncher' }, signal: AbortSignal.timeout(30000) };
  if (form) init.body = form;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${API}${route}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error('Your session expired. Sign in again.');
    if (res.status === 429) throw new Error('Too many skin changes -- wait a minute and try again.');
    throw new Error(data.errorMessage || data.error || `Minecraft services answered ${res.status}.`);
  }
  return data;
}

/** Textur-URL -> data-URL (nur textures.minecraft.net). */
async function textureData(url) {
  const u = String(url || '').replace(/^http:/, 'https:');
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(u)) return null;
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function invalidateAvatar(uuid) {
  try { fs.rmSync(path.join(paths.avatarsRoot, `face-${String(uuid || '').replace(/-/g, '')}.png`), { force: true }); } catch (_) {}
  try { fs.rmSync(path.join(paths.avatarsRoot, `face-${uuid}.png`), { force: true }); } catch (_) {}
}

async function profile() {
  const p = await mc('GET', '');
  const active = (p.skins || []).find(s => s.state === 'ACTIVE') || null;
  const capes = await Promise.all((p.capes || []).map(async c => ({
    id: c.id, alias: c.alias || 'Cape', active: c.state === 'ACTIVE', data: await textureData(c.url).catch(() => null)
  })));
  return {
    name: p.name, uuid: p.id,
    skin: active ? { variant: String(active.variant || 'CLASSIC').toLowerCase(), data: await textureData(active.url).catch(() => null) } : null,
    capes
  };
}

// ---------------------------------------------------------------------------
// Bibliothek
// ---------------------------------------------------------------------------

function checkPng(buf) {
  let img;
  try { img = PNG.sync.read(buf); } catch (_) { throw new Error('That is not a valid PNG image.'); }
  if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error(`A Minecraft skin must be 64×64 (or 64×32) pixels -- this one is ${img.width}×${img.height}.`);
  return true;
}

/** Schmale Arme erkennen: bei Slim-Skins ist Pixel (54,20) transparent. */
function guessVariant(buf) {
  try {
    const img = PNG.sync.read(buf);
    if (img.height !== 64) return 'classic';
    const alpha = img.data[(20 * img.width + 54) * 4 + 3];
    return alpha === 0 ? 'slim' : 'classic';
  } catch (_) { return 'classic'; }
}

function libraryRaw() {
  const l = loadJson(libFile(), []);
  return Array.isArray(l) ? l.filter(e => e && /^[a-f0-9]{12}$/.test(e.id) && exists(path.join(root(), `${e.id}.png`))) : [];
}

function library() {
  return libraryRaw().map(e => ({
    ...e, data: `data:image/png;base64,${fs.readFileSync(path.join(root(), `${e.id}.png`)).toString('base64')}`
  })).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

function addToLibrary(buf, name, variant) {
  checkPng(buf);
  ensureDir(root());
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  const list = libraryRaw();
  const dup = list.find(e => e.hash === hash);
  if (dup) return dup;
  const entry = {
    id: crypto.randomBytes(6).toString('hex'), hash,
    name: String(name || 'Skin').trim().slice(0, 32) || 'Skin',
    variant: variant === 'slim' ? 'slim' : variant === 'classic' ? 'classic' : guessVariant(buf),
    addedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(root(), `${entry.id}.png`), buf);
  writeJson(libFile(), [entry, ...list].slice(0, 200));
  return entry;
}

function importFile(file) {
  const f = String(file || '');
  if (!/\.png$/i.test(f) || !exists(f)) throw new Error('Choose a .png skin file.');
  return addToLibrary(fs.readFileSync(f), path.basename(f, path.extname(f)));
}

/** Skin eines anderen Spielers in die Bibliothek kopieren. */
async function importPlayer(username) {
  const n = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(n)) throw new Error('That is not a valid Minecraft name.');
  const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(n)}`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 404 || r.status === 204) throw new Error(`There is no player called ${n}.`);
  if (!r.ok) throw new Error(`Mojang answered ${r.status}.`);
  const { id, name } = await r.json();
  const p = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { signal: AbortSignal.timeout(15000) }).then(x => x.json());
  const texProp = (p.properties || []).find(x => x.name === 'textures');
  const tex = texProp ? JSON.parse(Buffer.from(texProp.value, 'base64').toString('utf8')) : null;
  const skin = tex?.textures?.SKIN;
  if (!skin?.url) throw new Error(`${name} uses the default skin.`);
  const data = await textureData(skin.url);
  if (!data) throw new Error('The skin could not be loaded.');
  return addToLibrary(Buffer.from(data.split(',')[1], 'base64'), name, skin.metadata?.model === 'slim' ? 'slim' : 'classic');
}

async function saveCurrent() {
  const p = await profile();
  if (!p.skin?.data) throw new Error('You are using a default skin.');
  return addToLibrary(Buffer.from(p.skin.data.split(',')[1], 'base64'), `${p.name} (current)`, p.skin.variant);
}

function update(id, patch) {
  const list = libraryRaw();
  const e = list.find(x => x.id === id);
  if (!e) throw new Error('Skin not found.');
  if (patch.variant) e.variant = patch.variant === 'slim' ? 'slim' : 'classic';
  if (typeof patch.name === 'string' && patch.name.trim()) e.name = patch.name.trim().slice(0, 32);
  writeJson(libFile(), list);
  return e;
}

function remove(id) {
  writeJson(libFile(), libraryRaw().filter(e => e.id !== id));
  try { fs.rmSync(path.join(root(), `${String(id).replace(/[^a-f0-9]/g, '')}.png`), { force: true }); } catch (_) {}
  return true;
}

// ---------------------------------------------------------------------------
// Anwenden
// ---------------------------------------------------------------------------

async function apply(id) {
  const e = libraryRaw().find(x => x.id === id);
  if (!e) throw new Error('Skin not found.');
  const buf = fs.readFileSync(path.join(root(), `${e.id}.png`));
  const form = new FormData();
  form.append('variant', e.variant);
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  await mc('POST', '/skins', { form });
  accounts.writeFace(accounts.current()?.uuid, buf);
  log(`Skin changed to "${e.name}".`);
  return profile();
}

async function reset() {
  await mc('DELETE', '/skins/active');
  invalidateAvatar(accounts.current()?.uuid);
  return profile();
}

async function setCape(capeId) {
  if (capeId) await mc('PUT', '/capes/active', { body: { capeId: String(capeId) } });
  else await mc('DELETE', '/capes/active');
  return profile();
}

module.exports = { profile, library, importFile, importPlayer, saveCurrent, update, remove, apply, reset, setCape };
