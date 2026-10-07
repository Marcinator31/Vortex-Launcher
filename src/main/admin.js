'use strict';
/**
 * Admin-Bereich: Client-/Addon-Jars fuer alle Spieler veroeffentlichen.
 *
 * Speicher ist das GitHub-Release "vortex-files" (Pre-Release) im
 * Launcher-Repo. Hochladen braucht einen GitHub-Token mit Schreibrecht auf
 * das Repo -- den hat nur der Besitzer. Der Token wird mit der
 * Windows-Verschluesselung (DPAPI, ueber Electron safeStorage) gespeichert
 * und verlaesst den PC nur Richtung api.github.com.
 *
 * Ablauf beim Hochladen: Jar hochladen -> manifest.json ersetzen -> alte Jar
 * derselben Mod-ID loeschen. So zeigt das Manifest nie auf eine fehlende Datei.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const config = require('./config');
const { paths, exists, ensureDir, log, isValidMinecraftVersion } = require('./core');
const { readModInfo } = require('./jarinfo');
const vortexfiles = require('./vortexfiles');

const API = 'https://api.github.com';
const REPO = `${config.github.owner}/${config.github.repo}`;
const tokenFile = () => path.join(paths.dataRoot, 'admin-token.bin');

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

function readToken() {
  try {
    if (!exists(tokenFile())) return null;
    const raw = fs.readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null;
  } catch (_) { return null; }
}

async function gh(method, url, { token = readToken(), body, raw, contentType, accept } = {}) {
  if (!token) throw new Error('Sign in with your GitHub token first.');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'VortexClientLauncher-Admin'
  };
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = contentType || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, { method, headers, body: payload, signal: AbortSignal.timeout(180000), redirect: 'follow' });
  if (res.status === 204) return null;
  if (accept === 'application/octet-stream') {
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(res.status === 401 ? 'The GitHub token is invalid or expired.'
      : res.status === 403 ? 'The GitHub token has no write access to the launcher repository (Contents: Read and write).'
        : `GitHub: ${data.message || res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

async function status() {
  const token = readToken();
  if (!token) return { signedIn: false, repo: REPO };
  try {
    const [user, repo] = await Promise.all([gh('GET', '/user', { token }).catch(() => null), gh('GET', `/repos/${REPO}`, { token })]);
    return {
      signedIn: true, repo: REPO, login: user?.login || null,
      canWrite: Boolean(repo?.permissions?.push || repo?.permissions?.admin),
      isPrivate: Boolean(repo?.private)
    };
  } catch (e) {
    return { signedIn: true, repo: REPO, error: e.message, canWrite: false };
  }
}

async function signIn(token) {
  const t = String(token || '').trim();
  if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(t)) throw new Error('That does not look like a GitHub token (ghp_… or github_pat_…).');
  const repo = await gh('GET', `/repos/${REPO}`, { token: t });
  if (!(repo?.permissions?.push || repo?.permissions?.admin)) throw new Error(`This token cannot write to ${REPO}. Give it "Contents: Read and write" for this repository.`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available -- the token cannot be stored safely.');
  ensureDir(paths.dataRoot);
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(t));
  log('Admin: GitHub token saved.');
  return status();
}

function signOut() {
  try { fs.rmSync(tokenFile(), { force: true }); } catch (_) {}
  return { signedIn: false, repo: REPO };
}

// ---------------------------------------------------------------------------
// Release & Manifest
// ---------------------------------------------------------------------------

async function release() {
  try {
    return await gh('GET', `/repos/${REPO}/releases/tags/${encodeURIComponent(config.filesTag)}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    log('Admin: creating the release "vortex-files".');
    return gh('POST', `/repos/${REPO}/releases`, {
      body: {
        tag_name: config.filesTag,
        name: 'Vortex files (managed by the launcher)',
        body: 'Client/addon jars published from the Vortex launcher admin area. Please do not edit or delete this release by hand.',
        prerelease: true,
        make_latest: 'false'
      }
    });
  }
}

const BETA = 'manifest-beta.json';

/**
 * Manifest aus dem Release lesen. Klappt das Lesen NICHT, wird abgebrochen
 * (Fehler) -- frueher kam dann ein leeres Manifest zurueck, und die naechste
 * Aenderung hat damit alle Eintraege ueberschrieben: alle Spieler bekamen
 * wieder die uralte, im Installer mitgelieferte Version.
 */
async function readRemoteManifest(rel, name = 'manifest.json') {
  const asset = (rel.assets || []).find(a => a.name === name);
  if (!asset) {
    // Wirklich noch keins (neues Release ohne Dateien)? Sonst lieber abbrechen.
    if ((rel.assets || []).some(a => /\.jar$/i.test(a.name))) throw new Error(`${name} is missing in the release -- nothing was changed. Try again in a minute.`);
    return { schema: 1, versions: {}, news: [] };
  }
  const buf = await gh('GET', `/repos/${REPO}/releases/assets/${asset.id}`, { accept: 'application/octet-stream' });
  let roh;
  try { roh = JSON.parse(buf.toString('utf8')); } catch (_) { roh = null; }
  if (!roh || typeof roh !== 'object' || typeof roh.versions !== 'object' || roh.versions === null) {
    throw new Error(`${name} could not be read from GitHub -- nothing was changed. Try again in a minute.`);
  }
  return vortexfiles.validManifest(roh);
}

/** Alle (Version, Mod-ID)-Paare eines Manifests. */
function eintraege(m) {
  const out = [];
  for (const [v, e] of Object.entries(m?.versions || {})) for (const id of Object.keys(e.files || {})) out.push(`${v}/${id}`);
  return out;
}

async function uploadAsset(rel, name, data, contentType) {
  const existing = (rel.assets || []).find(a => a.name === name);
  if (existing) await gh('DELETE', `/repos/${REPO}/releases/assets/${existing.id}`);
  const url = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`;
  return gh('POST', url, { raw: data, contentType });
}

async function deleteAssetByName(name) {
  const rel = await release();
  const a = (rel.assets || []).find(x => x.name === name);
  if (a) await gh('DELETE', `/repos/${REPO}/releases/assets/${a.id}`);
}

/**
 * Manifest schreiben -- mit Sicherung: Eintraege, die gerade online stehen,
 * duerfen nur verschwinden, wenn genau das gewollt ist (entfernen = ["1.21.11/vortexclient"]).
 * Sonst wird abgebrochen, statt allen Spielern die Vortex-Dateien wegzunehmen.
 */
async function writeManifest(rel, manifest, name = 'manifest.json', entfernen = []) {
  const jetzt = await readRemoteManifest(await release(), name);
  const neu = new Set(eintraege(manifest));
  const fehlt = eintraege(jetzt).filter(k => !neu.has(k) && !entfernen.includes(k));
  if (fehlt.length) {
    log(`Admin: ${name} NOT written -- it would remove ${fehlt.join(', ')}.`, 'warn');
    throw new Error(`Safety stop: this change would remove ${fehlt.length} file(s) from ${name} (${fehlt.slice(0, 3).join(', ')}). Nothing was changed -- reload the admin page and try again.`);
  }
  manifest.updatedAt = new Date().toISOString();
  await uploadAsset(rel, name, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
}

/** Wird die Datei noch von einem der beiden Manifeste gebraucht? Dann NICHT loeschen. */
async function stillUsed(fileName) {
  const rel = await release();
  for (const m of [await readRemoteManifest(rel), await readRemoteManifest(rel, BETA)]) {
    for (const e of Object.values(m.versions)) {
      for (const f of Object.values(e.files)) if (f.file === fileName) return true;
    }
  }
  return false;
}

async function deleteIfUnused(fileName) {
  if (!fileName || await stillUsed(fileName)) return;
  await deleteAssetByName(fileName);
}

/**
 * Beta fuer alle freigeben: den Beta-Eintrag (Datei liegt schon im Release)
 * ins normale Manifest uebernehmen. Die Datei wird nicht neu hochgeladen.
 */
async function promote(mcVersion, id) {
  const rel = await release();
  const beta = await readRemoteManifest(rel, BETA);
  const f = beta.versions[mcVersion]?.files?.[id];
  if (!f) throw new Error('There is no beta version to release.');
  const stable = await readRemoteManifest(rel);
  const entry = stable.versions[mcVersion] || (stable.versions[mcVersion] = { files: {} });
  const previous = entry.files[id];
  entry.files[id] = { ...f, channel: 'stable', uploadedAt: new Date().toISOString() };
  delete entry.files[id].channel;
  await writeManifest(rel, stable);
  if (previous && previous.file !== f.file) {
    try { await deleteIfUnused(previous.file); } catch (e) { log(`Admin: old file ${previous.file} could not be removed: ${e.message}`, 'warn'); }
  }
  log(`Admin: ${f.name} ${vortexfiles.cleanVersion(f.version)} released to everyone (Minecraft ${mcVersion}).`);
  return { released: { version: mcVersion, id, name: f.name, newVersion: vortexfiles.cleanVersion(f.version) } };
}

/** Uebersicht fuer den Admin-Bereich (direkt von GitHub, nicht aus dem Cache). */
async function overview(packaged) {
  const rel = await release();
  const manifest = await readRemoteManifest(rel);
  const beta = await readRemoteManifest(rel, BETA);
  const versions = [...new Set([...Object.keys(packaged), ...Object.keys(manifest.versions), ...Object.keys(beta.versions)])];
  return {
    versions: versions.map(v => {
      const online = manifest.versions[v]?.files || {};
      const betaFiles = beta.versions[v]?.files || {};
      const ids = [...new Set([...(packaged[v] || []).map(e => e.id), ...Object.keys(online), ...Object.keys(betaFiles)])];
      return {
        version: v,
        files: ids.map(id => {
          const b = (packaged[v] || []).find(e => e.id === id);
          const o = online[id];
          const bt = betaFiles[id];
          const betaNewer = bt && (!o || vortexfiles.isNewer(bt.version, o.version) || (vortexfiles.cleanVersion(bt.version) === vortexfiles.cleanVersion(o.version) && bt.sha256 !== o.sha256));
          return {
            beta: bt ? vortexfiles.cleanVersion(bt.version) : null,
            betaNotes: bt?.notes || '',
            promotable: Boolean(betaNewer),
            id, kind: vortexfiles.kindOf(id),
            name: o?.name || b?.name || id,
            bundled: b ? vortexfiles.cleanVersion(b.version) : null,
            online: o ? vortexfiles.cleanVersion(o.version) : null,
            onlineFile: o?.file || null, uploadedAt: o?.uploadedAt || null, size: o?.size || 0,
            active: o && (!b || vortexfiles.isNewer(o.version, b.version)) ? 'online' : b ? 'bundled' : 'online'
          };
        }).sort((a, b) => ({ client: 0, addon: 1, extra: 2 }[a.kind] - { client: 0, addon: 1, extra: 2 }[b.kind]))
      };
    }).sort((a, b) => require('./core').compareVersions(b.version, a.version)),
    updatedAt: manifest.updatedAt || null,
    news: manifest.news || [],
    releaseUrl: rel.html_url
  };
}

// ---------------------------------------------------------------------------
// Statistik (2.4.0)
// ---------------------------------------------------------------------------
//
// Alles aus Daten, die GitHub ohnehin fuehrt -- der Launcher schickt keine
// eigenen Nutzungsdaten. Deshalb sind es Download-Zahlen, keine Spieler:
//   - Vortex-Dateien: wie oft jede aktuelle Jar geladen wurde (jeder Launcher
//     laedt eine neue Version genau einmal -> ungefaehr "so viele haben sie")
//   - Manifest-Abrufe: ungefaehr, wie oft Launcher nach Updates geschaut haben
//   - Launcher: Downloads je Version (Setup/Portable) und Update-Pruefungen
//   - Beta-Fehlerberichte: Issues "[Beta-Bug] ..." und Dateien in beta-reports/

function jarInfo(name) {
  const m = String(name).match(/^(.*)-(\d+\.\d+\.\d+(?:[-+][\w.+-]*)?)\.jar$/);
  if (!m) return null;
  const id = /addon/i.test(m[1]) ? 'addon' : /vortexclient|client/i.test(m[1]) ? 'client' : 'extra';
  const mc = (m[2].match(/\+(\d+\.\d+(?:\.\d+)?)$/) || [])[1] || '';
  return { kind: id, version: m[2].replace(/\+.*$/, ''), mc };
}

async function stats() {
  if (!readToken()) throw new Error('Sign in with your GitHub token first.');
  const [rel, releases, issues, reportFiles] = await Promise.all([
    release(),
    gh('GET', `/repos/${REPO}/releases?per_page=30`).catch(() => []),
    gh('GET', `/repos/${REPO}/issues?state=all&per_page=100&sort=created&direction=desc`).catch(() => []),
    gh('GET', `/repos/${REPO}/contents/beta-reports`).catch(() => [])
  ]);

  const dateien = [];
  let manifestAbrufe = 0, betaAbrufe = 0;
  for (const a of rel.assets || []) {
    if (a.name === 'manifest.json') { manifestAbrufe = a.download_count || 0; continue; }
    if (a.name === BETA) { betaAbrufe = a.download_count || 0; continue; }
    const j = jarInfo(a.name);
    if (!j) continue;
    dateien.push({ file: a.name, kind: j.kind, version: j.version, mc: j.mc, downloads: a.download_count || 0, uploadedAt: a.created_at, size: a.size });
  }
  dateien.sort((a, b) => ({ client: 0, addon: 1, extra: 2 }[a.kind] - { client: 0, addon: 1, extra: 2 }[b.kind]) || b.downloads - a.downloads);

  const launcher = (Array.isArray(releases) ? releases : [])
    .filter(r => r.tag_name !== config.filesTag && !r.draft)
    .map(r => {
      const exe = (r.assets || []).filter(a => /\.exe$/i.test(a.name));
      const yml = (r.assets || []).find(a => /^latest\.yml$/i.test(a.name));
      return {
        version: String(r.tag_name).replace(/^v/i, ''),
        publishedAt: r.published_at,
        downloads: exe.reduce((n, a) => n + (a.download_count || 0), 0),
        setup: exe.filter(a => /setup/i.test(a.name)).reduce((n, a) => n + (a.download_count || 0), 0),
        portable: exe.filter(a => !/setup/i.test(a.name)).reduce((n, a) => n + (a.download_count || 0), 0),
        updateChecks: yml?.download_count || 0,
        url: r.html_url
      };
    })
    .slice(0, 12);

  const bugs = (Array.isArray(issues) ? issues : []).filter(i => !i.pull_request && /^\[Beta-Bug\]/.test(i.title || ''));
  const berichtDateien = (Array.isArray(reportFiles) ? reportFiles : []).filter(f => /\.md$/i.test(f.name));

  return {
    files: dateien,
    manifestChecks: manifestAbrufe,
    betaChecks: betaAbrufe,
    launcher,
    launcherTotal: launcher.reduce((n, r) => n + r.downloads, 0),
    beta: {
      open: bugs.filter(i => i.state === 'open').length,
      closed: bugs.filter(i => i.state === 'closed').length,
      files: berichtDateien.length,
      latest: [
        ...bugs.slice(0, 8).map(i => ({ title: i.title.replace(/^\[Beta-Bug\]\s*/, ''), state: i.state, url: i.html_url, at: i.created_at })),
        ...berichtDateien.slice(-4).reverse().map(f => ({ title: f.name.replace(/\.md$/, ''), state: 'file', url: f.html_url, at: (f.name.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0] }))
      ].slice(0, 10)
    },
    fetchedAt: new Date().toISOString()
  };
}

/** Jar pruefen, bevor sie hochgeladen wird. */
function inspectJar(file) {
  const f = String(file || '');
  if (!/\.jar$/i.test(f) || !exists(f)) throw new Error('Choose a .jar file.');
  const info = readModInfo(f);
  if (!info || !info.id) throw new Error('This jar has no fabric.mod.json -- it is not a Fabric mod.');
  const size = fs.statSync(f).size;
  // MC-Version erraten: "+26.2" im Namen, sonst aus depends.minecraft
  const base = path.basename(f);
  let guess = (base.match(/\+(\d+\.\d+(?:\.\d+)?)\.jar$/i) || [])[1]
    || (String(info.version).match(/\+(\d+\.\d+(?:\.\d+)?)$/) || [])[1]
    || (String(info.minecraft).match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || '';
  if (!isValidMinecraftVersion(guess)) guess = '';
  return {
    path: f, file: base, size, id: info.id, name: info.name, version: info.version,
    cleanVersion: vortexfiles.cleanVersion(info.version), kind: vortexfiles.kindOf(info.id),
    minecraft: info.minecraft, guess, icon: info.icon
  };
}

/** Jar fuer eine MC-Version veroeffentlichen. */
async function publish(file, mcVersion) {
  const v = String(mcVersion || '').trim();
  if (!isValidMinecraftVersion(v)) throw new Error('Choose a valid Minecraft version (e.g. 26.2).');
  const info = inspectJar(file);
  if (!vortexfiles.safeName(info.file)) throw new Error('Rename the jar: only letters, digits and . _ + - are allowed.');
  const data = fs.readFileSync(info.path);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');

  const rel = await release();
  const manifest = await readRemoteManifest(rel);
  const entry = manifest.versions[v] || (manifest.versions[v] = { files: {} });
  const previous = entry.files[info.id];

  // Gleicher Dateiname bei einer anderen Version/Mod-ID? Dann wuerde das Hochladen dort etwas kaputt machen.
  for (const [ov, oe] of Object.entries(manifest.versions)) {
    for (const [oid, of] of Object.entries(oe.files)) {
      if (of.file === info.file && !(ov === v && oid === info.id)) throw new Error(`A file named ${info.file} is already used for Minecraft ${ov}. Rename the jar.`);
    }
  }

  await uploadAsset(rel, info.file, data, 'application/java-archive');
  entry.files[info.id] = { file: info.file, version: info.version, name: info.name, sha256, size: data.length, uploadedAt: new Date().toISOString() };
  await writeManifest(await release(), manifest);
  if (previous && previous.file !== info.file) {
    try { await deleteIfUnused(previous.file); } catch (e) { log(`Admin: old file ${previous.file} could not be removed: ${e.message}`, 'warn'); }
  }
  log(`Admin: ${info.name} ${info.cleanVersion} published for Minecraft ${v}.`);
  return { published: { version: v, id: info.id, name: info.name, newVersion: info.cleanVersion } };
}

/** Online-Datei zuruecknehmen (dann gilt wieder die mitgelieferte). */
async function unpublish(mcVersion, id) {
  const rel = await release();
  const manifest = await readRemoteManifest(rel);
  const f = manifest.versions[mcVersion]?.files?.[id];
  if (!f) return {};
  delete manifest.versions[mcVersion].files[id];
  if (!Object.keys(manifest.versions[mcVersion].files).length) delete manifest.versions[mcVersion];
  await writeManifest(rel, manifest, 'manifest.json', [`${mcVersion}/${id}`]);
  try { await deleteIfUnused(f.file); } catch (_) {}
  log(`Admin: ${f.name} removed from Minecraft ${mcVersion}.`);
  return {};
}

/** Neuigkeit fuer alle Launcher veroeffentlichen (erscheint unter "What's new"). */
async function postNews(title, body) {
  const t = String(title || '').trim(), b = String(body || '').trim();
  if (!t) throw new Error('Give the news a title.');
  const rel = await release();
  const manifest = await readRemoteManifest(rel);
  manifest.news = [{ id: crypto.randomBytes(5).toString('hex'), title: t.slice(0, 100), body: b.slice(0, 1500), date: new Date().toISOString() }, ...(manifest.news || [])].slice(0, 30);
  await writeManifest(rel, manifest);
  return { news: manifest.news };
}

async function deleteNews(id) {
  const rel = await release();
  const manifest = await readRemoteManifest(rel);
  manifest.news = (manifest.news || []).filter(n => n.id !== id);
  await writeManifest(rel, manifest);
  return { news: manifest.news };
}

module.exports = { status, signIn, signOut, overview, stats, inspectJar, publish, unpublish, promote, postNews, deleteNews, hasToken: () => Boolean(readToken()), gh };
