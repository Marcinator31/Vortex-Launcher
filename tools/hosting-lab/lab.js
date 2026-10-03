'use strict';
/**
 * Hosting-Labor (laeuft nur in GitHub Actions). Prueft mit ECHTEN Servern,
 * was der Launcher beim Hosten macht -- mit genau dem Code des Launchers
 * (src/main/paperwelt.js, src/main/bore.js):
 *
 *   1. Vanilla legt eine Welt an (wie eine Einzelspielerwelt), Spielregel
 *      keepInventory = true, Seed merken.
 *   2. Paper laeuft DIREKT auf dieser Welt (paperwelt.vorbereiten), stellt
 *      keepInventory = false um; Freunde-Test ueber bore.pub (Statusabfrage
 *      von aussen); danach paperwelt.nachbereiten.
 *   3. Vanilla startet die Welt wieder: muss starten, gleicher Seed,
 *      keepInventory muss jetzt false sein (Aenderung vom Server kommt an).
 *   4. Noch einmal Paper (zweiter Start, Welt schon uebernommen) und noch
 *      einmal Vanilla.
 * Ergebnis: lab/report-<version>.txt (wird als Release-Datei hochgeladen).
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const paperwelt = require('../../src/main/paperwelt');
const bore = require('../../src/main/bore');

const V = process.env.LAB_V || '26.2';
const ROOT = path.resolve(process.env.LAB_DIR || 'lab');
const report = [];
const say = t => { const s = String(t); report.push(s); console.log(s); };
const fin = (code) => {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, `report-${V}.txt`), report.join('\n') + '\n');
  process.exit(code);
};

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function dl(url, file) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }

function liste(dir, base = dir, tiefe = 0) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch (_) { return out; }
  for (const n of names) {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    const rel = path.relative(base, p);
    if (st.isSymbolicLink()) { out.push(`${rel} -> ${fs.readlinkSync(p)}`); continue; }
    if (st.isDirectory()) {
      if (/^(region|entities|poi)$/.test(n) || tiefe > 6) { out.push(`${rel}/ [${fs.readdirSync(p).length}]`); continue; }
      out.push(...liste(p, base, tiefe + 1));
    } else out.push(`${rel} ${st.size}`);
  }
  return out;
}

/** Server starten; nach "Done" Befehle schicken, Antworten sammeln, stoppen. */
function server(jar, cwd, args, befehle = [], { jvm = [], waehrend = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn('java', ['-Xmx2G', ...jvm, '-jar', jar, '--nogui', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let done = false;
    const timer = setTimeout(() => { lines.push('!! TIMEOUT'); try { child.kill('SIGKILL'); } catch (_) {} }, 6 * 60 * 1000);
    let buf = '';
    const feed = d => {
      buf += String(d);
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) {
        lines.push(l.replace(/\x1b\[[0-9;]*m/g, ''));
        if (!done && /Done \([\d.,]+s\)!/.test(l)) {
          done = true;
          (async () => {
            for (const b of befehle) { child.stdin.write(`${b}\n`); await new Promise(r => setTimeout(r, 1500)); }
            if (waehrend) { try { await waehrend(); } catch (e) { say(`  waehrend: ${e.message}`); } }
            child.stdin.write('stop\n');
          })();
        }
      }
    };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, done, lines }); });
  });
}

const antworten = (r, muster) => r.lines.filter(l => muster.test(l)).map(l => l.replace(/^\[[^\]]*\]\s*(\[[^\]]*\]:?\s*)?/, '').trim());

// Minecraft-Statusabfrage (Server List Ping)
function varint(n) { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); }
function ping(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host, () => {
      const h = Buffer.from(host);
      const body = Buffer.concat([varint(0), varint(767), varint(h.length), h, Buffer.from([port >> 8, port & 255]), varint(1)]);
      s.write(Buffer.concat([varint(body.length), body]));
      s.write(Buffer.from([1, 0]));
    });
    let buf = Buffer.alloc(0);
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      const str = buf.toString('utf8');
      const i = str.indexOf('{'); const j = str.lastIndexOf('}');
      if (i >= 0 && j > i) { try { const o = JSON.parse(str.slice(i, j + 1)); s.destroy(); resolve(o); } catch (_) {} }
    });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); reject(new Error('ping timeout')); }, 15000);
  });
}

function props(dir, extra = {}) {
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(dir, 'server.properties'), Object.entries({ 'online-mode': 'false', 'server-port': 25599, motd: 'VortexLab', 'level-name': 'welt', ...extra }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

const REGEL = ['gamerule keep_inventory', 'gamerule keepInventory'];

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  say(`=== Hosting-Labor Minecraft ${V} ===`);
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const ver = await json(manifest.versions.find(x => x.id === V).url);
  const vanilla = path.join(ROOT, 'vanilla.jar');
  await dl(ver.downloads.server.url, vanilla);
  const pb = await json(`https://fill.papermc.io/v3/projects/paper/versions/${V}/builds/latest`);
  const paper = path.join(ROOT, 'paper.jar');
  await dl(pb.downloads['server:default'].url, paper);
  say(`Paper build ${pb.id} (${pb.channel || ''})`);

  const saves = path.join(ROOT, 'saves');
  const welt = path.join(saves, 'welt');
  fs.mkdirSync(saves, { recursive: true });
  const vDir = path.join(ROOT, 'vanilla'); fs.mkdirSync(vDir); props(vDir);
  const pDir = path.join(ROOT, 'paper'); fs.mkdirSync(pDir); props(pDir);

  // 1) Vanilla legt die Welt an
  let r = await server(vanilla, vDir, ['--universe', saves, '--world', 'welt'], [...REGEL.map(x => `${x} true`), 'seed']);
  const seed1 = antworten(r, /Seed:/i)[0];
  say(`1 vanilla neu: done=${r.done} code=${r.code} ${seed1} | regel: ${antworten(r, /keep|Game ?rule|Incorrect|Unknown/i).join(' / ')}`);
  say(`  Aufbau neu? ${paperwelt.neuerAufbau(welt, V)}`);
  say(`  WELT:\n    ${liste(welt).join('\n    ')}`);

  // 2) Paper direkt auf der Welt + bore
  let vb = paperwelt.vorbereiten(welt, V, pDir);
  say(`2 paper vorbereitet: universe=${path.relative(ROOT, vb.universe)} world=${vb.world} neu=${vb.neu}`);
  let tunnelOk = false;
  r = await server(paper, pDir, ['--universe', vb.universe, '--world', vb.world], [...REGEL.map(x => `${x} false`), 'seed'], {
    jvm: ['-Dpaper.disableMigrationDelay=true'],
    waehrend: async () => {
      const t = await bore.open(25599, {});
      say(`  bore: ${t.address}`);
      const st = await ping(bore.DEFAULT_HOST, t.remotePort);
      tunnelOk = true;
      say(`  ping ueber bore OK: motd=${JSON.stringify(st.description)} version=${st.version?.name} spieler=${st.players?.online}/${st.players?.max}`);
      t.close();
    }
  });
  say(`  paper: done=${r.done} code=${r.code} ${antworten(r, /Seed:/i)[0]} | migration: ${antworten(r, /migrat|Vanilla import/i).slice(0, 4).join(' / ')}`);
  say(`  paper fehler: ${antworten(r, /ERROR|Exception/).slice(0, 6).join(' / ')}`);
  let zurueck = paperwelt.nachbereiten(welt, V);
  say(`  nachbereitet: ${zurueck.join(', ')}`);
  say(`  SAVES-ORDNER: ${fs.readdirSync(saves).join(', ')}`);
  say(`  WELT NACH PAPER:\n    ${liste(welt).join('\n    ')}`);

  // 3) Vanilla wieder
  r = await server(vanilla, vDir, ['--universe', saves, '--world', 'welt'], [...REGEL, 'seed']);
  const seed3 = antworten(r, /Seed:/i)[0];
  say(`3 vanilla wieder: done=${r.done} code=${r.code} ${seed3} (vorher ${seed1}) | regel: ${antworten(r, /keep|Game ?rule|Incorrect|Unknown/i).join(' / ')}`);
  if (!r.done) say(`  LOG-ENDE:\n    ${r.lines.filter(l => !/^WARNING: /.test(l)).slice(-25).join('\n    ')}`);

  // 4) Paper zweiter Start + Vanilla
  vb = paperwelt.vorbereiten(welt, V, pDir);
  r = await server(paper, pDir, ['--universe', vb.universe, '--world', vb.world], [...REGEL.map(x => `${x} true`)], { jvm: ['-Dpaper.disableMigrationDelay=true'] });
  say(`4 paper zweimal: done=${r.done} code=${r.code} | migration: ${antworten(r, /migrat|Vanilla import/i).slice(0, 2).join(' / ')}`);
  paperwelt.nachbereiten(welt, V);
  r = await server(vanilla, vDir, ['--universe', saves, '--world', 'welt'], [...REGEL, 'seed']);
  say(`5 vanilla zuletzt: done=${r.done} code=${r.code} ${antworten(r, /Seed:/i)[0]} | regel: ${antworten(r, /keep|Game ?rule/i).join(' / ')}`);

  say(`ERGEBNIS: tunnel=${tunnelOk} seed=${seed1 === seed3 ? 'gleich' : 'ANDERS'}`);
  fin(0);
})().catch(e => { say(`lab crashed: ${e.stack}`); fin(1); });
