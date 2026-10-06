'use strict';
/**
 * Java finden oder automatisch herunterladen.
 *
 *   Minecraft 26.x       -> Java 25
 *   1.20.5 bis 1.21.x    -> Java 21
 *   1.18 bis 1.20.4      -> Java 17
 *   aelter               -> Java 8
 *
 * Reihenfolge: eigenes Java aus den Einstellungen (wenn neu genug), dann
 * bereits heruntergeladene Laufzeit, dann installierte Javas, sonst Download
 * von Adoptium (Eclipse Temurin, JRE) in den Datenordner -- mit Fortschritt.
 */
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { paths, ensureDir, exists, log, send } = require('./core');

const execFileAsync = promisify(execFile);

function requiredJavaMajor(version) {
  const v = String(version || '').trim();
  if (/^2\d\./.test(v)) return 25;
  const m = v.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!m) return 21;
  const minor = Number(m[1]), patch = Number(m[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

/**
 * Passt dieses Java? Alte Versionen (1.8.9 ... 1.16) brauchen genau Java 8:
 * LWJGL 2 laeuft mit neueren Javas nicht zuverlaessig (Fenster, Maus, Sound).
 */
function passt(major, need) { return need === 8 ? major === 8 : major >= need; }
function javaBinary(home) { return path.join(home, 'bin', exe); }

/** Alle Java-Verzeichnisse unter root (root selbst und eine Ebene darunter). */
function homesIn(root) {
  const out = [];
  if (!root || !exists(root)) return out;
  if (exists(javaBinary(root))) out.push(root);
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const cand = path.join(root, e.name);
      if (exists(javaBinary(cand))) out.push(cand);
    }
  } catch (_) {}
  return out;
}

const majorCache = new Map();
async function majorOfBinary(binary) {
  if (!binary || !exists(binary)) return null;
  if (majorCache.has(binary)) return majorCache.get(binary);
  try {
    const r = await execFileAsync(binary, ['-version'], { windowsHide: true, timeout: 15000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const m = out.match(/version\s+"(?:1\.)?(\d+)/i) || out.match(/openjdk\s+(\d+)/i);
    const major = m ? Number(m[1]) : null;
    majorCache.set(binary, major);
    return major;
  } catch (_) { return null; }
}

function runtimeDir(major) { return path.join(paths.runtimeRoot, `java-${major}`); }

async function findInstalled(requiredMajor) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const roots = [
    runtimeDir(requiredMajor),
    process.env.JAVA_HOME || '',
    path.join(pf, 'Eclipse Adoptium'),
    path.join(pf, 'Java'),
    path.join(pf, 'Microsoft'),
    path.join(pf, 'Zulu'),
    path.join(pf, 'BellSoft')
  ];
  const seen = new Set();
  for (const root of roots) {
    for (const home of homesIn(root)) {
      if (seen.has(home)) continue;
      seen.add(home);
      const major = await majorOfBinary(javaBinary(home));
      if (major && passt(major, requiredMajor)) return { binary: javaBinary(home), major };
    }
  }
  return null;
}

const downloads = new Map();

async function download(requiredMajor) {
  if (process.platform !== 'win32') {
    throw new Error(`Minecraft needs Java ${requiredMajor}. Install it, or set the Java path in Settings.`);
  }
  if (downloads.has(requiredMajor)) return downloads.get(requiredMajor);
  const task = (async () => {
    const dir = runtimeDir(requiredMajor);
    ensureDir(dir);
    const url = `https://api.adoptium.net/v3/binary/latest/${requiredMajor}/ga/windows/x64/jre/hotspot/normal/eclipse`;
    log(`Downloading Java ${requiredMajor} runtime (Eclipse Temurin) ...`);
    send('progress', { stage: 'java', label: `Downloading Java ${requiredMajor}`, percent: 0 });
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error(`Java ${requiredMajor} could not be downloaded (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || 0;
    const archive = path.join(dir, `java-${requiredMajor}.zip`);
    const out = fs.createWriteStream(archive);
    let got = 0, lastPct = -1;
    try {
      for await (const chunk of res.body) {
        got += chunk.length;
        if (got > 600 * 1024 * 1024) throw new Error('Java download is unexpectedly large.');
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        const pct = total ? Math.floor(got / total * 100) : 0;
        if (pct !== lastPct) { lastPct = pct; send('progress', { stage: 'java', label: `Downloading Java ${requiredMajor}`, percent: pct }); }
      }
    } finally {
      await new Promise(r => out.end(r));
    }
    if (got < 10 * 1024 * 1024) throw new Error('The Java download is incomplete.');
    send('progress', { stage: 'java', label: `Unpacking Java ${requiredMajor}`, percent: 100 });
    try {
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const a = archive.replace(/'/g, "''"), d = dir.replace(/'/g, "''");
      await execFileAsync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${a}' -DestinationPath '${d}' -Force`], { windowsHide: true, timeout: 5 * 60 * 1000 });
    } finally {
      try { fs.rmSync(archive, { force: true }); } catch (_) {}
    }
    const found = await findInstalled(requiredMajor);
    if (!found) throw new Error(`Java ${requiredMajor} could not be verified after unpacking.`);
    log(`Java ${requiredMajor} is ready: ${found.binary}`);
    return found;
  })();
  downloads.set(requiredMajor, task);
  try { return await task; } finally { downloads.delete(requiredMajor); }
}

/**
 * Java fuer eine Minecraft-Version. customPath aus den Einstellungen hat
 * Vorrang -- aber nur, wenn es neu genug ist; sonst wird es mit Hinweis
 * uebergangen statt Minecraft mit einer Fehlermeldung abstuerzen zu lassen.
 */
async function javaFor(version, customPath = '') {
  const need = requiredJavaMajor(version);
  if (customPath) {
    const bin = /java(w)?(\.exe)?$/i.test(customPath) ? customPath : javaBinary(customPath);
    const major = await majorOfBinary(bin);
    if (major && passt(major, need)) {
      log(`Using your Java ${major}: ${bin}`);
      return { binary: bin, major };
    }
    log(`Your Java (${bin}) is ${major ? `Java ${major}` : 'not usable'}; Minecraft ${version} needs Java ${need}. Using the automatic Java instead.`, 'warn');
  }
  const found = await findInstalled(need) || await download(need);
  log(`Minecraft ${version} uses Java ${found.major}: ${found.binary}`);
  return found;
}

/** Fuer die Einstellungen: was ist ein Pfad fuer ein Java? */
async function inspect(customPath) {
  if (!customPath) return { ok: false };
  const bin = /java(w)?(\.exe)?$/i.test(customPath) ? customPath : javaBinary(customPath);
  const major = await majorOfBinary(bin);
  return major ? { ok: true, binary: bin, major } : { ok: false, error: 'No working Java found at this path.' };
}

module.exports = { requiredJavaMajor, javaFor, inspect };
