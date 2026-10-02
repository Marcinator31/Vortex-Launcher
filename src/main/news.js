'use strict';
/**
 * "What's new": Neuigkeiten aus dem Admin-Bereich, neu hochgeladene
 * Vortex-Versionen und die Release-Notes des Launchers (GitHub).
 */
const config = require('./config');
const vortexfiles = require('./vortexfiles');
const { compareVersions } = require('./core');

let releases = { at: 0, list: [] };

function textLines(md) {
  return String(md || '').split(/\r?\n/)
    .map(l => l.replace(/^#+\s*/, '').replace(/^\s*[-*+]\s+/, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim())
    .filter(l => l && !/^(<!--|---)/.test(l))
    .slice(0, 5).map(l => l.slice(0, 180));
}

async function launcherReleases() {
  if (Date.now() - releases.at < 60 * 60 * 1000) return releases.list;
  try {
    const res = await fetch(`https://api.github.com/repos/${config.github.owner}/${config.github.repo}/releases?per_page=6`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VortexClientLauncher' }, signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    releases = {
      at: Date.now(),
      list: (Array.isArray(list) ? list : []).filter(r => !r.draft && !r.prerelease && r.tag_name !== config.filesTag).slice(0, 3)
        .map(r => ({ kind: 'launcher', title: r.name || `Launcher ${r.tag_name}`, lines: textLines(r.body), date: r.published_at }))
    };
  } catch (_) { releases.at = Date.now() - 50 * 60 * 1000; }          // in 10 min nochmal
  return releases.list;
}

async function get() {
  const m = vortexfiles.manifest();
  const items = [];
  for (const n of m.news || []) items.push({ kind: 'news', title: n.title, lines: textLines(n.body), date: n.date });
  // Dasselbe Update gibt es fuer mehrere Minecraft-Versionen -- als EIN
  // Eintrag zeigen, mit allen Versionen in einer Zeile.
  const nachDatei = new Map();
  for (const [v, e] of Object.entries(m.versions)) {
    for (const f of Object.values(e.files)) {
      if (!f.uploadedAt) continue;
      const titel = `${f.name} ${vortexfiles.cleanVersion(f.version)}${f.channel === 'beta' ? ' (Beta)' : ''}`;
      let u = nachDatei.get(titel);
      if (!u) {
        u = { kind: 'update', title: titel, notes: textLines(f.notes), mcs: [], date: f.uploadedAt, v };
        nachDatei.set(titel, u);
      }
      if (!u.mcs.includes(v)) u.mcs.push(v);
      if (String(f.uploadedAt) > String(u.date)) u.date = f.uploadedAt;
      if (compareVersions(v, u.v) > 0) u.v = v;
    }
  }
  const uploads = [...nachDatei.values()].map(u => {
    const mcs = u.mcs.sort((a, b) => compareVersions(b, a));
    return { kind: u.kind, title: u.title, date: u.date, v: u.v,
      lines: [...u.notes.slice(0, 5), `Available for Minecraft ${mcs.join(', ')}.`] };
  });
  uploads.sort((a, b) => String(b.date).localeCompare(String(a.date)) || compareVersions(b.v, a.v));
  items.push(...uploads.slice(0, 4));
  items.push(...await launcherReleases());
  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);
}

module.exports = { get };
