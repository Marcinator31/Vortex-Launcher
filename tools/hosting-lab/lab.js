'use strict';
/**
 * Hosting-Labor (laeuft nur in GitHub Actions): prueft mit echten Servern,
 *   1. wie Paper eine Einzelspielerwelt veraendert (Ordner, level.dat),
 *   2. ob Paper ueber Verknuepfungen direkt auf der Originalwelt laufen kann,
 *   3. ob danach der normale (Vanilla-)Server die Welt noch richtig laedt,
 *   4. ob Freunde ueber bore.pub hereinkommen (Statusabfrage durch den Tunnel).
 * Ergebnisse als ::notice-Zeilen.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execSync } = require('child_process');
const nbt = require('../../src/main/nbt');
const bore = require('../../src/main/bore');

const V = process.env.LAB_V || '26.2';
const ROOT = path.resolve(process.env.LAB_DIR || 'lab');
const note = (t) => console.log(`::notice title=${V}::${String(t).replace(/\n/g, ' | ').slice(0, 3800)}`);
const warn = (t) => console.log(`::warning title=${V}::${String(t).replace(/\n/g, ' | ').slice(0, 3800)}`);

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function dl(url, file) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }

function tree(dir, depth = 3, pre = '') {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch (_) { return out; }
  for (const n of names) {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) { out.push(`${pre}${n} -> ${fs.readlinkSync(p)}`); continue; }
    if (st.isDirectory()) {
      if (/^(region|entities|poi|data|playerdata|advancements|stats|datapacks)$/.test(n)) { out.push(`${pre}${n}/ (${fs.readdirSync(p).length})`); continue; }
      out.push(`${pre}${n}/`);
      if (depth > 1) out.push(...tree(p, depth - 1, pre + '  '));
    } else out.push(`${pre}${n}`);
  }
  return out;
}

function files(dir, base = dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch (_) { return out; }
  for (const n of names) {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      if (/^(region|entities|poi)$/.test(n)) { out.push(`${path.relative(base, p)}/ [${fs.readdirSync(p).length}]`); continue; }
      out.push(...files(p, base));
    } else out.push(`${path.relative(base, p)} ${st.size}`);
  }
  return out;
}

function levelInfo(worldDir) {
  try {
    const doc = nbt.readGz(path.join(worldDir, 'level.dat'));
    const data = nbt.child(doc.root, 'Data');
    const keys = [...data.value.keys()].sort();
    const wgs = nbt.child(data, 'WorldGenSettings');
    const seed = wgs ? nbt.child(wgs, 'seed')?.value : nbt.child(data, 'RandomSeed')?.value;
    return { keys: keys.join(','), seed: String(seed) };
  } catch (e) { return { error: e.message }; }
}

function run(jar, cwd, args, { stopAfterDone = true, timeoutMs = 240000, onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn('java', ['-Xmx2G', '-jar', jar, '--nogui', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let done = false;
    const timer = setTimeout(() => { lines.push('!! TIMEOUT'); try { child.kill('SIGKILL'); } catch (_) {} }, timeoutMs);
    let buf = '';
    const feed = d => {
      buf += String(d);
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const l of parts) {
        lines.push(l);
        if (onLine) onLine(l, child);
        if (!done && /Done \([\d.,]+s\)!/.test(l)) {
          done = true;
          if (stopAfterDone) child.stdin.write('stop\n');
        }
      }
    };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, done, lines, child }); });
    child.ready = new Promise(r => { const t = setInterval(() => { if (done) { clearInterval(t); r(); } }, 200); });
    if (!stopAfterDone) resolve.child = child;
    run.last = child;
  });
}

function props(dir, extra) {
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(dir, 'server.properties'), Object.entries({ 'online-mode': 'false', 'server-port': 25599, motd: 'VortexLab', ...extra }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

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

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const ver = await json(manifest.versions.find(x => x.id === V).url);
  const vanilla = path.join(ROOT, 'vanilla.jar');
  await dl(ver.downloads.server.url, vanilla);
  const pb = await json(`https://fill.papermc.io/v3/projects/paper/versions/${V}/builds/latest`);
  const paper = path.join(ROOT, 'paper.jar');
  await dl(pb.downloads['server:default'].url, paper);
  note(`Paper build ${pb.id} (${pb.channel || ''})`);

  // 1) Welt mit Vanilla erzeugen (wie eine Einzelspielerwelt)
  const A = path.join(ROOT, 'A'); fs.mkdirSync(A);
  props(A, { 'level-name': 'welt' });
  let r = await run(vanilla, A, []);
  note(`vanilla create: done=${r.done} code=${r.code}`);
  note(`VANILLA WORLD: ${tree(path.join(A, 'welt')).join('\n')}`);
  note(`VANILLA FILES: ${files(path.join(A, 'welt')).join('\n')}`);
  const vInfo = levelInfo(path.join(A, 'welt'));
  note(`vanilla level.dat: seed=${vInfo.seed} keys=${vInfo.keys}`);
  // Nether + End erzeugen lassen? Vanilla erzeugt die Dimensionen beim Start.

  // 2) Paper auf einer KOPIE: was aendert sich?
  const C = path.join(ROOT, 'C'); fs.mkdirSync(path.join(C, 'worlds'), { recursive: true });
  execSync(`cp -r "${path.join(A, 'welt')}" "${path.join(C, 'worlds', 'welt')}"`);
  props(C, { 'level-name': 'welt' });
  r = await run(paper, C, ['--universe', path.join(C, 'worlds'), '--world', 'welt']);
  note(`paper on copy: done=${r.done} code=${r.code}; migration lines: ${r.lines.filter(l => /migrat|convert|moving|Upgrad/i.test(l)).slice(0, 8).join(' || ')}`);
  note(`PAPER UNIVERSE AFTER: ${tree(path.join(C, 'worlds')).join('\n')}`);
  note(`PAPER FILES: ${files(path.join(C, 'worlds')).join('\n')}`);
  const pInfo = levelInfo(path.join(C, 'worlds', 'welt'));
  note(`paper level.dat: seed=${pInfo.seed} keys=${pInfo.keys}`);

  // 3) Vanilla wieder auf der von Paper beruehrten Welt
  const D = path.join(ROOT, 'D'); fs.mkdirSync(D);
  execSync(`cp -r "${path.join(C, 'worlds', 'welt')}" "${path.join(D, 'welt')}"`);
  props(D, { 'level-name': 'welt' });
  r = await run(vanilla, D, []);
  const dInfo = levelInfo(path.join(D, 'welt'));
  note(`vanilla after paper: done=${r.done} code=${r.code} seed=${dInfo.seed} (orig ${vInfo.seed})`);
  note(`vanilla after paper LOG TAIL: ${r.lines.filter(l => !/^WARNING: /.test(l)).slice(-30).join('\n')}`);

  // 4) bore: Paper starten, Tunnel auf, Statusabfrage von "aussen"
  props(C, { 'level-name': 'welt' });
  const child = spawn('java', ['-Xmx2G', '-jar', paper, '--nogui', '--universe', path.join(C, 'worlds'), '--world', 'welt'], { cwd: C, stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise((res) => { let b = ''; const f = d => { b += d; if (/Done \(/.test(b)) res(); }; child.stdout.on('data', f); setTimeout(res, 180000); });
  try {
    const t = await bore.open(25599, { log: m => warn(m) });
    note(`bore tunnel: ${t.address}`);
    const st = await ping(bore.DEFAULT_HOST, t.remotePort);
    note(`ping through bore OK: motd=${JSON.stringify(st.description)} version=${st.version?.name} players=${st.players?.online}/${st.players?.max}`);
    t.close();
  } catch (e) { warn(`bore failed: ${e.message}`); }
  child.stdin.write('stop\n');
  await new Promise(res => child.on('exit', res));
  process.exit(0);
})().catch(e => { warn(`lab crashed: ${e.stack}`); process.exit(1); });
