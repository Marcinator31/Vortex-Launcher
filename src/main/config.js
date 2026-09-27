'use strict';
/**
 * ===========================================================================
 *  EINSTELLUNGEN FUER EUCH (Launcher-Besitzer) -- hier anpassen, dann bauen.
 * ===========================================================================
 */
module.exports = Object.freeze({
  /**
   * GitHub-Repo des Launchers. Hier liegen
   *  - die Launcher-Releases (Auto-Update des Launchers) und
   *  - das Release "vortex-files" mit den Client-/Addon-Jars aus dem
   *    Admin-Bereich (wird automatisch angelegt, als Pre-Release, damit der
   *    Launcher-Updater es ignoriert).
   * Das Repo muss OEFFENTLICH sein, sonst koennen die Launcher der Spieler
   * die Dateien nicht laden.
   */
  github: { owner: 'Lukas3578', repo: 'Vortex-launcher' },
  filesTag: 'vortex-files',

  /**
   * Minecraft-Namen, bei denen der Admin-Bereich in der Seitenleiste
   * erscheint (Gross-/Kleinschreibung egal). Er ist ausserdem immer ueber
   * Strg+Umschalt+A erreichbar. Hochladen geht trotzdem NUR mit eurem
   * GitHub-Token -- die Liste blendet nur den Menuepunkt ein.
   */
  admins: [M_rc],

  /**
   * Discord Rich Presence: Application-ID aus
   * https://discord.com/developers/applications (siehe README).
   * Leer = Discord-Anzeige aus.
   */
  discordClientId: '1538299202407506022',

  website: 'https://vortex-client.onrender.com',
  officialServer: { name: 'VortexPvP', address: 'mc.vortexpvp.eu' }
});
