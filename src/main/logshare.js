'use strict';
/**
 * Log teilen: laedt ein Log zu mclo.gs hoch und kopiert den Link.
 *
 * mclo.gs ist DER Log-Dienst der Minecraft-Szene (Support-Discords erwarten
 * genau diese Links). Die Seite hebt Fehler hervor und entfernt selbst
 * IP-Adressen. Zusaetzlich machen wir vor dem Hochladen Windows-Benutzername,
 * Heimatpfade und Minecraft-Konten unkenntlich (wie beim Absturzbericht).
 *
 * Nur auf Knopfdruck -- es wird nie etwas automatisch hochgeladen.
 */
const fs = require('fs');
const path = require('path');
const { clipboard } = require('electron');
const { paths, exists, log } = require('./core');
const instances = require('./instances');
const { anonym } = require('./crashreport');

const API = 'https://api.mclo.gs/1/log';
const MAX_ZEILEN = 25000;           // Grenze von mclo.gs
const MAX_BYTES = 9 * 1024 * 1024;  // mclo.gs nimmt bis 10 MiB

function lies(file) {
  const st = fs.statSync(file);
  const len = Math.min(st.size, MAX_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    let text = buf.toString('utf8');
    if (st.size > len) text = text.slice(text.indexOf('\n') + 1);   // angeschnittene erste Zeile weg
    const zeilen = text.split(/\r?\n/);
    return zeilen.length > MAX_ZEILEN ? zeilen.slice(-MAX_ZEILEN).join('\n') : text;
  } finally {
    fs.closeSync(fd);
  }
}

function neuesteDatei(dir, re) {
  try {
    return fs.readdirSync(dir).filter(n => re.test(n))
      .map(n => ({ f: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f || null;
  } catch (_) { return null; }
}

/**
 * @param {string} version  Minecraft-Version (Instanz)
 * @param {'latest'|'crash'|'launcher'} what
 * @returns {{url:string, raw:string|null, file:string}}
 */
async function share(version, what = 'latest') {
  let file;
  if (what === 'launcher') {
    file = paths.launchLog;
  } else {
    const v = instances.requireVersion(version);
    file = what === 'crash'
      ? neuesteDatei(paths.crashReportsRoot(v), /^crash-.*\.txt$/i)
      : path.join(paths.instanceRoot(v), 'logs', 'latest.log');
  }
  if (!file || !exists(file)) {
    throw new Error(what === 'crash' ? 'There is no crash report for this version yet.' : 'There is no log for this version yet -- start the game once.');
  }
  const text = anonym(lies(file));
  if (!text.trim()) throw new Error('The log is empty.');

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'VortexClientLauncher' },
    body: JSON.stringify({ content: text, source: 'Vortex Launcher' }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.url) {
    throw new Error(`mclo.gs did not accept the log${data.error ? `: ${data.error}` : ` (${res.status})`}.`);
  }
  try { clipboard.writeText(data.url); } catch (_) {}
  log(`Log shared: ${path.basename(file)} -> ${data.url}`);
  return { url: data.url, raw: data.raw || null, file: path.basename(file) };
}

module.exports = { share };
