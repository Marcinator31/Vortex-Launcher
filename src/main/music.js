'use strict';
/**
 * Musik im Launcher.
 *
 * Zwei Quellen:
 *  1. MINECRAFT-SOUNDTRACK -- aus den Spieldateien, die der Launcher fuer
 *     deine Versionen schon heruntergeladen hat (assets\indexes + objects).
 *     Das ist DEINE Kopie der Musik, die mit dem Spiel kommt: nichts wird
 *     mitgeliefert oder aus dem Internet geladen.
 *  2. EIGENER ORDNER -- mp3, ogg, m4a, wav, flac, opus.
 *
 * Abgespielt wird im Fenster (<audio>) ueber das Schema vxmusic://track/<id>.
 * Es liefert NUR Dateien aus der zuletzt erstellten Titelliste -- kein
 * beliebiger Dateizugriff.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { paths, exists, loadJson, log } = require('./core');

const AUDIO = /\.(mp3|ogg|oga|m4a|wav|flac|opus)$/i;
const registry = new Map();          // id -> Datei

/** Bekannte Titel des Soundtracks (Dateiname -> Titel, Kuenstler). */
const TITEL = {
  calm1: ['Minecraft', 'C418'], calm2: ['Clark', 'C418'], calm3: ['Sweden', 'C418'],
  hal1: ['Subwoofer Lullaby', 'C418'], hal2: ['Living Mice', 'C418'], hal3: ['Haggstrom', 'C418'], hal4: ['Danny', 'C418'],
  nuance1: ['Key', 'C418'], nuance2: ['Oxygène', 'C418'], piano1: ['Dry Hands', 'C418'], piano2: ['Wet Hands', 'C418'], piano3: ['Mice on Venus', 'C418'],
  menu1: ['Mutation', 'C418'], menu2: ['Moog City 2', 'C418'], menu3: ['Beginning 2', 'C418'], menu4: ['Floating Trees', 'C418']
};

const nice = name => name.replace(/[_-]+/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());

function add(file, title, artist, group) {
  const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
  registry.set(id, file);
  return { id, title, artist, group, url: `vxmusic://track/${id}` };
}

/** Alle heruntergeladenen Asset-Indizes aller Instanzen -> Musik-Eintraege. */
function minecraftTracks() {
  const out = [];
  const seen = new Set();
  let roots = [];
  try { roots = fs.readdirSync(paths.instancesRoot).map(n => path.join(paths.instancesRoot, n, 'assets')); } catch (_) {}
  for (const assets of roots) {
    let indexes = [];
    try { indexes = fs.readdirSync(path.join(assets, 'indexes')).filter(n => n.endsWith('.json')); } catch (_) { continue; }
    for (const idx of indexes) {
      const objects = loadJson(path.join(assets, 'indexes', idx), {})?.objects || {};
      for (const [key, o] of Object.entries(objects)) {
        const m = key.match(/^minecraft\/sounds\/(music|records)\/(?:(\w+)\/)?([\w-]+)\.ogg$/);
        if (!m || !o?.hash) continue;
        const base = m[3];
        const kind = m[1] === 'records' ? 'Discs' : (m[2] ? nice(m[2]) : 'Music');
        const ident = `${m[1]}/${m[2] || ''}/${base}`;
        if (seen.has(ident)) continue;
        const file = path.join(assets, 'objects', o.hash.slice(0, 2), o.hash);
        if (!exists(file)) continue;
        seen.add(ident);
        const [title, artist] = TITEL[base] || [nice(base), 'Minecraft'];
        out.push(add(file, title, artist, kind));
      }
    }
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

function folderTracks(dir) {
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (e.isFile() && AUDIO.test(e.name) && out.length < 2000) {
        const base = e.name.replace(AUDIO, '');
        const [artist, title] = base.includes(' - ') ? base.split(' - ', 2) : ['', base];
        out.push(add(p, title.trim(), artist.trim(), path.basename(d)));
      }
    }
  };
  if (dir) walk(dir, 0);
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

function tracks(source, folder) {
  registry.clear();
  const list = source === 'folder' ? folderTracks(folder) : minecraftTracks();
  log(`Music: ${list.length} track(s) (${source === 'folder' ? 'own folder' : 'Minecraft soundtrack'}).`, 'debug');
  return list;
}

const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/ogg' };

/** Fuer protocol.handle('vxmusic', ...). */
async function serve(request, net) {
  const id = (new URL(request.url).pathname || '').replace(/^\/+/, '');
  const file = registry.get(id);
  if (!file || !exists(file)) return new Response('not found', { status: 404 });
  const res = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
  const ext = (file.match(/\.(\w+)$/) || [])[1];
  // Minecraft-Assets haben keine Endung -- das ist immer Ogg Vorbis.
  const type = ext ? MIME[ext.toLowerCase()] : 'audio/ogg';
  const headers = new Headers(res.headers);
  if (type) headers.set('Content-Type', type);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

module.exports = { tracks, serve };
