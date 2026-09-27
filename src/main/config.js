'use strict';
/**
 * ===========================================================================
 *  EINSTELLUNGEN FUER EUCH (Launcher-Besitzer) -- hier anpassen, dann bauen.
 * ===========================================================================
 */
module.exports = Object.freeze({
  /**
   * OEFFENTLICHES Repo des Launchers. Hier liegen Code, die fertigen EXEs
   * (Auto-Update fuer alle Spieler) und das Release "vortex-files" mit den
   * Client-/Addon-Jars aus dem Admin-Bereich (automatisch, als Pre-Release).
   * Wenn du das aenderst: auch package.json -> build -> publish anpassen.
   */
  github: { owner: 'Marcinator31', repo: 'Vortex-Launcher' },
  filesTag: 'vortex-files',

  /**
   * Minecraft-Namen, bei denen der Admin-Bereich in der Seitenleiste
   * erscheint (Gross-/Kleinschreibung egal). Er ist ausserdem immer ueber
   * Strg+Umschalt+A erreichbar. Hochladen geht trotzdem NUR mit eurem
   * GitHub-Token -- die Liste blendet nur den Menuepunkt ein.
   */
  admins: ['m_rc'],

  /**
   * Beta-Tester (Minecraft-Namen): sehen in den Einstellungen den Schalter
   * "Beta-Updates" und bekommen neue Client-/Addon-Builds, bevor du sie fuer
   * alle freigibst. Admins koennen das immer.
   */
  betaTesters: [],

  /**
   * Discord Rich Presence: Application-ID aus
   * https://discord.com/developers/applications (siehe README).
   * Leer = Discord-Anzeige aus.
   */
  discordClientId: '1538299202407506022',

  website: 'https://vortex-client.onrender.com',
  officialServer: { name: 'VortexPvP', address: 'mc.vortexpvp.eu' }
});
