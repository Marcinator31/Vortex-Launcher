'use strict';
/**
 * Haengengebliebene Minecraft-Prozesse finden und beenden (nur Windows).
 *
 * WARUM: Schliesst man Minecraft, kann die Java-Maschine im Hintergrund
 * weiterlaufen -- ohne Fenster, aber mit allen Mod-Dateien geoeffnet. Windows
 * laesst geoeffnete Dateien nicht loeschen: alte Vortex-Jars blieben im
 * Mods-Ordner liegen ("Datei ist in OpenJDK Platform binary geoeffnet"),
 * sammelten sich an, und der naechste Start scheiterte.
 *
 * WAS ALS "HAENGENGEBLIEBEN" GILT -- nur dann wird beendet:
 *   - java.exe / javaw.exe, deren Kommandozeile den Ordner der Instanz enthaelt
 *   - OHNE sichtbares Fenster (ein laufendes Minecraft hat immer eins)
 *   - seit mindestens 60 Sekunden gestartet (beim Laden gibt es noch kein Fenster)
 */
const { execFile } = require('child_process');
const { log } = require('./core');

function powershell(script, timeout = 15000) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
  });
}

/** Alle Java-Prozesse: [{pid, cmd, window, ageSec}] (leer ausserhalb von Windows). */
async function javaProcesses() {
  if (process.platform !== 'win32') return [];
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$now = Get-Date",
    "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | ForEach-Object {",
    "  $gp = Get-Process -Id $_.ProcessId",
    "  [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine; window = [int64]$gp.MainWindowHandle; age = [int](($now - $_.CreationDate).TotalSeconds) }",
    "} | ConvertTo-Json -Compress"
  ].join('\n');
  const out = await powershell(script);
  if (!out || !out.trim()) return [];
  try {
    const data = JSON.parse(out);
    return (Array.isArray(data) ? data : [data]).map(p => ({ pid: Number(p.pid), cmd: String(p.cmd || ''), window: Number(p.window) || 0, ageSec: Number(p.age) || 0 }));
  } catch (_) { return []; }
}

/** Frueher: PIDs der vom Launcher gefuehrten Spiele. Nicht mehr noetig (siehe orphansFor). */
function setTracked() {}

const norm = s => String(s || '').replace(/\//g, '\\').toLowerCase();

/** Haengengebliebene Java-Prozesse, die diesen Ordner benutzen. */
async function orphansFor(dir) {
  const d = norm(dir).replace(/\\+$/, '');
  if (!d) return [];
  // Auch ein Spiel, das der Launcher noch als "laeuft" fuehrt, zaehlt: genau
  // das ist der Fall, wenn das Fenster zu ist, Java aber weiterlaeuft. Ein
  // echtes, laufendes Minecraft hat IMMER ein Fenster (auch minimiert).
  return (await javaProcesses()).filter(p => norm(p.cmd).includes(d) && !p.window && p.ageSec >= 60);
}

/** Beenden. Gibt die Anzahl beendeter Prozesse zurueck. */
async function killOrphans(dir) {
  const list = await orphansFor(dir);
  let n = 0;
  for (const p of list) {
    try { process.kill(p.pid); n++; log(`Ended a Minecraft process that was left running in the background (PID ${p.pid}, no window, ${p.ageSec}s old).`); }
    catch (e) {
      // Kein Recht? Dann mit taskkill versuchen (beendet auch Kindprozesse).
      await new Promise(r => execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, () => r()));
      n++;
    }
  }
  if (n) await new Promise(r => setTimeout(r, 1500));   // Windows gibt die Dateien kurz danach frei
  return n;
}

module.exports = { javaProcesses, orphansFor, killOrphans, setTracked };
