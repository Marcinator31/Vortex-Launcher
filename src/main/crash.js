'use strict';
/**
 * Absturz-Analyse: liest Crash-Report, latest.log, JVM-Absturzdatei und die
 * letzten Konsolenzeilen und uebersetzt die haeufigsten Ursachen in
 * verstaendliche Hinweise -- mit passender Aktion (Mod ausschalten, RAM,
 * Java, Fabric API ...).
 */
const fs = require('fs');
const path = require('path');
const { exists } = require('./core');
const instances = require('./instances');

const MAX_READ = 2 * 1024 * 1024;

function readTail(file, max = MAX_READ) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (_) { return ''; }
}

function newestFile(dir, re, since) {
  try {
    return fs.readdirSync(dir).filter(n => re.test(n))
      .map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .filter(x => x.t >= since - 5000)
      .sort((a, b) => b.t - a.t)
      .map(x => path.join(dir, x.n))[0] || null;
  } catch (_) { return null; }
}

const CLASS_TO_JAVA = { 52: 8, 55: 11, 60: 16, 61: 17, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25, 70: 26 };

/**
 * @param {{version:string, gameDirectory:string, startedAt:number, code:number|null, output:string[]}} ctx
 */
function analyze(ctx) {
  const { version, gameDirectory, startedAt, code, output = [] } = ctx;
  const report = newestFile(path.join(gameDirectory, 'crash-reports'), /^crash-.*\.txt$/i, startedAt);
  const hsErr = newestFile(gameDirectory, /^hs_err_pid\d+\.log$/i, startedAt);
  const latest = path.join(gameDirectory, 'logs', 'latest.log');
  const reportText = report ? readTail(report) : '';
  const logText = exists(latest) ? readTail(latest) : '';
  const hsText = hsErr ? readTail(hsErr, 256 * 1024) : '';
  const outText = output.join('\n');
  const all = `${reportText}\n${logText}\n${outText}`;

  let mods = [];
  try { mods = instances.modsWithIds(version); } catch (_) {}
  const byId = new Map();
  for (const m of mods) { if (m.id) byId.set(m.id, m); for (const p of m.provides) if (!byId.has(p)) byId.set(p, m); }
  const managed = new Set();
  try { for (const n of instances.activeBundle(version)) managed.add(n.toLowerCase()); } catch (_) {}
  const modName = id => byId.get(id)?.name || id;
  const canDisable = id => { const m = byId.get(id); return m && m.enabled && !managed.has(m.file.toLowerCase()) ? m : null; };

  const findings = [];
  const seen = new Set();
  const add = f => { const k = `${f.kind}|${f.title}`; if (!seen.has(k)) { seen.add(k); findings.push(f); } };

  // --- 1. Fabric: inkompatible / fehlende Mods -------------------------------
  const fabricBlock = all.match(/(Incompatible mods? found!|Some of your mods are incompatible|Mod resolution failed|Mod resolution encountered)[\s\S]{0,6000}/i);
  if (fabricBlock) {
    const block = fabricBlock[0];
    const lines = block.split(/\r?\n/).map(l => l.replace(/^[\s\t]*-\s*/, '').trim()).filter(Boolean);
    for (const l of lines) {
      let m;
      if ((m = l.match(/^Remove mod '([^']+)' \(([^)]+)\)/i))) {
        const mod = canDisable(m[2]);
        add({ kind: 'mod', severity: 'error', title: `${m[1]} does not work with this setup`, detail: l, actions: mod ? [{ type: 'disableMod', file: mod.file, label: `Disable ${m[1]}` }] : [] });
      } else if ((m = l.match(/^Replace mod '([^']+)' \(([^)]+)\).*?with (?:any )?version (.+?)(?: or later)?\.?$/i))) {
        const own = byId.get(m[2]);
        const isManaged = /^vortex/.test(m[2]) || (own && managed.has(own.file.toLowerCase()));
        add({ kind: 'mod', severity: 'error', title: `${m[1]} is the wrong version`,
          detail: isManaged ? `Needed: ${m[3]}. This file comes with Vortex -- the Vortex team has to publish a matching version. Restart the launcher to fetch it.` : `Needed: ${m[3]}.`,
          actions: isManaged ? [] : [{ type: 'checkUpdates', label: 'Check mod updates' }] });
      } else if ((m = l.match(/^Install ([a-z0-9_-]+),? (?:version )?(.+?)(?: or later)?\.?$/i))) {
        add({ kind: 'missing', severity: 'error', title: `${modName(m[1])} is missing`, detail: `Needed: ${m[1]} ${m[2]}.`,
          actions: [{ type: 'installMod', project: m[1], label: `Install ${m[1]} from Modrinth` }] });
      } else if ((m = l.match(/^Mod '([^']+)' \(([^)]+)\).*? requires (?:any version|version (.+?)) of (?:mod )?'?([^',!]+?)'? ?(?:\(([^)]+)\))?, which is missing/i))) {
        const dep = m[5] || m[4];
        add({ kind: 'missing', severity: 'error', title: `${m[1]} needs ${m[4]}`, detail: l,
          actions: [{ type: 'installMod', project: dep.trim(), label: `Install ${m[4].trim()}` }] });
      } else if ((m = l.match(/^Mod '([^']+)' \(([^)]+)\).*? is incompatible with .*?'([^']+)' \(([^)]+)\)/i))) {
        const a = canDisable(m[2]), b = canDisable(m[4]);
        add({ kind: 'conflict', severity: 'error', title: `${m[1]} and ${m[3]} do not work together`, detail: l,
          actions: [a && { type: 'disableMod', file: a.file, label: `Disable ${m[1]}` }, b && { type: 'disableMod', file: b.file, label: `Disable ${m[3]}` }].filter(Boolean) });
      } else if ((m = l.match(/^Mod '([^']+)' \(([^)]+)\).*? requires .*?\bminecraft\b.*?, but only the wrong version is present: (.+?)!?$/i))) {
        const mod = canDisable(m[2]);
        add({ kind: 'mod', severity: 'error', title: `${m[1]} is not made for Minecraft ${m[3]}`, detail: l,
          actions: [mod && { type: 'disableMod', file: mod.file, label: `Disable ${m[1]}` }, { type: 'checkUpdates', label: 'Check mod updates' }].filter(Boolean) });
      }
    }
    if (!findings.length) add({ kind: 'mod', severity: 'error', title: 'Some mods do not fit together', detail: 'Fabric refused to start because of incompatible or missing mods. Details are in the console.', actions: [{ type: 'openMods', label: 'Open mods' }] });
  }

  // --- 2. Doppelte Mods -------------------------------------------------------
  let m;
  if ((m = all.match(/(?:Duplicate mods?|provided by multiple|Found \d+ duplicate).{0,200}?[`'"(]([a-z0-9_-]{2,64})[`'")]/i))) {
    add({ kind: 'duplicate', severity: 'error', title: `${modName(m[1])} is installed twice`, detail: 'Two files contain the same mod. Remove the older one.', actions: [{ type: 'openMods', label: 'Open mods' }] });
  }

  // --- 3. Fabric API fehlt ------------------------------------------------------
  if (/NoClassDefFoundError: net\/fabricmc\/fabric\/api|ClassNotFoundException: net\.fabricmc\.fabric\.api/.test(all)) {
    add({ kind: 'missing', severity: 'error', title: 'Fabric API is missing', detail: 'A mod needs the Fabric API, but it is not installed or disabled.', actions: [{ type: 'installMod', project: 'fabric-api', label: 'Install Fabric API' }] });
  }

  // --- 4. Mixin-Fehler: welche Mod? -------------------------------------------
  const mixinRe = /Mixin apply(?: for mod)? ([a-z0-9_-]+) failed|from mod ([a-z0-9_-]+)\][^\n]*(?:failed|Exception)|(?:InvalidInjectionException|MixinApplyError|InjectionError)[^\n]{0,300}?from mod ([a-z0-9_-]+)/gi;
  const mixinMods = new Set();
  while ((m = mixinRe.exec(all))) { const id = m[1] || m[2] || m[3]; if (id) mixinMods.add(id); }
  for (const id of mixinMods) {
    const mod = canDisable(id);
    if (/^vortex/.test(id)) {
      add({ kind: 'vortex', severity: 'error', title: 'The Vortex Client could not load', detail: 'Usually another mod changes the same part of the game (often rendering mods). Disable recently added mods and try again. If it keeps happening, send the crash report to the Vortex team.', actions: [{ type: 'openMods', label: 'Open mods' }, { type: 'openCrash', label: 'Crash reports' }] });
    } else {
      add({ kind: 'mod', severity: 'error', title: `${modName(id)} crashed while loading`, detail: 'This mod is probably not compatible with this Minecraft version or with another mod.', actions: [mod && { type: 'disableMod', file: mod.file, label: `Disable ${modName(id)}` }, { type: 'checkUpdates', label: 'Check mod updates' }].filter(Boolean) });
    }
  }

  // --- 5. Arbeitsspeicher -------------------------------------------------------
  if (/java\.lang\.OutOfMemoryError(?!: Metaspace)|GC overhead limit exceeded/.test(all)) {
    add({ kind: 'memory', severity: 'error', title: 'Minecraft ran out of memory', detail: 'Give Minecraft more RAM in the settings (4-6 GB is a good value). Very large resource packs or shaders need more.', actions: [{ type: 'moreRam', label: 'Add 1 GB RAM' }] });
  }
  if (/Could not reserve enough space for .*?heap|Invalid maximum heap size|There is insufficient memory for the Java Runtime/i.test(all + hsText)) {
    add({ kind: 'memory', severity: 'error', title: 'Too much RAM is set', detail: 'Windows could not give Minecraft that much memory. Lower the RAM in the settings or close other programs.', actions: [{ type: 'lessRam', label: 'Use 1 GB less' }] });
  }

  // --- 6. Java-Version ----------------------------------------------------------
  if ((m = all.match(/UnsupportedClassVersionError.*?class file version (\d+)/))) {
    const need = CLASS_TO_JAVA[Number(m[1])] || '';
    add({ kind: 'java', severity: 'error', title: `Java${need ? ` ${need}` : ''} is needed`, detail: 'The Java version used is too old for this Minecraft version or a mod.', actions: [{ type: 'javaAuto', label: 'Choose Java automatically' }] });
  }

  // --- 7. Grafiktreiber ----------------------------------------------------------
  const gpu = `${all}\n${hsText}`;
  if (/GLFW error 6554[23]|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|OpenGL 3\.2 not supported|Failed to create window/i.test(gpu)
    || /(atio6axx|atioglxx|nvoglv64|ig\d+icd64|ig\w+icd64)\.dll/i.test(hsText)) {
    const vendor = /atio|amd/i.test(gpu) ? 'AMD' : /nvoglv|nvidia/i.test(gpu) ? 'NVIDIA' : /ig\w*icd|intel/i.test(gpu) ? 'Intel' : null;
    add({ kind: 'driver', severity: 'error', title: 'Graphics driver problem', detail: `Update your ${vendor ? `${vendor} ` : ''}graphics driver from the manufacturer's website. On laptops, make sure Java uses the dedicated graphics card.`, actions: [] });
  }
  if (!findings.some(f => f.kind === 'driver') && (code === -1073741819 || code === 3221225477 || /EXCEPTION_ACCESS_VIOLATION/.test(hsText))) {
    add({ kind: 'driver', severity: 'warn', title: 'Minecraft was closed by a native crash', detail: 'Often caused by graphics drivers or overlays (Discord, MSI Afterburner, RivaTuner, OBS hooks). Update your graphics driver and turn overlays off.', actions: [] });
  }

  // --- 8. Veraltete Mod (fehlende Methode/Klasse) ----------------------------------
  if (!findings.length && (m = all.match(/(NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|AbstractMethodError|IncompatibleClassChangeError)[:\s]+([^\n]{0,160})/))) {
    add({ kind: 'mod', severity: 'error', title: 'A mod is not made for this version', detail: `${m[1]}: ${m[2].trim()}. Update your mods or disable the ones you added recently.`, actions: [{ type: 'checkUpdates', label: 'Check mod updates' }, { type: 'openMods', label: 'Open mods' }] });
  }

  // --- Zusammenfassung aus dem Crash-Report -------------------------------------
  const description = (reportText.match(/^Description: (.+)$/m) || [])[1] || null;
  const exception = (reportText.match(/^(?:[a-z0-9_$.]+\.)+[A-Z][A-Za-z0-9_$]*(?:Exception|Error)[^\n]*/m) || [])[0] || null;
  if (!findings.length) {
    add({ kind: 'unknown', severity: 'warn', title: 'No known cause found', detail: description ? `Minecraft says: "${description}"${exception ? ` -- ${exception.slice(0, 200)}` : ''}` : 'Check the console and crash report. If you added mods recently, disable them and try again.', actions: [{ type: 'openCrash', label: 'Crash reports' }] });
  }

  const excerptSource = reportText || logText.split(/\r?\n/).slice(-80).join('\n') || outText.split('\n').slice(-80).join('\n');
  return {
    version, code, at: Date.now(),
    report, hsErr, description, exception,
    findings: findings.slice(0, 8),
    excerpt: excerptSource.slice(0, 6000)
  };
}

module.exports = { analyze };
