'use strict';
/**
 * BETA-TEST-CHECKLISTE
 *
 * Wer Beta-Builds spielt, bekommt hier eine Liste ALLER Neuerungen, die noch
 * nicht fuer alle freigegeben sind -- auch aus aelteren Beta-Builds. Jeden
 * Punkt abhaken, wenn er funktioniert; sonst einen Fehler melden. Erst wenn
 * alles abgehakt ist und kein Fehler mehr offen ist, laesst sich die Beta
 * freigeben.
 *
 * WOHER DIE PUNKTE KOMMEN
 * Das Beta-Manifest enthaelt je Datei "changes": die Notizen aller Releases
 * bis zur Beta-Version (sync_vortex_files.py). Davon zaehlt alles, was neuer
 * ist als die freigegebene Version (manifest.json) bzw. die im Launcher
 * mitgelieferte. Notizen-Format: "## Ueberschrift", "- Punkt", "> Hinweis".
 *
 * DATEIEN (%APPDATA%\Vortex Client\beta-test\)
 *   state.json   schreibt NUR der Launcher: Punkte, Haken, Fehlerberichte.
 *   inbox\*.json schreibt NUR das Spiel: je Aktion eine Datei (Haken setzen,
 *                Fehler melden). Der Launcher liest sie ein und loescht sie.
 * So schreiben nie zwei Programme in dieselbe Datei. Das Spiel bekommt den
 * Ordner per -Dvortex.beta.dir mit.
 *
 * FEHLERBERICHTE gehen als GitHub-Issue in das Launcher-Repo (Titel beginnt
 * mit "[Beta-Bug]"). Darf der Admin-Token keine Issues anlegen, landen sie
 * als Datei in beta-reports/ im selben Repo -- das kann der Token immer.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { paths, ensureDir, exists, loadJson, writeJson, log } = require('./core');
const vortexfiles = require('./vortexfiles');

const dir = () => path.join(paths.dataRoot, 'beta-test');
const stateFile = () => path.join(dir(), 'state.json');
const inboxDir = () => path.join(dir(), 'inbox');

let packagedFor = () => [];          // (mc) => [{id, version}] -- aus instances.js
let ghRequest = null;                // admin.gh -- nur mit Admin-Token
let hasToken = () => false;
let onChange = () => {};

function init(opts) {
  packagedFor = opts.packagedFor || packagedFor;
  ghRequest = opts.gh || null;
  hasToken = opts.hasToken || hasToken;
  onChange = opts.onChange || onChange;
  ensureDir(inboxDir());
  // Eingang des Spiels alle 2 s ansehen (fs.watch ist unter Windows bei
  // Netzlaufwerken/OneDrive unzuverlaessig).
  let takt = 0;
  setInterval(() => {
    try { readInbox(); } catch (e) { log(`Beta test inbox: ${e.message}`, 'warn'); }
    // Offene Berichte senden -- sofort, und fehlgeschlagene alle 60 s erneut.
    takt++;
    const offen = load().reports.filter(r => r.status === 'pending');
    if (offen.some(r => !r.error) || (offen.length && takt % 30 === 0)) void sendReports();
  }, 2000).unref?.();
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

function load() {
  const s = loadJson(stateFile(), null) || {};
  return {
    generatedAt: s.generatedAt || null,
    groups: Array.isArray(s.groups) ? s.groups : [],
    checked: s.checked && typeof s.checked === 'object' ? s.checked : {},
    reports: Array.isArray(s.reports) ? s.reports : []
  };
}

function save(s) {
  ensureDir(dir());
  writeJson(stateFile(), s);
  onChange(view(s));
}

const hash = t => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);

/** Notizen -> [{heading, items:[text]}] */
function parseNotes(notes) {
  const out = [];
  let cur = null;
  for (const raw of String(notes || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('>')) continue;
    if (/^#{1,6}\s/.test(l)) { cur = { heading: l.replace(/^#+\s*/, ''), items: [] }; out.push(cur); continue; }
    const text = l.replace(/^[-*+]\s+/, '').trim();
    if (!text) continue;
    if (!cur) { cur = { heading: '', items: [] }; out.push(cur); }
    cur.items.push(text);
  }
  return out.filter(g => g.items.length);
}

async function fetchManifest(name) {
  const url = `https://github.com/${config.github.owner}/${config.github.repo}/releases/download/${config.filesTag}/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'VortexClientLauncher', 'Cache-Control': 'no-cache' } });
  if (res.status === 404) return { versions: {} };
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return res.json();
}

/**
 * Punkte neu aufbauen (Manifeste lesen). Haken und Berichte bleiben -- sie
 * haengen an der ID des Punktes (Datei + Version + Text).
 */
async function rebuild() {
  const [stable, beta] = await Promise.all([fetchManifest('manifest.json'), fetchManifest('manifest-beta.json')]);
  const groups = [];
  // Derselbe Punkt steht oft in mehreren Release-Notizen (z. B. 2.35.0 und
  // 2.35.1, wenn dieselbe Version nachgebaut wurde). Pro Minecraft-Version und
  // Datei nur einmal abfragen -- beim neuesten Build, in dem er vorkommt.
  const gesehen = new Set();
  for (const [mc, e] of Object.entries(beta.versions || {})) {
    for (const [id, f] of Object.entries(e.files || {})) {
      const online = stable.versions?.[mc]?.files?.[id]?.version || null;
      const packaged = (packagedFor(mc).find(x => x.id === id) || {}).version || null;
      let base = online;
      if (packaged && (!base || vortexfiles.isNewer(packaged, base))) base = packaged;
      if (base && !vortexfiles.isNewer(f.version, base)) continue;          // nichts offen
      let changes = Array.isArray(f.changes) ? f.changes : [];
      // Ohne freigegebene Version: nur dieselbe Hauptversion (sonst kaemen
      // Notizen von laengst abgeloesten Fassungen mit, z. B. 2.28 vor 4.x).
      const major = v => String(vortexfiles.cleanVersion(v)).split('.')[0];
      changes = changes.filter(c => c && c.version && (!base || vortexfiles.isNewer(c.version, base))
        && !vortexfiles.isNewer(c.version, f.version) && (base || major(c.version) === major(f.version)));
      if (!changes.length && f.notes) changes = [{ version: f.version, notes: f.notes }];
      for (const c of changes) {
        const version = vortexfiles.cleanVersion(c.version);
        for (const sec of parseNotes(c.notes)) {
          sec.items = sec.items.filter(text => {
            const k = `${mc}|${id}|${text}`;
            if (gesehen.has(k)) return false;
            gesehen.add(k);
            return true;
          });
          if (!sec.items.length) continue;
          groups.push({
            key: hash(`${mc}|${id}|${version}|${sec.heading}`),
            mc, fileId: id, kind: vortexfiles.kindOf(id), component: String(f.name || id), version,
            betaVersion: vortexfiles.cleanVersion(f.version), heading: sec.heading,
            items: sec.items.map(text => ({ id: hash(`${mc}|${id}|${version}|${text}`), text }))
          });
        }
      }
    }
  }
  const s = load();
  s.groups = groups;
  s.generatedAt = new Date().toISOString();
  // Haken zu Punkten, die es nicht mehr gibt (freigegeben), aufraeumen.
  const ids = new Set(groups.flatMap(g => g.items.map(i => i.id)));
  for (const k of Object.keys(s.checked)) if (!ids.has(k)) delete s.checked[k];
  s.reports = s.reports.filter(r => ids.has(r.itemId) || r.status === 'pending');
  save(s);
  return view(s);
}

/** Fuer Oberflaeche und Spiel: Punkte mit Haken und Berichten, plus Fortschritt. */
function view(s = load()) {
  let total = 0, done = 0;
  const openReports = s.reports.filter(r => r.status !== 'resolved');
  const groups = s.groups.map(g => ({
    ...g,
    items: g.items.map(i => {
      total++;
      const checked = Boolean(s.checked[i.id]);
      if (checked) done++;
      return { ...i, checked, reports: s.reports.filter(r => r.itemId === i.id) };
    })
  }));
  return {
    generatedAt: s.generatedAt, groups, total, done,
    openReports: openReports.length,
    complete: total === 0 || (done === total && openReports.length === 0),
    canSend: hasToken()
  };
}

/** Ist fuer diese Datei alles abgehakt und kein Fehler offen? */
function fileComplete(mc, fileId, s = load()) {
  for (const g of s.groups) {
    if (g.mc !== mc || g.fileId !== fileId) continue;
    for (const i of g.items) {
      if (!s.checked[i.id]) return false;
      if (s.reports.some(r => r.itemId === i.id && r.status !== 'resolved')) return false;
    }
  }
  return true;
}

function findItem(s, itemId) {
  for (const g of s.groups) for (const i of g.items) if (i.id === itemId) return { g, i };
  return null;
}

function setChecked(itemId, value, s = load(), persist = true) {
  if (!findItem(s, itemId)) return view(s);
  if (value) {
    s.checked[itemId] = new Date().toISOString();
    // Abhaken heisst: geht jetzt -- offene Berichte zu diesem Punkt sind erledigt.
    for (const r of s.reports) if (r.itemId === itemId && r.status !== 'resolved') { r.status = 'resolved'; r.resolvedAt = new Date().toISOString(); }
  } else {
    delete s.checked[itemId];
  }
  if (persist) save(s);
  return view(s);
}

function addReport(itemId, text, opts = {}, s = load(), persist = true) {
  const hit = findItem(s, itemId);
  const body = String(text || '').trim().slice(0, 4000);
  if (!hit || !body) throw new Error('Describe the problem first.');
  delete s.checked[itemId];
  s.reports.push({
    id: crypto.randomBytes(5).toString('hex'), itemId, text: body, source: opts.source === 'game' ? 'game' : 'launcher',
    attachLog: opts.attachLog !== false, context: String(opts.context || '').slice(0, 500),
    createdAt: new Date().toISOString(), status: 'pending'
  });
  if (persist) { save(s); void sendReports(); }
  return view(s);
}

function resolveReport(reportId) {
  const s = load();
  const r = s.reports.find(x => x.id === reportId);
  if (r) { r.status = 'resolved'; r.resolvedAt = new Date().toISOString(); save(s); }
  return view(s);
}

/** Aktionen des Spiels uebernehmen. true, wenn etwas dabei war. */
function readInbox() {
  let files;
  try { files = fs.readdirSync(inboxDir()).filter(f => f.endsWith('.json')).sort(); } catch (_) { return false; }
  if (!files.length) return false;
  const s = load();
  for (const f of files) {
    const p = path.join(inboxDir(), f);
    let a = null;
    try { a = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {
      // Halb geschrieben? Beim naechsten Durchlauf nochmal -- aber nicht ewig.
      try { if (Date.now() - fs.statSync(p).mtimeMs < 10000) continue; } catch (_) {}
    }
    try {
      if (a && a.type === 'check') setChecked(String(a.itemId), Boolean(a.value), s, false);
      else if (a && a.type === 'report') addReport(String(a.itemId), a.text, { source: 'game', attachLog: a.attachLog !== false, context: a.context }, s, false);
    } catch (e) { log(`Beta test: game action ignored (${e.message})`, 'warn'); }
    try { fs.rmSync(p, { force: true }); } catch (_) {}
  }
  save(s);
  return true;
}

// ---------------------------------------------------------------------------
// Fehlerberichte an GitHub
// ---------------------------------------------------------------------------

let sending = false;

/** Relevante Zeilen aus dem Spiel-Log (Fehler, Vortex), IP-Adressen maskiert. */
function logExcerpt(mc) {
  try {
    const file = path.join(paths.instanceRoot(mc), 'logs', 'latest.log');
    if (!exists(file)) return '';
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/ERROR|Exception|vortex|Mixin apply|Caused by/i.test(l) || /^\s+at /.test(l)) out.push(l);
    }
    return out.slice(-80).join('\n')
      .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, 'x.x.x.x')
      .replace(/(accessToken|token|session)[=:]\s*\S+/gi, '$1=***')
      .slice(-12000);
  } catch (_) { return ''; }
}

async function sendReports() {
  if (sending || !ghRequest || !hasToken()) return;
  sending = true;
  try {
    const s = load();
    const repo = `${config.github.owner}/${config.github.repo}`;
    const updates = new Map();
    for (const r0 of s.reports) {
      const r = { ...r0 };
      if (r.status !== 'pending') continue;
      const hit = findItem(s, r.itemId);
      const g = hit?.g, item = hit?.i;
      const title = `[Beta-Bug] ${g ? `${g.component} ${g.version}` : ''}: ${(item?.text || 'unknown item').slice(0, 90)}`;
      const excerpt = r.attachLog ? logExcerpt(g?.mc || '') : '';
      const body = [
        `**Feature:** ${item?.text || r.itemId}`,
        g?.heading ? `**Bereich:** ${g.heading}` : '',
        `**Datei:** ${g ? `${g.component} ${g.version} (Beta ${g.betaVersion}, Minecraft ${g.mc})` : '-'}`,
        `**Gemeldet:** ${r.createdAt} (${r.source === 'game' ? 'im Spiel' : 'im Launcher'})`,
        r.context ? `**Kontext:** ${r.context}` : '',
        '', '### Fehlerbeschreibung', r.text,
        excerpt ? `\n<details><summary>Log-Auszug (Fehler/Vortex-Zeilen)</summary>\n\n\`\`\`\n${excerpt}\n\`\`\`\n</details>` : '',
        '', `<!-- beta-report:${r.id} item:${r.itemId} -->`
      ].filter(x => x !== '').join('\n');
      try {
        let url = null;
        try {
          const issue = await ghRequest('POST', `/repos/${repo}/issues`, { body: { title, body } });
          url = issue?.html_url || null;
        } catch (e) {
          if (e.status !== 403 && e.status !== 404 && e.status !== 410) throw e;
          // Token darf keine Issues -> als Datei ablegen (Contents-Recht hat er).
          const name = `beta-reports/${r.createdAt.slice(0, 10)}-${r.id}.md`;
          const res = await ghRequest('PUT', `/repos/${repo}/contents/${name}`, {
            body: { message: `Beta-Bug: ${(item?.text || '').slice(0, 60)} [skip ci]`, content: Buffer.from(`# ${title}\n\n${body}\n`).toString('base64') }
          });
          url = res?.content?.html_url || null;
        }
        updates.set(r.id, { status: 'sent', url, sentAt: new Date().toISOString(), error: undefined });
        log(`Beta test: bug report sent (${url || 'ok'}).`);
      } catch (e) {
        updates.set(r.id, { error: e.message });
        log(`Beta test: bug report could not be sent: ${e.message}`, 'warn');
      }
    }
    if (updates.size) {
      // Frisch laden: waehrend des Sendens kann sich der Zustand geaendert haben.
      const fresh = load();
      for (const r of fresh.reports) {
        const u = updates.get(r.id);
        if (!u || r.status !== 'pending') continue;
        Object.assign(r, u);
        if (u.error === undefined) delete r.error;
      }
      save(fresh);
    }
  } finally {
    sending = false;
  }
}

module.exports = {
  init, rebuild, view: () => view(), load, setChecked: (id, v) => setChecked(id, v), addReport: (id, t, o) => addReport(id, t, o),
  resolveReport, fileComplete: (mc, id) => fileComplete(mc, id), sendReports, dir, parseNotes
};
