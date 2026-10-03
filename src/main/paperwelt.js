'use strict';
/**
 * Paper DIREKT auf der Einzelspielerwelt -- ohne Kopie (seit Launcher 2.5).
 *
 * Paper aendert eine Welt beim ersten Start. Damit die Welt danach im
 * Einzelspieler genauso weiterlaeuft, kuemmert sich dieses Modul um zwei
 * Dinge -- je nach Aufbau der Welt:
 *
 * NEUER AUFBAU (Minecraft 26.x: alles unter <welt>/dimensions/...)
 *   Paper legt die weltweiten Daten (Seed/world_gen_settings, Spielregeln,
 *   Wetter, geplante Ereignisse, Haendler) JE DIMENSION ab und LOESCHT die
 *   Originale in <welt>/data/minecraft. Minecraft selbst sucht sie aber genau
 *   dort -- ohne world_gen_settings startet die Welt nicht mehr.
 *     vorher:  Originale -> Paper-Ablage (so gelten Aenderungen aus dem
 *              Einzelspieler auch auf dem Server)
 *     nachher: Paper-Ablage -> Originale (so gelten Aenderungen vom Server,
 *              z. B. /gamerule oder Wetter, auch im Einzelspieler)
 *
 * ALTER AUFBAU (1.21.x: Nether in <welt>/DIM-1, End in <welt>/DIM1)
 *   Paper erwartet Nether und End als eigene Welten neben der Hauptwelt
 *   (<welt>_nether/DIM-1, <welt>_the_end/DIM1) und wuerde sie dorthin
 *   VERSCHIEBEN. Stattdessen laeuft der Server in einem eigenen Ordner, und
 *   dort sind die drei Welten nur VERKNUEPFUNGEN (Windows: Junctions, keine
 *   Adminrechte noetig) auf die Ordner der Originalwelt. Paper schreibt
 *   also direkt in die Originalwelt, nichts wird kopiert oder verschoben.
 *
 * Bewusst ohne Electron-Abhaengigkeit: das Hosting-Labor (tools/hosting-lab)
 * testet genau diesen Code mit echten Servern.
 */
const fs = require('fs');
const path = require('path');

/** Weltweite Daten, die Paper je Dimension ablegt (Datei = Name ohne .dat). */
const ALLE_DIMENSIONEN = ['game_rules', 'weather'];
const NUR_OBERWELT = ['world_gen_settings', 'scheduled_events', 'wandering_trader'];
const DIMENSIONEN = ['overworld', 'the_nether', 'the_end'];

const exists = p => { try { fs.accessSync(p); return true; } catch (_) { return false; } };

/** Neuer Aufbau? (26.x) -- an der Welt selbst erkannt, sonst an der Version. */
function neuerAufbau(worldDir, version) {
  if (exists(path.join(worldDir, 'dimensions'))) return true;
  if (exists(path.join(worldDir, 'DIM-1')) || exists(path.join(worldDir, 'DIM1')) || exists(path.join(worldDir, 'region'))) return false;
  return /^2\d\./.test(String(version || ''));
}

const rootData = w => path.join(w, 'data', 'minecraft');
const dimData = (w, dim) => path.join(w, 'dimensions', 'minecraft', dim, 'data', 'minecraft');

function kopiere(von, nach) {
  if (!exists(von)) return false;
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  const tmp = `${nach}.vortex-tmp`;
  fs.copyFileSync(von, tmp);
  fs.renameSync(tmp, nach);
  return true;
}

/** Verknuepfung auf einen Ordner (Windows: Junction, sonst Symlink). */
function verknuepfe(ziel, link) {
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink()) {
      if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(ziel)) return;
      fs.unlinkSync(link);
    } else {
      throw new Error(`${link} exists and is not a link -- not touching it.`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(path.resolve(ziel), link, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * Vor dem Start. Liefert, womit Paper gestartet wird:
 *   { universe, world, neu }  ->  --universe <universe> --world <world>
 * serverDir: Arbeitsordner des Servers (nur fuer den alten Aufbau gebraucht).
 */
function vorbereiten(worldDir, version, serverDir) {
  const name = path.basename(worldDir);
  if (neuerAufbau(worldDir, version)) {
    // Einzelspieler-Stand der weltweiten Daten an Paper weitergeben -- aber
    // erst, wenn Paper die Welt schon einmal uebernommen hat (sonst macht
    // Paper das beim ersten Start selbst).
    const paperDa = exists(path.join(worldDir, 'dimensions', 'minecraft', 'overworld', 'data', 'paper'));
    if (paperDa) {
      for (const n of ALLE_DIMENSIONEN) {
        for (const d of DIMENSIONEN) {
          if (exists(path.join(worldDir, 'dimensions', 'minecraft', d))) kopiere(path.join(rootData(worldDir), `${n}.dat`), path.join(dimData(worldDir, d), `${n}.dat`));
        }
      }
      for (const n of NUR_OBERWELT) kopiere(path.join(rootData(worldDir), `${n}.dat`), path.join(dimData(worldDir, 'overworld'), `${n}.dat`));
    }
    return { universe: path.dirname(worldDir), world: name, neu: true };
  }
  // Alter Aufbau: Verknuepfungen im Server-Ordner
  const universe = path.join(serverDir, 'welten');
  fs.mkdirSync(universe, { recursive: true });
  for (const d of ['DIM-1', 'DIM1']) fs.mkdirSync(path.join(worldDir, d), { recursive: true });
  verknuepfe(worldDir, path.join(universe, name));
  verknuepfe(path.join(worldDir, 'DIM-1'), path.join(universe, `${name}_nether`, 'DIM-1'));
  verknuepfe(path.join(worldDir, 'DIM1'), path.join(universe, `${name}_the_end`, 'DIM1'));
  return { universe, world: name, neu: false };
}

/** Nach dem Stoppen: weltweite Daten wieder dorthin, wo Minecraft sie sucht. */
function nachbereiten(worldDir, version) {
  const zurueck = [];
  if (!neuerAufbau(worldDir, version)) return zurueck;
  for (const n of [...ALLE_DIMENSIONEN, ...NUR_OBERWELT]) {
    if (kopiere(path.join(dimData(worldDir, 'overworld'), `${n}.dat`), path.join(rootData(worldDir), `${n}.dat`))) zurueck.push(n);
  }
  // usercache.json legt Paper neben die Welt (in den saves-Ordner) -- weg damit
  try { fs.rmSync(path.join(path.dirname(worldDir), 'usercache.json'), { force: true }); } catch (_) {}
  return zurueck;
}

module.exports = { vorbereiten, nachbereiten, neuerAufbau };
