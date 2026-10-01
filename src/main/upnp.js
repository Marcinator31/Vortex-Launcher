'use strict';
/**
 * Port im Router freigeben (UPnP-IGD), damit Freunde von aussen auf einen
 * gehosteten Server kommen -- ohne dass jemand im Router herumklicken muss.
 *
 * Ablauf: Router per SSDP im Netz suchen -> seine Beschreibung (XML) laden ->
 * WANIPConnection/WANPPPConnection finden -> AddPortMapping per SOAP.
 * Klappt nicht bei jedem Router (UPnP aus, doppeltes NAT, CGNAT beim
 * Anbieter) -- dann bleibt nur die manuelle Portfreigabe.
 */
const dgram = require('dgram');
const http = require('http');

const SSDP = { host: '239.255.255.250', port: 1900 };
const TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
];

/** Antwortende Router (LOCATION-URLs) im lokalen Netz suchen. */
function discover(timeoutMs = 3000) {
  return new Promise(resolve => {
    const found = new Set();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (_) { resolve([]); return; }
    const done = () => { try { sock.close(); } catch (_) {} resolve([...found]); };
    sock.on('error', done);
    sock.on('message', msg => {
      const m = String(msg).match(/^location:\s*(\S+)/im);
      if (m && /^http:\/\//i.test(m[1])) found.add(m[1]);
    });
    sock.bind(0, () => {
      for (const st of TARGETS) {
        const req = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP.host}:${SSDP.port}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(req, SSDP.port, SSDP.host, () => {});
      }
    });
    setTimeout(done, timeoutMs).unref?.();
  });
}

/** Einfacher HTTP-Aufruf; liefert auch die eigene IP im Netz des Routers. */
function httpRequest(url, { method = 'GET', headers = {}, body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: timeoutMs }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size < 512 * 1024) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), localAddress: req.socket?.localAddress || null }));
    });
    req.on('timeout', () => req.destroy(new Error('The router did not answer.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const tag = (xml, name) => { const m = String(xml).match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1].trim() : null; };

/** Aus der Router-Beschreibung den passenden WAN-Dienst holen. */
async function gatewayFrom(location) {
  const res = await httpRequest(location);
  if (res.status !== 200) throw new Error(`Router description failed (${res.status}).`);
  const base = tag(res.text, 'URLBase') || location;
  for (const block of res.text.match(/<service>[\s\S]*?<\/service>/gi) || []) {
    const type = tag(block, 'serviceType');
    const control = tag(block, 'controlURL');
    if (!type || !control || !/:service:WAN(IP|PPP)Connection:\d/i.test(type)) continue;
    const local = res.localAddress ? res.localAddress.replace(/^::ffff:/, '') : null;
    return { type, controlUrl: new URL(control, base).toString(), localAddress: local };
  }
  throw new Error('This router does not offer port sharing.');
}

async function soap(gw, action, args = {}) {
  const params = Object.entries(args).map(([k, v]) => `<${k}>${String(v).replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]))}</${k}>`).join('');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gw.type}">${params}</u:${action}></s:Body></s:Envelope>`;
  const res = await httpRequest(gw.controlUrl, {
    method: 'POST', body,
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.type}#${action}"` }
  });
  if (res.status !== 200) {
    const code = tag(res.text, 'errorCode');
    const desc = tag(res.text, 'errorDescription');
    const err = new Error(`Router refused ${action}${code ? ` (${code}${desc ? ` ${desc}` : ''})` : ` (${res.status})`}.`);
    err.upnpCode = Number(code) || null;
    throw err;
  }
  return res.text;
}

let cachedGateway = null;
async function gateway() {
  if (cachedGateway) return cachedGateway;
  const locations = await discover();
  let lastErr = new Error('No router with UPnP found.');
  for (const loc of locations) {
    try { cachedGateway = await gatewayFrom(loc); return cachedGateway; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const DESCRIPTION = 'Vortex Client (Minecraft)';

/**
 * Port oeffnen. Ergebnis: { externalIp, localAddress, lease } -- lease > 0
 * heisst: der Router gibt den Port nur auf Zeit frei, renew() vorher aufrufen.
 */
async function open(port) {
  const gw = await gateway();
  if (!gw.localAddress) throw new Error('Could not find this PC in the router network.');
  const add = lease => soap(gw, 'AddPortMapping', {
    NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port,
    NewInternalClient: gw.localAddress, NewEnabled: 1, NewPortMappingDescription: DESCRIPTION, NewLeaseDuration: lease
  });
  let lease = 0;
  try { await add(0); }
  catch (e) {
    // Manche Router nehmen nur Freigaben auf Zeit (Fehler 725) -- oder umgekehrt.
    lease = 3600;
    try { await add(lease); } catch (_) { throw e; }
  }
  let externalIp = null;
  try { externalIp = tag(await soap(gw, 'GetExternalIPAddress'), 'NewExternalIPAddress'); } catch (_) {}
  return { externalIp, localAddress: gw.localAddress, lease };
}

async function close(port) {
  if (!cachedGateway) return;
  try { await soap(cachedGateway, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }); } catch (_) {}
}

/** Private bzw. vom Anbieter geteilte Adresse (CGNAT 100.64/10)? Dann klappt es von aussen nicht. */
function isPrivateIp(ip) {
  const p = String(ip || '').split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254);
}

module.exports = { open, close, isPrivateIp, reset: () => { cachedGateway = null; } };
