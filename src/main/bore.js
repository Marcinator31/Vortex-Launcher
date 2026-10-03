'use strict';
/**
 * Tunnel fuer Freunde ueber bore (https://github.com/ekzhang/bore).
 *
 * bore.pub ist ein kostenloser, oeffentlicher Tunnel-Server: kein Konto,
 * nichts zu bestaetigen, kein Programm zum Herunterladen -- das Protokoll ist
 * so einfach, dass der Launcher es selbst spricht:
 *
 *   Steuerverbindung zu bore.pub:7835
 *     -> {"Hello":0}                 (0 = beliebiger oeffentlicher Port)
 *     <- {"Hello":41234}             Freunde verbinden sich mit bore.pub:41234
 *     <- "Heartbeat"                 regelmaessig, haelt die Verbindung offen
 *     <- {"Connection":"<uuid>"}     ein Freund klopft an
 *   Fuer jede Connection eine NEUE Verbindung zu bore.pub:7835
 *     -> {"Accept":"<uuid>"}         danach fliessen rohe Bytes in beide Richtungen,
 *                                    die der Launcher an den lokalen Server weiterreicht
 *
 * Jede Nachricht ist JSON, abgeschlossen mit einem Null-Byte.
 *
 * Grenzen (ehrlich): bore.pub ist ein freiwillig betriebener Dienst. Die
 * Portnummer ist bei jedem Start eine andere, und faellt der Dienst aus, gibt
 * es keine Adresse (dann greift UPnP).
 */
const net = require('net');
const { EventEmitter } = require('events');

const DEFAULT_HOST = 'bore.pub';
const CONTROL_PORT = 7835;

/** Liest null-terminierte JSON-Nachrichten; liefert Rest-Bytes nach "Accept" weiter. */
function reader(socket, onMessage) {
  let buf = Buffer.alloc(0);
  const onData = chunk => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const raw = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 1);
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { continue; }
      onMessage(msg);
    }
  };
  socket.on('data', onData);
  return () => socket.off('data', onData);
}

const write = (socket, obj) => socket.write(Buffer.concat([Buffer.from(JSON.stringify(obj), 'utf8'), Buffer.from([0])]));

/**
 * Tunnel oeffnen.
 * @param {number} localPort  Port des Minecraft-Servers auf diesem Rechner
 * @param {{host?:string, port?:number, log?:Function}} opts
 * @returns {Promise<EventEmitter & {address:string, remotePort:number, close:Function}>}
 *   opts.wunschPort: diesen oeffentlichen Port erbitten (gleiche Adresse wie
 *   beim letzten Mal); ist er belegt, antwortet bore mit einem Fehler.
 *   Ereignisse: 'connection' (Anzahl), 'close' (Grund)
 */
function open(localPort, opts = {}) {
  const host = opts.host || DEFAULT_HOST;
  const controlPort = opts.port || CONTROL_PORT;
  const log = opts.log || (() => {});
  const tunnel = new EventEmitter();
  const offen = new Set();
  let control = null, closed = false, heartbeat = null;

  tunnel.close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { control?.destroy(); } catch (_) {}
    for (const s of offen) { try { s.destroy(); } catch (_) {} }
    offen.clear();
    tunnel.emit('close', 'closed');
  };

  /** Eine Verbindung eines Freundes annehmen und an den lokalen Server haengen. */
  const accept = id => {
    const remote = net.connect({ host, port: controlPort });
    const local = net.connect({ host: '127.0.0.1', port: localPort });
    offen.add(remote); offen.add(local);
    const weg = () => { offen.delete(remote); offen.delete(local); try { remote.destroy(); } catch (_) {} try { local.destroy(); } catch (_) {} };
    remote.on('error', weg); local.on('error', weg);
    remote.on('close', weg); local.on('close', weg);
    remote.setNoDelay(true); local.setNoDelay(true);
    remote.once('connect', () => {
      write(remote, { Accept: id });
      remote.pipe(local);
      local.pipe(remote);
    });
    tunnel.emit('connection', offen.size / 2);
  };

  return new Promise((resolve, reject) => {
    let fertig = false;
    const fail = err => {
      if (!fertig) { fertig = true; reject(err); }
      else if (!closed) { log(`bore: ${err.message}`); tunnel.close(); }
    };
    control = net.connect({ host, port: controlPort });
    control.setKeepAlive(true, 15000);
    const timer = setTimeout(() => { fail(new Error(`${host} did not answer.`)); try { control.destroy(); } catch (_) {} }, 12000);
    control.once('connect', () => write(control, { Hello: Number(opts.wunschPort) || 0 }));
    control.on('error', e => { clearTimeout(timer); fail(new Error(`${host}: ${e.message}`)); });
    control.on('close', () => { clearTimeout(timer); if (!fertig) fail(new Error(`${host} closed the connection.`)); else if (!closed) { closed = true; clearInterval(heartbeat); tunnel.emit('close', 'lost'); } });
    reader(control, msg => {
      if (msg && typeof msg === 'object' && 'Hello' in msg) {
        clearTimeout(timer);
        if (fertig) return;
        fertig = true;
        tunnel.remotePort = Number(msg.Hello);
        tunnel.address = `${host}:${tunnel.remotePort}`;
        resolve(tunnel);
      } else if (msg && typeof msg === 'object' && 'Connection' in msg) {
        accept(msg.Connection);
      } else if (msg && typeof msg === 'object' && 'Error' in msg) {
        clearTimeout(timer);
        fail(new Error(`${host}: ${msg.Error}`));
      } else if (msg && typeof msg === 'object' && 'Challenge' in msg) {
        clearTimeout(timer);
        fail(new Error(`${host} wants a password -- not supported.`));
      }
      // "Heartbeat": nichts zu tun
    });
  });
}

module.exports = { open, DEFAULT_HOST };
