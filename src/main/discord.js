'use strict';
/**
 * Discord Rich Presence ueber die lokale Discord-Schnittstelle (Named Pipe),
 * ohne Zusatzpaket. Braucht eine Application-ID in config.js.
 * Laeuft Discord nicht, passiert einfach nichts; alle 30 s neuer Versuch.
 */
const net = require('net');
const path = require('path');
const config = require('./config');
const settings = require('./settings');
const { log } = require('./core');

let sock = null, ready = false, retry = null, activity = null, buffer = Buffer.alloc(0);
const startedAt = Date.now();

const enabled = () => Boolean(config.discordClientId) && settings.get().discord !== false;
function german() {
  const pref = settings.get().language;
  if (pref === 'de') return true;
  if (pref === 'en') return false;
  try { return /^de\b/i.test(require('electron').app.getLocale()); } catch (_) { return false; }
}

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return path.join(base, `discord-ipc-${i}`);
}

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function cleanup() {
  ready = false;
  if (sock) { try { sock.destroy(); } catch (_) {} }
  sock = null;
  buffer = Buffer.alloc(0);
}

function scheduleRetry() {
  if (retry || !enabled()) return;
  retry = setTimeout(() => { retry = null; connect(); }, 30000);
}

function connect(i = 0) {
  if (!enabled() || sock) return;
  if (i > 9) { scheduleRetry(); return; }
  const s = net.createConnection(pipePath(i));
  let opened = false;
  s.once('connect', () => {
    opened = true;
    sock = s;
    s.write(frame(0, { v: 1, client_id: config.discordClientId }));
  });
  s.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0), len = buffer.readInt32LE(4);
      if (buffer.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(buffer.subarray(8, 8 + len).toString('utf8')); } catch (_) {}
      buffer = buffer.subarray(8 + len);
      if (op === 1 && msg?.evt === 'READY') { ready = true; log('Discord connected.', 'debug'); push(); }
      if (op === 2) { cleanup(); scheduleRetry(); }                       // CLOSE
      if (op === 3) s.write(frame(4, msg));                               // PING -> PONG
    }
  });
  s.on('error', () => { if (!opened) { s.destroy(); connect(i + 1); } });
  s.on('close', () => { if (opened) { cleanup(); scheduleRetry(); } });
}

function push() {
  if (!ready || !sock) return;
  const payload = { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: String(Date.now()) };
  try { sock.write(frame(1, payload)); } catch (_) {}
}

/**
 * @param {{state:'launcher'|'playing', version?:string, client?:string, server?:string, since?:number}} s
 */
function update(s) {
  if (!enabled()) { if (sock) { activity = null; push(); cleanup(); } return; }
  const playing = s.state === 'playing';
  const de = german();
  activity = {
    details: playing ? (de ? `Spielt Minecraft ${s.version}` : `Playing Minecraft ${s.version}`) : (de ? 'Im Launcher' : 'In the launcher'),
    state: playing ? (s.server ? `${de ? 'auf' : 'on'} ${s.server}` : s.client ? `Vortex Client ${s.client}` : 'Fabric') : (de ? 'Macht sich bereit' : 'Getting ready'),
    timestamps: { start: Math.floor((s.since || startedAt) / 1000) },
    assets: { large_image: 'logo', large_text: 'Vortex Client' },
    buttons: [{ label: 'Vortex Client', url: config.website }]
  };
  if (!sock) connect(); else push();
}

function stop() { if (retry) clearTimeout(retry); retry = null; activity = null; push(); cleanup(); }

module.exports = { update, stop, available: () => Boolean(config.discordClientId) };
