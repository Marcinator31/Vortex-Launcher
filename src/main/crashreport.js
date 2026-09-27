'use strict';
/**
 * Absturzberichte an den Besitzer (Discord-Webhook aus config.js).
 *
 * NUR MIT ZUSTIMMUNG: Der Spieler drueckt im Absturz-Fenster "Bericht
 * senden" -- oder hat in den Einstellungen "Absturzberichte automatisch
 * senden" eingeschaltet (Standard: aus).
 *
 * ANONYM: kein Minecraft-Name, keine UUID, keine IP. Pfade mit dem
 * Windows-Benutzernamen werden unkenntlich gemacht. Gesendet wird, was zum
 * Beheben noetig ist: Versionen, Mods, Befund der Absturz-Analyse und ein
 * Ausschnitt aus dem Crash-Report.
 */
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const config = require('./config');
const settings = require('./settings');
const instances = require('./instances');
const accounts = require('./accounts');
const { log } = require('./core');

const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function enabled() { return WEBHOOK.test(String(config.crashWebhook || '')); }

/** Benutzernamen und Heimatpfade aus einem Text entfernen. */
function anonym(text) {
  let s = String(text || '');
  const weg = new Set();
  try { weg.add(os.homedir()); } catch (_) {}
  try { weg.add(os.userInfo().username); } catch (_) {}
  try { for (const a of accounts.list()) { if (a.username) weg.add(a.username); if (a.uuid) weg.add(a.uuid); } } catch (_) {}
  for (const w of [...weg].filter(x => x && x.length >= 3).sort((a, b) => b.length - a.length)) {
    s = s.split(w).join(w.includes('\\') || w.includes('/') ? '~' : '<user>');
  }
  // IPv4-Adressen (z. B. aus Verbindungsfehlern)
  return s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function send(analysis) {
  if (!enabled()) throw new Error('Crash reports are not set up in this launcher.');
  if (!analysis || !analysis.version) throw new Error('There is no crash to report.');
  const v = analysis.version;
  const id = crypto.randomBytes(3).toString('hex');
  let info = {}, mods = [];
  try { info = instances.bundleInfo(v); } catch (_) {}
  try {
    const managed = new Set(instances.activeBundle(v).map(n => n.toLowerCase()));
    mods = instances.modsWithIds(v).filter(m => m.enabled && !managed.has(m.file.toLowerCase())).map(m => `${m.name} ${String(m.version).split('+')[0]}`);
  } catch (_) {}
  const findings = (analysis.findings || []).slice(0, 4).map(f => `**${f.title}**\n${f.detail || ''}`).join('\n\n');
  const excerpt = anonym(analysis.excerpt || '').split(/\r?\n/).slice(-25).join('\n');
  const cfg = settings.get();

  const body = {
    username: 'Vortex Crash Reports',
    embeds: [{
      title: cut(`Crash: Minecraft ${v}${analysis.code != null ? ` (exit ${analysis.code})` : ''}`, 250),
      color: 0xE0457B,
      description: cut(anonym(`${findings || 'No known cause.'}\n\`\`\`\n${cut(excerpt, 1800)}\n\`\`\``), 4000),
      fields: [
        { name: 'Vortex', value: cut(`Client ${info.clientVersion || '—'}${info.addonVersion ? ` · Addon ${info.addonVersion}` : ''}\nLauncher ${app.getVersion()}`, 1000), inline: true },
        { name: 'System', value: cut(`${os.type()} ${os.release()}\n${Math.round(os.totalmem() / 1073741824)} GB RAM · ${cfg.memoryMax} MB for MC`, 1000), inline: true },
        { name: `Extra mods (${mods.length})`, value: cut(mods.join(', ') || 'none', 1000) }
      ],
      footer: { text: `Report ${id}` },
      timestamp: new Date().toISOString()
    }]
  };
  const res = await fetch(`${config.crashWebhook}?wait=false`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'VortexClientLauncher' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!res.ok && res.status !== 204) throw new Error(`The report could not be sent (${res.status}).`);
  log(`Crash report ${id} sent.`);
  return { id };
}

module.exports = { enabled, send, anonym };
