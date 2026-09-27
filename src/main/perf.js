'use strict';
/**
 * Leistungs-Check: Was hat der PC, was ist eingestellt, wie lief die letzte
 * Runde -- und was sollte man aendern?
 *
 * Die FPS der letzten Runde schreibt der Vortex Client (ab 4.7.1) beim
 * Verlassen einer Welt nach <Instanz>/config/vortex-perf.json:
 *   { avgFps, lowFps, maxFps, minutes, renderDistance, date }
 * lowFps = die schlechtesten 1 % der Sekunden -- das, was man als Ruckler spuert.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { paths, exists, loadJson } = require('./core');
const settings = require('./settings');
const instances = require('./instances');

const MB = 1024 * 1024;

/** Empfohlener Arbeitsspeicher fuer Minecraft mit Mods (MB). */
function recommendedRam(totalMb) {
  if (totalMb <= 4096) return 1536;
  if (totalMb <= 6144) return 2048;
  if (totalMb <= 8192) return 3072;
  if (totalMb <= 16384) return 4096;
  return 6144;
}

/** Grafikkarten: Name, ob integriert, ob gerade benutzt. */
async function gpus() {
  try {
    const info = await app.getGPUInfo('complete');
    const devices = (info?.gpuDevice || []).map(d => {
      const name = String(d.deviceString || d.description || '').trim();
      const vendor = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft' }[d.vendorId] || String(d.vendorString || '');
      return { name: name || `${vendor} GPU`, vendor, active: Boolean(d.active), integrated: d.vendorId === 0x8086 || /radeon\(tm\) graphics|vega \d+ graphics|uhd|iris/i.test(name) };
    }).filter(d => d.vendor !== 'Microsoft');
    const renderer = String(info?.auxAttributes?.glRenderer || '');
    if (!devices.length && renderer) devices.push({ name: renderer.replace(/^ANGLE \(|\)$/g, ''), vendor: '', active: true, integrated: /intel|uhd|iris/i.test(renderer) });
    return devices;
  } catch (_) { return []; }
}

function optionsFile(version) { return path.join(paths.instanceRoot(version), 'options.txt'); }

function renderDistance(version) {
  try {
    const m = fs.readFileSync(optionsFile(version), 'utf8').match(/^renderDistance:(\d+)/m);
    return m ? Number(m[1]) : null;
  } catch (_) { return null; }
}

function lastRound(version) {
  const f = path.join(paths.instanceRoot(version), 'config', 'vortex-perf.json');
  if (!exists(f)) return null;
  const d = loadJson(f, null);
  if (!d || !Number.isFinite(Number(d.avgFps))) return null;
  return { avgFps: Math.round(d.avgFps), lowFps: Math.round(d.lowFps || 0), maxFps: Math.round(d.maxFps || 0), minutes: Math.round(d.minutes || 0), renderDistance: d.renderDistance || null, date: d.date || null };
}

async function info(version) {
  const v = instances.requireVersion(version);
  const cfg = settings.get();
  const totalMb = Math.round(os.totalmem() / MB);
  const cpu = os.cpus();
  const gpu = await gpus();
  const round = lastRound(v);
  const rd = renderDistance(v);
  let hasSodium = false;
  try { hasSodium = instances.modsWithIds(v).some(m => m.enabled && m.id === 'sodium'); } catch (_) {}

  const tips = [];
  const rec = recommendedRam(totalMb);
  if (cfg.memoryMax > totalMb - 2048 && totalMb > 3072) {
    tips.push({ id: 'ram', severity: 'warn', text: `Minecraft gets ${cfg.memoryMax} MB of ${totalMb} MB. Windows needs some too -- ${rec} MB is enough.`, action: { type: 'ram', value: rec, label: `Set to ${rec} MB` } });
  } else if (cfg.memoryMax < rec * 0.6) {
    tips.push({ id: 'ram', severity: 'warn', text: `Only ${cfg.memoryMax} MB for Minecraft. With mods ${rec} MB runs smoother.`, action: { type: 'ram', value: rec, label: `Set to ${rec} MB` } });
  }
  if (!hasSodium) {
    tips.push({ id: 'sodium', severity: 'info', text: 'Sodium, Lithium and EntityCulling are missing -- they often double the FPS.', action: { type: 'performance', label: 'Install performance mods' } });
  }
  if (round && (round.avgFps < 60 || round.lowFps < 30) && rd && rd > 8) {
    const neu = Math.max(6, rd - 4);
    tips.push({ id: 'rd', severity: 'warn', text: `Last round: ${round.avgFps} FPS on average, ${round.lowFps} in the worst moments. A render distance of ${neu} instead of ${rd} helps the most.`, action: { type: 'renderDistance', value: neu, label: `Render distance ${neu}` } });
  }
  const dedicated = gpu.find(g => !g.integrated);
  const activeIntegrated = gpu.find(g => g.integrated && g.active);
  if (dedicated && activeIntegrated) {
    tips.push({ id: 'gpu', severity: 'warn', text: `Your PC has a ${dedicated.name}, but the ${activeIntegrated.name} is in use. In Windows: Settings > System > Display > Graphics > add javaw.exe > "High performance".`, action: null });
  }
  if (!tips.length) tips.push({ id: 'ok', severity: 'ok', text: 'Everything looks good.', action: null });

  return {
    version: v,
    system: { ramMb: totalMb, freeMb: Math.round(os.freemem() / MB), cpu: cpu[0]?.model?.trim() || '?', cores: cpu.length, gpus: gpu },
    minecraft: { ramMb: cfg.memoryMax, renderDistance: rd, hasSodium },
    lastRound: round,
    tips
  };
}

/** Sichtweite in options.txt setzen (nur, wenn diese Version gerade nicht laeuft). */
function setRenderDistance(version, value) {
  const v = instances.requireVersion(version);
  const n = Math.max(2, Math.min(32, Number.parseInt(value, 10) || 8));
  const f = optionsFile(v);
  let text = exists(f) ? fs.readFileSync(f, 'utf8') : '';
  text = /^renderDistance:\d+/m.test(text) ? text.replace(/^renderDistance:\d+/m, `renderDistance:${n}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}renderDistance:${n}\n`;
  fs.writeFileSync(f, text);
  return { renderDistance: n };
}

module.exports = { info, setRenderDistance, recommendedRam };
