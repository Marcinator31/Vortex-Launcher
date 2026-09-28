/* =========================================================================
   Sprachen: Englisch ist die Grundsprache (Schluessel), hier steht Deutsch.
   {0}, {1} ... sind Platzhalter. Meldungen aus dem Hauptprozess werden ueber
   dieselben Schluessel erkannt (Platzhalter -> Regex) und uebersetzt.
   ========================================================================= */
(function (root) {
  'use strict';
  const DE = {
    // --- Navigation & allgemein ---
    'Home': 'Start', 'Versions': 'Versionen', 'Mods': 'Mods', 'Resource Packs': 'Resource Packs', 'Shaders': 'Shader',
    'Worlds': 'Welten', 'Screenshots': 'Screenshots', 'Servers': 'Server', 'Skins': 'Skins', 'Settings': 'Einstellungen',
    'Admin': 'Admin', 'Console': 'Konsole', 'CONTENT': 'INHALTE', 'PLAY': 'SPIELEN', 'CLIENT LAUNCHER': 'CLIENT LAUNCHER',
    'Minimize': 'Minimieren', 'Maximize': 'Maximieren', 'Restore': 'Wiederherstellen', 'Close': 'Schließen',
    'Cancel': 'Abbrechen', 'Confirm': 'Bestätigen', 'Remove': 'Entfernen', 'Delete': 'Löschen', 'Install': 'Installieren',
    'Installed': 'Installiert', 'Discover': 'Entdecken', 'Folder': 'Ordner', 'Open folder': 'Ordner öffnen', 'Select': 'Auswählen',
    'Selected': 'Ausgewählt', 'Refresh': 'Aktualisieren', 'Reload': 'Neu laden', 'Copy': 'Kopieren', 'Clear': 'Leeren',
    'Update': 'Aktualisieren', 'Enable': 'Einschalten', 'Disable': 'Ausschalten', 'Use': 'Benutzen', 'Reset': 'Zurücksetzen',
    'Loading…': 'Lädt…', 'Checking…': 'Prüfe…', 'Saved.': 'Gespeichert.', 'Removed.': 'Entfernt.', 'unknown': 'unbekannt',
    'Never': 'Nie', 'Just now': 'Gerade eben', '{0} min ago': 'vor {0} Min.', '{0} h ago': 'vor {0} Std.', 'Yesterday': 'Gestern',
    '{0} days ago': 'vor {0} Tagen', 'by {0}': 'von {0}', 'for': 'für', 'Instance': 'Instanz', 'Move to recycle bin': 'In den Papierkorb',
    'Relevance': 'Relevanz', 'Downloads': 'Downloads', 'Followers': 'Follower', 'Recently updated': 'Kürzlich aktualisiert', 'Newest': 'Neueste',
    'Load more': 'Mehr laden', 'Open on Modrinth': 'Auf Modrinth öffnen', 'Modrinth could not be reached': 'Modrinth ist nicht erreichbar',
    'No results': 'Keine Ergebnisse', 'Nothing found': 'Nichts gefunden', 'Something went wrong.': 'Etwas ist schiefgelaufen.',

    // --- Konto ---
    'Sign in with Microsoft': 'Mit Microsoft anmelden', 'Microsoft account': 'Microsoft-Konto', 'Playing': 'Spielt', 'ACCOUNTS': 'KONTEN',
    'Sign out': 'Abmelden', 'Sign out?': 'Abmelden?', 'Add another account': 'Weiteres Konto hinzufügen',
    '{0} will be removed from this launcher. You can sign in again at any time.': '{0} wird aus dem Launcher entfernt. Du kannst dich jederzeit wieder anmelden.',
    '{0} signed out.': '{0} abgemeldet.', 'A Microsoft sign-in window opens. Finish the sign-in there.': 'Ein Microsoft-Anmeldefenster öffnet sich. Melde dich dort an.',
    'Signed in as {0}.': 'Angemeldet als {0}.', 'Sign in': 'Anmelden',

    // --- Home ---
    'VORTEX CLIENT': 'VORTEX CLIENT', 'VERSION': 'VERSION', 'Ready when you are.': 'Bereit, wenn du es bist.',
    'Ready when <em>you</em> are.': 'Bereit, wenn <em>du</em> es bist.', 'Ready when you are,<br>{0}.': 'Los geht’s,<br>{0}.',
    'Fabric, the Vortex Client and your mods, set up in one click.': 'Fabric, der Vortex Client und deine Mods – mit einem Klick eingerichtet.',
    'Minecraft {0} with Fabric, the Vortex Client, the Plus Addon and your mods — set up in one click.': 'Minecraft {0} mit Fabric, dem Vortex Client, dem Plus Addon und deinen Mods – mit einem Klick eingerichtet.',
    'Minecraft {0} with Fabric, the Vortex Client and your mods — set up in one click.': 'Minecraft {0} mit Fabric, dem Vortex Client und deinen Mods – mit einem Klick eingerichtet.',
    'Play {0}.': '{0} spielen.', 'A plain Fabric instance with its own mods folder. The Vortex Client is only available for Vortex versions.': 'Eine reine Fabric-Instanz mit eigenem Mods-Ordner. Den Vortex Client gibt es nur für Vortex-Versionen.',
    'RUNNING': 'LÄUFT', 'Have fun, {0}.': 'Viel Spaß, {0}.', 'The launcher stays in the background. Close Minecraft or press stop to end the session.': 'Der Launcher bleibt im Hintergrund. Schließe Minecraft oder drücke Stopp, um die Sitzung zu beenden.',
    'STARTING': 'STARTET', 'SIGN IN': 'ANMELDEN', 'Microsoft account needed': 'Microsoft-Konto nötig', 'Minecraft {0} · first start downloads the game': 'Minecraft {0} · der erste Start lädt das Spiel',
    'Preparing…': 'Wird vorbereitet…', 'Stop Minecraft': 'Minecraft stoppen', 'Stop Minecraft?': 'Minecraft stoppen?', 'Stop': 'Stoppen',
    'Minecraft {0} ({1}) is closed immediately. Unsaved progress in singleplayer can be lost.': 'Minecraft {0} ({1}) wird sofort geschlossen. Ungespeicherter Fortschritt im Einzelspieler kann verloren gehen.',
    'not downloaded': 'nicht heruntergeladen', 'Quick join': 'Schnell beitreten', 'All servers': 'Alle Server', 'Join': 'Beitreten',
    'No servers yet.': 'Noch keine Server.', '{0} / {1} online': '{0} / {1} online', 'Offline': 'Offline', 'not reachable': 'nicht erreichbar',
    'You are already playing with this account. Close Minecraft first or switch accounts.': 'Du spielst mit diesem Konto schon. Schließe erst Minecraft oder wechsle das Konto.',
    'Fabric instance': 'Fabric-Instanz', 'MODS': 'MODS', 'PLAYED': 'GESPIELT', 'STATUS': 'STATUS', 'Ready': 'Bereit', 'Not downloaded': 'Nicht geladen',
    "What's new": 'Neuigkeiten', 'NEWS': 'NEWS', 'UPDATE': 'UPDATE',
    'Launcher 2.0: completely rebuilt, new design in the Vortex colours.': 'Launcher 2.0: komplett neu gebaut, neues Design in den Vortex-Farben.',
    'New Vortex versions are downloaded automatically.': 'Neue Vortex-Versionen werden automatisch geladen.',
    'Skins, shaders, worlds with backups, screenshots and mod updates.': 'Skins, Shader, Welten mit Backups, Screenshots und Mod-Updates.',
    'Crash analysis explains what went wrong.': 'Die Absturz-Analyse erklärt, was schiefging.',
    'Available for Minecraft {0}.': 'Für Minecraft {0} verfügbar.',
    'Minecraft crashed': 'Minecraft ist abgestürzt', 'Minecraft {0} crashed': 'Minecraft {0} ist abgestürzt', 'Show analysis': 'Analyse zeigen',
    'Why Minecraft {0} crashed': 'Warum Minecraft {0} abgestürzt ist', 'Exit code {0}.': 'Exit-Code {0}.',
    'The launcher checked the crash report and the log:': 'Der Launcher hat Crash-Report und Log ausgewertet:',
    'Show crash report excerpt': 'Auszug aus dem Crash-Report zeigen', 'Crash reports': 'Crash-Reports', 'Open console': 'Konsole öffnen',
    'Mod disabled. Press Play to try again.': 'Mod ausgeschaltet. Drück auf Spielen, um es nochmal zu versuchen.',
    '{0} installed.': '{0} installiert.', '{0} is already installed.': '{0} ist schon installiert.', 'Minecraft now gets {0}.': 'Minecraft bekommt jetzt {0}.',
    'Minecraft {0} crashed (exit code {1}).': 'Minecraft {0} ist abgestürzt (Exit-Code {1}).',

    // --- Versionen ---
    'INSTANCES': 'INSTANZEN', 'Every version has its own folder: its own mods, worlds and settings.': 'Jede Version hat ihren eigenen Ordner: eigene Mods, Welten und Einstellungen.',
    'Any release, e.g. 1.20.1': 'Jede Version, z. B. 1.20.1', 'Add version': 'Version hinzufügen', 'Import modpack': 'Modpack importieren',
    'Downloaded from the Vortex team': 'Vom Vortex-Team nachgeladen', 'UPDATED': 'AKTUALISIERT', 'CUSTOM': 'EIGENE', 'READY': 'BEREIT', 'NOT DOWNLOADED': 'NICHT GELADEN',
    'Fabric with your own mods': 'Fabric mit deinen eigenen Mods', '{0} mods': '{0} Mods', '{0} off': '{0} aus', 'played {0}': 'gespielt: {0}',
    'Export as modpack': 'Als Modpack exportieren', 'Check & repair': 'Prüfen & reparieren', 'Remove from list': 'Aus der Liste entfernen',
    'Minecraft {0} selected.': 'Minecraft {0} ausgewählt.', 'Remove {0}?': '{0} entfernen?',
    'The version disappears from the list. Its folder with worlds and mods stays on your PC.': 'Die Version verschwindet aus der Liste. Ihr Ordner mit Welten und Mods bleibt auf deinem PC.',
    'Minecraft {0} added and selected. The first start downloads it.': 'Minecraft {0} hinzugefügt und ausgewählt. Der erste Start lädt es herunter.',
    'Export Minecraft {0}': 'Minecraft {0} exportieren', 'Export': 'Exportieren',
    'Creates a .mrpack file you can share. Friends import it here or in any Modrinth-compatible launcher. Mods from Modrinth are only linked; Vortex files are not included.': 'Erstellt eine .mrpack-Datei zum Teilen. Freunde importieren sie hier oder in jedem Modrinth-kompatiblen Launcher. Mods von Modrinth werden nur verlinkt; Vortex-Dateien sind nicht enthalten.',
    'Mod settings (config folder)': 'Mod-Einstellungen (config-Ordner)', 'Minecraft options (keybinds, video)': 'Minecraft-Optionen (Tasten, Grafik)',
    'Resource packs': 'Resource Packs', 'Shader packs': 'Shader-Packs', 'Exported: {0} mods linked, {1} files included.': 'Exportiert: {0} Mods verlinkt, {1} Dateien enthalten.',
    'Importing the modpack… this can take a moment.': 'Modpack wird importiert… das kann einen Moment dauern.',
    'Modpack imported into Minecraft {0}: {1} files.': 'Modpack in Minecraft {0} importiert: {1} Dateien.', '{0} files could not be downloaded.': '{0} Dateien konnten nicht geladen werden.',

    // --- Mods ---
    'Add Fabric mods from Modrinth or your own .jar files.': 'Füge Fabric-Mods von Modrinth oder eigene .jar-Dateien hinzu.', 'Filter installed mods': 'Installierte Mods filtern',
    'Check for updates': 'Nach Updates suchen', 'Performance pack': 'Performance-Paket', 'Sodium, Lithium and Entity Culling': 'Sodium, Lithium und Entity Culling',
    'Add .jar files': '.jar-Dateien hinzufügen', 'Update all': 'Alle aktualisieren', 'Tip: drag .jar files into this window to add them.': 'Tipp: Zieh .jar-Dateien einfach in dieses Fenster.',
    'Search Modrinth, e.g. sodium, minimap, voice chat': 'Modrinth durchsuchen, z. B. sodium, minimap, voice chat',
    '1 update available.': '1 Update verfügbar.', '{0} updates available.': '{0} Updates verfügbar.',
    'No mods yet': 'Noch keine Mods', 'Find mods under “Discover” or add your own .jar files.': 'Finde Mods unter „Entdecken“ oder füge eigene .jar-Dateien hinzu.',
    'No installed mod matches your filter.': 'Kein installierter Mod passt zu deinem Filter.',
    'Switch the addon on or off in Settings': 'Das Addon schaltest du in den Einstellungen ein/aus', 'Managed by the Vortex launcher': 'Wird vom Vortex Launcher verwaltet',
    'VORTEX': 'VORTEX', 'ADDON': 'ADDON', 'INCLUDED': 'DABEI', 'MODRINTH': 'MODRINTH', 'LOCAL': 'EIGENE',
    'The file is moved to the recycle bin, so you can restore it if needed.': 'Die Datei kommt in den Papierkorb – du kannst sie bei Bedarf wiederherstellen.',
    '{0} removed.': '{0} entfernt.', '1 mod added.': '1 Mod hinzugefügt.', '{0} mods added.': '{0} Mods hinzugefügt.', 'Skipped: {0}': 'Übersprungen: {0}',
    '{0} (already installed)': '{0} (schon installiert)',
    'All mods are up to date.': 'Alle Mods sind aktuell.', '{0} updated to {1}.': '{0} auf {1} aktualisiert.', '{0} mods updated.': '{0} Mods aktualisiert.',
    'Could not update: {0}': 'Konnte nicht aktualisieren: {0}', 'Install the performance pack?': 'Performance-Paket installieren?',
    'Installs Sodium, Lithium and Entity Culling for Minecraft {0}. They make the game noticeably faster. If a Vortex module misbehaves afterwards, disable Sodium first.': 'Installiert Sodium, Lithium und Entity Culling für Minecraft {0}. Das Spiel läuft damit spürbar schneller. Wenn danach ein Vortex-Modul spinnt, schalte zuerst Sodium aus.',
    'Installed: {0}': 'Installiert: {0}', 'Not available for this version yet: {0}': 'Für diese Version noch nicht verfügbar: {0}',
    ' (+{0} required)': ' (+{0} benötigte)', '{0} installed{1}.': '{0} installiert{1}.', '{0} dependency could not be found for {1}.': '{0} Abhängigkeit(en) gibt es für {1} nicht.',
    'Added to Minecraft {0}.': 'Zu Minecraft {0} hinzugefügt.',

    // --- Packs & Shader ---
    "Packs land in this instance and can be enabled in Minecraft's options.": 'Packs landen in dieser Instanz und werden in den Minecraft-Optionen aktiviert.',
    'Search Modrinth, e.g. faithful, fresh animations': 'Modrinth durchsuchen, z. B. faithful, fresh animations',
    'No resource packs yet': 'Noch keine Resource Packs', 'Find packs under “Discover” or drop .zip files into the folder.': 'Finde Packs unter „Entdecken“ oder leg .zip-Dateien in den Ordner.',
    'Remove resource pack?': 'Resource Pack entfernen?', 'Remove shader?': 'Shader entfernen?', '{0} is moved to the recycle bin.': '{0} kommt in den Papierkorb.',
    '{0} is already there.': '{0} ist schon da.', '{0} installed. Enable it in Minecraft → Options → Resource Packs.': '{0} installiert. Aktiviere es in Minecraft → Optionen → Ressourcenpakete.',
    '{0} installed. Enable it in Minecraft → Options → Video Settings → Shader Packs.': '{0} installiert. Aktiviere es in Minecraft → Optionen → Grafikeinstellungen → Shader-Pakete.',
    'Shader packs need the Iris mod. Enable them in Minecraft under Options → Video Settings → Shader Packs.': 'Shader brauchen die Mod Iris. Aktiviert werden sie in Minecraft unter Optionen → Grafikeinstellungen → Shader-Pakete.',
    'Search Modrinth, e.g. complementary, bsl': 'Modrinth durchsuchen, z. B. complementary, bsl', 'No shaders yet': 'Noch keine Shader',
    'Find shaders under “Discover” or drop .zip files into the folder.': 'Finde Shader unter „Entdecken“ oder leg .zip-Dateien in den Ordner.',
    'Iris {0} is installed': 'Iris {0} ist installiert', 'Shaders are ready. Choose one in Minecraft under Options → Video Settings → Shader Packs.': 'Shader sind bereit. Wähle einen in Minecraft unter Optionen → Grafikeinstellungen → Shader-Pakete.',
    'Iris is disabled': 'Iris ist ausgeschaltet', 'Shaders need Iris': 'Shader brauchen Iris',
    'Iris loads shader packs. It also installs Sodium, which it needs. If a Vortex module misbehaves with Sodium, disable both again.': 'Iris lädt Shader-Packs und installiert dafür auch Sodium. Wenn ein Vortex-Modul mit Sodium spinnt, schalte beide wieder aus.',
    'Enable Iris': 'Iris einschalten', 'Install Iris': 'Iris installieren', 'Iris is ready.': 'Iris ist bereit.', 'Iris is not available for Minecraft {0} yet.': 'Iris gibt es für Minecraft {0} noch nicht.',
    'Nothing on Modrinth for Minecraft {0} matching “{1}”.': 'Nichts auf Modrinth für Minecraft {0} zu „{1}“.', 'Nothing on Modrinth for Minecraft {0}.': 'Nichts auf Modrinth für Minecraft {0}.',

    // --- Welten ---
    'Your singleplayer worlds with backups. Backups are full copies you can restore at any time.': 'Deine Einzelspieler-Welten mit Backups. Backups sind vollständige Kopien, die du jederzeit zurückholen kannst.',
    'Back up all': 'Alle sichern', 'Backup folder': 'Backup-Ordner', 'Open saves folder': 'Welten-Ordner öffnen', '{0} worlds · {1}': '{0} Welten · {1}',
    'No worlds yet': 'Noch keine Welten', 'Worlds you create in singleplayer show up here.': 'Welten aus dem Einzelspieler erscheinen hier.',
    'Deleted — only backups left': 'Gelöscht – nur noch Backups vorhanden', 'Played {0}': 'Gespielt: {0}', '1 backup': '1 Backup', '{0} backups': '{0} Backups',
    'No backups': 'Keine Backups', 'Back up': 'Sichern', 'manual': 'manuell', 'before update': 'vor Update', 'before restore': 'vor Wiederherstellung',
    'Delete backup': 'Backup löschen', 'Backup of “{0}” created.': 'Backup von „{0}“ erstellt.', 'Delete “{0}”?': '„{0}“ löschen?',
    'The world is moved to the recycle bin. Backups stay.': 'Die Welt kommt in den Papierkorb. Backups bleiben.', 'World moved to the recycle bin.': 'Welt in den Papierkorb verschoben.',
    'Close Minecraft first.': 'Schließe zuerst Minecraft.', 'Restore this backup?': 'Dieses Backup wiederherstellen?',
    'The world is brought back from this backup.': 'Die Welt wird aus diesem Backup zurückgeholt.',
    'The current state of “{0}” is backed up first, then replaced by this backup.': 'Der aktuelle Stand von „{0}“ wird zuerst gesichert und dann durch dieses Backup ersetzt.',
    'World restored.': 'Welt wiederhergestellt.', 'Delete backup?': 'Backup löschen?', 'This backup is deleted permanently.': 'Dieses Backup wird endgültig gelöscht.',
    'All worlds backed up.': 'Alle Welten gesichert.',

    // --- Screenshots ---
    'Press F2 in Minecraft to take a screenshot.': 'Drück in Minecraft F2 für einen Screenshot.', 'No screenshots yet': 'Noch keine Screenshots',
    'Press F2 in Minecraft to take one.': 'Drück in Minecraft F2, um einen zu machen.', 'Show in folder': 'Im Ordner zeigen', 'Screenshot copied.': 'Screenshot kopiert.',

    // --- Server ---
    'MULTIPLAYER': 'MEHRSPIELER', 'Live status for your servers. Join starts Minecraft and connects directly.': 'Live-Status deiner Server. Beitreten startet Minecraft und verbindet direkt.',
    'Name': 'Name', 'Address, e.g. play.example.com': 'Adresse, z. B. play.example.com', 'Add server': 'Server hinzufügen', 'OFFICIAL': 'OFFIZIELL',
    '{0} is removed from your list.': '{0} wird aus deiner Liste entfernt.',

    // --- Skins ---
    'PROFILE': 'PROFIL', 'Change your real Minecraft skin and cape. Everyone on every server sees it.': 'Ändere deinen echten Minecraft-Skin und Umhang. Jeder auf jedem Server sieht ihn.',
    'Open skin folder': 'Skin-Ordner öffnen', 'Current skin': 'Aktueller Skin', 'Idle': 'Stehen', 'Walk': 'Gehen', 'Run': 'Rennen', 'Add PNG': 'PNG hinzufügen',
    "Copy a player's skin (name)": 'Skin eines Spielers kopieren (Name)', 'Save current': 'Aktuellen speichern', 'Not signed in': 'Nicht angemeldet',
    'Sign in to change your skin.': 'Melde dich an, um deinen Skin zu ändern.', 'Preview — not applied yet': 'Vorschau – noch nicht übernommen',
    'Use this skin': 'Diesen Skin benutzen', 'Back to current': 'Zurück zum aktuellen', 'Current skin · slim arms': 'Aktueller Skin · schmale Arme',
    'Current skin · classic arms': 'Aktueller Skin · normale Arme', 'Default skin': 'Standard-Skin', 'Save to library': 'In Bibliothek speichern',
    'Reset to default': 'Auf Standard zurücksetzen', 'No cape': 'Kein Umhang', 'Skin changed. Other players see it after rejoining.': 'Skin geändert. Andere sehen ihn, sobald du neu beitrittst.',
    'Reset your skin?': 'Skin zurücksetzen?', 'Your skin goes back to a default Minecraft skin. Save it to the library first if you want to keep it.': 'Dein Skin wird zu einem Minecraft-Standardskin. Speichere ihn vorher in der Bibliothek, wenn du ihn behalten willst.',
    'Skin reset.': 'Skin zurückgesetzt.', 'Saved to your library.': 'In deiner Bibliothek gespeichert.', 'Cape changed.': 'Umhang geändert.', 'Cape hidden.': 'Umhang ausgeblendet.',
    'Your skin library is empty': 'Deine Skin-Bibliothek ist leer', 'Add a PNG skin, copy one from a player, or save your current skin.': 'Füge einen PNG-Skin hinzu, kopiere einen von einem Spieler oder speichere deinen aktuellen.',
    'Click to preview': 'Klicken für Vorschau', 'Switch arm width': 'Armbreite wechseln', 'SLIM': 'SCHMAL', 'CLASSIC': 'NORMAL',
    'The skin is removed from your library.': 'Der Skin wird aus deiner Bibliothek entfernt.', '{0} skin(s) added to your library.': '{0} Skin(s) zur Bibliothek hinzugefügt.',
    '{0} (current)': '{0} (aktuell)', '3D preview could not be loaded.': 'Die 3D-Vorschau konnte nicht geladen werden.',

    // --- Einstellungen ---
    'LAUNCHER': 'LAUNCHER', 'Changes are saved immediately.': 'Änderungen werden sofort gespeichert.', 'Game': 'Spiel', 'Memory (RAM)': 'Arbeitsspeicher (RAM)',
    'How much memory Minecraft may use. 4-6 GB is plenty for Vortex; more does not make it faster.': 'Wie viel Speicher Minecraft nutzen darf. 4–6 GB reichen für Vortex; mehr macht es nicht schneller.',
    'Window size': 'Fenstergröße', 'Size of the game window at start.': 'Größe des Spielfensters beim Start.', 'Start in fullscreen': 'Im Vollbild starten',
    'Overrides the window size.': 'Überschreibt die Fenstergröße.', 'Extra JVM arguments': 'Zusätzliche JVM-Argumente', 'For experts. Memory is set above, not here.': 'Für Profis. Der Speicher wird oben eingestellt, nicht hier.',
    'e.g. -XX:+UseZGC': 'z. B. -XX:+UseZGC', 'Java': 'Java', 'Java runtime': 'Java-Laufzeit', 'Choose java.exe': 'java.exe wählen', 'Automatic': 'Automatisch',
    'Automatic: the right Java is downloaded when needed.': 'Automatisch: Das passende Java wird bei Bedarf geladen.',
    'Automatic: the right Java is downloaded when needed (Java 25 for Minecraft 26.x, 21 for 1.20.5+).': 'Automatisch: Das passende Java wird bei Bedarf geladen (Java 25 für Minecraft 26.x, 21 für 1.20.5+).',
    'Custom: {0}': 'Eigenes: {0}', 'Java {0} selected.': 'Java {0} ausgewählt.', 'Java is chosen automatically again.': 'Java wird wieder automatisch gewählt.',
    'Vortex': 'Vortex', 'Load Vortex Plus Addon': 'Vortex Plus Addon laden',
    // --- 2.3: Import, Musik, Aussehen, Java, Screenshots ---
    'From another launcher': 'Aus anderem Launcher', 'Take over a profile from another launcher': 'Profil aus einem anderen Launcher übernehmen',
    'Modrinth App, NoRisk Client, Lunar Client, CurseForge, Prism, ATLauncher, GDLauncher or any folder. Mods are loaded in the right version for Fabric; nothing is changed in the other launcher.': 'Modrinth App, NoRisk Client, Lunar Client, CurseForge, Prism, ATLauncher, GDLauncher oder ein beliebiger Ordner. Mods werden in der passenden Version für Fabric geladen; im anderen Launcher wird nichts verändert.',
    '{0} mods': '{0} Mods', 'No other launcher found on this PC.': 'Auf diesem PC wurde kein anderer Launcher gefunden.', 'Choose a folder…': 'Ordner wählen…',
    '{0} mods do not run on Fabric -- where a Fabric version exists on Modrinth, it is used instead.': '{0}-Mods laufen nicht mit Fabric – wo es auf Modrinth eine Fabric-Fassung gibt, wird die genommen.',
    'Mods ({0})': 'Mods ({0})', 'Mod settings (config)': 'Mod-Einstellungen (config)', 'Resource packs': 'Resource Packs', 'Shaders': 'Shader', 'Servers': 'Server',
    'Game settings & key binds (replaces yours)': 'Spieleinstellungen & Tasten (ersetzt deine)', 'Into': 'Nach', 'Take over': 'Übernehmen',
    '{0} mods loaded from Modrinth in the right version': '{0} Mods in der passenden Version von Modrinth geladen', '{0} mods copied': '{0} Mods kopiert',
    '{0} files (settings, packs, shaders)': '{0} Dateien (Einstellungen, Packs, Shader)', '{0} servers added': '{0} Server hinzugefügt',
    'Game settings and key binds taken over': 'Spieleinstellungen und Tasten übernommen', 'Done -- Minecraft {0}': 'Fertig – Minecraft {0}',
    'Nothing new to take over.': 'Nichts Neues zu übernehmen.', 'Not available for Fabric {0}: {1}': 'Nicht für Fabric {0} verfügbar: {1}', 'Open mods': 'Mods öffnen',
    "NoRisk's own client mods are not copied -- Vortex replaces them.": 'Die eigenen Client-Mods von NoRisk werden nicht übernommen – Vortex ersetzt sie.',
    "Lunar's own module settings use a closed format and cannot be transferred.": 'Lunars eigene Modul-Einstellungen sind ein geschlossenes Format und lassen sich nicht übertragen.',
    'Looking up mods on Modrinth': 'Mods werden auf Modrinth gesucht', 'Installing mods ({0}/{1})': 'Mods werden installiert ({0}/{1})', 'Copying files': 'Dateien werden kopiert',
    'Search for profiles again.': 'Suche die Profile noch einmal.', 'Choose a folder.': 'Wähle einen Ordner.',
    'Appearance': 'Aussehen', 'Accent colour': 'Akzentfarbe', 'Buttons, highlights and the play button.': 'Knöpfe, Hervorhebungen und der Spielen-Knopf.',
    'Music': 'Musik', 'Source': 'Quelle', 'The Minecraft soundtrack from your downloaded game files, or your own music folder.': 'Der Minecraft-Soundtrack aus deinen heruntergeladenen Spieldateien oder dein eigener Musikordner.',
    'Own folder': 'Eigener Ordner', 'Own folder: {0}': 'Eigener Ordner: {0}', 'Choose folder': 'Ordner wählen', 'Shuffle': 'Zufällig', 'Random order.': 'Zufällige Reihenfolge.',
    'Play when the launcher opens': 'Beim Öffnen des Launchers abspielen', 'Starts the music automatically.': 'Startet die Musik automatisch.',
    'Pause while Minecraft runs': 'Pausieren, solange Minecraft läuft', 'Continues when you close the game.': 'Geht weiter, wenn du das Spiel schließt.',
    'Minecraft soundtrack': 'Minecraft-Soundtrack', 'Play music': 'Musik abspielen', 'Next track': 'Nächster Titel', 'Volume': 'Lautstärke', 'Pause': 'Pause',
    'No music found in your folder.': 'In deinem Ordner wurde keine Musik gefunden.',
    'No Minecraft music found yet -- start a version once, then the soundtrack is on your PC.': 'Noch keine Minecraft-Musik gefunden – starte einmal eine Version, dann ist der Soundtrack auf deinem PC.',
    'This track cannot be played.': 'Dieser Titel lässt sich nicht abspielen.',
    'Java preset': 'Java-Voreinstellung', 'How Java manages memory. "Smooth" reduces short lags.': 'Wie Java den Speicher verwaltet. „Flüssig“ verringert kurze Ruckler.',
    'Smooth': 'Flüssig', 'Low RAM': 'Wenig RAM', 'Standard': 'Standard', 'Custom': 'Eigene', 'Applies from the next start.': 'Gilt ab dem nächsten Start.',
    'Copy new screenshots automatically': 'Neue Screenshots automatisch kopieren',
    'Press F2 in Minecraft, then Ctrl+V in Discord — the picture is already in your clipboard.': 'In Minecraft F2 drücken, dann in Discord Strg+V – das Bild ist schon in der Zwischenablage.',
    'Copy for Discord': 'Für Discord kopieren', 'Copied -- paste it in Discord with Ctrl+V.': 'Kopiert – in Discord mit Strg+V einfügen.',
    'Screenshot copied -- paste it in Discord with Ctrl+V.': 'Screenshot kopiert – in Discord mit Strg+V einfügen.',
    // --- 2.2: Spielzeit, Leistung, Absturzberichte, Einladungen, Mod-Pruefung ---
    '< 1 min': '< 1 Min.', '{0} h {1} min': '{0} Std. {1} Min.', '{0} min': '{0} Min.', 'PLAYTIME': 'SPIELZEIT',
    '{0} sessions · longest {1}': '{0} Sitzungen · längste {1}',
    'Performance check': 'Leistungs-Check', 'Check again': 'Erneut prüfen', 'in use': 'aktiv', 'MEMORY': 'ARBEITSSPEICHER',
    '{0} GB for Minecraft': '{0} GB für Minecraft', '{0} threads': '{0} Threads', 'GRAPHICS': 'GRAFIK', 'LAST ROUND': 'LETZTE RUNDE',
    'worst 1 %: {0} FPS · {1} min': 'schlechteste 1 %: {0} FPS · {1} Min.', 'Play a round with Vortex 4.7.1+': 'Spiel eine Runde mit Vortex 4.7.1+',
    'all versions': 'alle Versionen', 'Memory set to {0} MB.': 'Arbeitsspeicher auf {0} MB gestellt.',
    '{0} performance mod(s) installed.': '{0} Leistungs-Mod(s) installiert.', 'Render distance set to {0}.': 'Sichtweite auf {0} gestellt.',
    'Minecraft gets {0} MB of {1} MB. Windows needs some too -- {2} MB is enough.': 'Minecraft bekommt {0} MB von {1} MB. Windows braucht auch etwas – {2} MB reichen.',
    'Only {0} MB for Minecraft. With mods {1} MB runs smoother.': 'Nur {0} MB für Minecraft. Mit Mods läuft es mit {1} MB flüssiger.',
    'Set to {0} MB': 'Auf {0} MB stellen',
    'Sodium, Lithium and EntityCulling are missing -- they often double the FPS.': 'Sodium, Lithium und EntityCulling fehlen – sie verdoppeln oft die FPS.',
    'Install performance mods': 'Leistungs-Mods installieren',
    'Last round: {0} FPS on average, {1} in the worst moments. A render distance of {2} instead of {3} helps the most.': 'Letzte Runde: im Schnitt {0} FPS, {1} in den schlechtesten Momenten. Sichtweite {2} statt {3} bringt am meisten.',
    'Render distance {0}': 'Sichtweite {0}',
    'Your PC has a {0}, but the {1} is in use. In Windows: Settings > System > Display > Graphics > add javaw.exe > "High performance".': 'Dein PC hat eine {0}, benutzt wird aber die {1}. In Windows: Einstellungen > System > Anzeige > Grafik > javaw.exe hinzufügen > „Hohe Leistung“.',
    'Everything looks good.': 'Alles in Ordnung.',
    'Close Minecraft first -- it overwrites the setting when it quits.': 'Schließe zuerst Minecraft – es überschreibt die Einstellung beim Beenden.',
    'Anonymous: versions, mods and the crash report excerpt -- no name, no IP.': 'Anonym: Versionen, Mods und ein Ausschnitt aus dem Crash-Report – kein Name, keine IP.',
    'Report sent': 'Bericht gesendet', 'Send report to Vortex': 'Bericht an Vortex senden', 'Thanks! The report was sent.': 'Danke! Der Bericht wurde gesendet.',
    'Send crash reports automatically': 'Absturzberichte automatisch senden',
    'Anonymous: versions, mods and the crash report excerpt — no name, no IP. Helps to fix bugs faster.': 'Anonym: Versionen, Mods und ein Ausschnitt aus dem Crash-Report – kein Name, keine IP. So werden Fehler schneller behoben.',
    'Crash reports are not set up in this launcher.': 'Absturzberichte sind in diesem Launcher nicht eingerichtet.',
    'There is no crash to report.': 'Es gibt keinen Absturz zum Melden.', 'The report could not be sent ({0}).': 'Der Bericht konnte nicht gesendet werden ({0}).',
    'Play': 'Spielen', 'Copy invite link': 'Einladungslink kopieren', 'Invite link copied — paste it in Discord.': 'Einladungslink kopiert – füge ihn in Discord ein.',
    'Join {0}?': '{0} beitreten?', 'Minecraft {0} starts and connects to the server right away.': 'Minecraft {0} startet und verbindet sich direkt mit dem Server.',
    'Checking your mods': 'Mods werden geprüft', 'Missing mods installed: {0}': 'Fehlende Mods installiert: {0}',
    'Installed twice, older copy disabled: {0}': 'Doppelt installiert, ältere Kopie ausgeschaltet: {0}',
    '{0} needs "{1}", which could not be found on Modrinth.': '{0} braucht „{1}“, das auf Modrinth nicht zu finden ist.',
    '{0} does not work together with {1}. Disable one of them.': '{0} verträgt sich nicht mit {1}. Schalte eine davon aus.',
    '{0} is installed twice. Remove one of them.': '{0} ist doppelt installiert. Entferne eine davon.',
    'Beta updates': 'Beta-Updates',
    'Get new Vortex Client and addon builds before everyone else, to test them. Switch off to go back to the released version.': 'Neue Builds von Vortex Client und Addon vor allen anderen bekommen, um sie zu testen. Ausschalten = zurück zur freigegebenen Version.',
    'Beta updates on — new builds are downloaded now.': 'Beta-Updates an – neue Builds werden jetzt geladen.',
    'Beta updates off — back to the released version.': 'Beta-Updates aus – zurück zur freigegebenen Version.',
    'Beta test': 'Beta-Test', 'Only open': 'Nur offene', 'Release beta to everyone': 'Beta für alle freigeben',
    'Check every item and resolve open bug reports first.': 'Erst alle Punkte abhaken und offene Fehlerberichte erledigen.',
    'All new features of beta builds that are not released yet — also from older beta builds. Check an item once it works in game (also possible in game: right shift → Beta test). If something is broken, report a bug: it is sent to GitHub, where it can be fixed.':
      'Alle Neuerungen der Beta-Builds, die noch nicht freigegeben sind – auch aus älteren Beta-Builds. Hake einen Punkt ab, sobald er im Spiel funktioniert (geht auch im Spiel: Rechts-Shift → Beta-Test). Klappt etwas nicht, melde den Fehler: er geht an GitHub und kann dort behoben werden.',
    '{0} open bug report(s) — the beta cannot be released yet.': '{0} offene(r) Fehlerbericht(e) – die Beta kann noch nicht freigegeben werden.',
    'Bug reports are sent as soon as you are signed in with your GitHub token.': 'Fehlerberichte werden gesendet, sobald du mit deinem GitHub-Token angemeldet bist.',
    'Everything is checked.': 'Alles abgehakt.', 'No unreleased beta features — nothing to test.': 'Keine unveröffentlichten Beta-Neuerungen – nichts zu testen.',
    'Report a bug': 'Fehler melden', 'Bug': 'Fehler', 'Fixed': 'Behoben', 'Sent': 'Gesendet', 'Not sent': 'Nicht gesendet', 'Waiting': 'Wartet',
    'Mark fixed': 'Als behoben markieren', 'What happens? What did you expect? How can it be reproduced?': 'Was passiert? Was hättest du erwartet? Wie lässt es sich nachstellen?',
    'Attach error lines from the game log (IP addresses are hidden)': 'Fehlerzeilen aus dem Spiel-Log anhängen (IP-Adressen werden ausgeblendet)',
    'The report is public on GitHub (the launcher repository is public).': 'Der Bericht ist auf GitHub öffentlich sichtbar (das Launcher-Repo ist öffentlich).',
    'Send report': 'Bericht senden', 'Bug report is being sent.': 'Fehlerbericht wird gesendet.',
    'Bug report saved — it is sent once you are signed in.': 'Fehlerbericht gespeichert – er wird gesendet, sobald du angemeldet bist.',
    'Nothing to release — the beta is not newer than the released version.': 'Nichts freizugeben – die Beta ist nicht neuer als die freigegebene Version.',
    'Release the beta to everyone?': 'Beta für alle freigeben?', 'Describe the problem first.': 'Beschreibe zuerst das Problem.',
    'The beta checklist is not complete yet: check every item and resolve open bug reports first.': 'Die Beta-Checkliste ist noch nicht fertig: erst alle Punkte abhaken und offene Fehlerberichte erledigen.',
    'BETA': 'BETA', 'Release to everyone': 'Für alle freigeben', 'Release {0} {1} to everyone?': '{0} {1} für alle freigeben?',
    'All players get this version at their next start.': 'Alle Spieler bekommen diese Version beim nächsten Start.',
    'Release': 'Freigeben', 'Released to everyone.': 'Für alle freigegeben.',
    'What’s new in Vortex': 'Neu in Vortex', 'Got it': 'Alles klar', 'No notes for this update.': 'Zu diesem Update gibt es keine Notizen.',
    'Adds the addon modules (bots, cheats) to Vortex versions. Many servers forbid such modules — using them can get you banned.': 'Fügt die Addon-Module (Bots, Cheats) zu Vortex-Versionen hinzu. Viele Server verbieten solche Module – du kannst dafür gebannt werden.',
    'Vortex updates': 'Vortex-Updates', 'New Vortex Client and addon versions are downloaded automatically.': 'Neue Versionen von Vortex Client und Addon werden automatisch geladen.',
    'Check now': 'Jetzt prüfen', 'Vortex is up to date.': 'Vortex ist aktuell.', 'The Vortex update server could not be reached.': 'Der Vortex-Update-Server ist nicht erreichbar.',
    'Mods & worlds': 'Mods & Welten', 'Update mods automatically': 'Mods automatisch aktualisieren', 'Installs Modrinth updates for your mods every time you press Play.': 'Spielt bei jedem Spielstart Modrinth-Updates für deine Mods ein.',
    'Back up worlds before updates': 'Welten vor Updates sichern',
    'When Vortex or your mods changed since the last start, your worlds are copied first. The last 5 automatic backups per world are kept.': 'Wenn sich Vortex oder deine Mods seit dem letzten Start geändert haben, werden deine Welten vorher kopiert. Die letzten 5 automatischen Backups pro Welt bleiben erhalten.',
    'Launcher': 'Launcher', 'Language': 'Sprache', 'Language of the launcher.': 'Sprache des Launchers.', 'Deutsch': 'Deutsch', 'English': 'English',
    'When Minecraft starts': 'Wenn Minecraft startet', 'What the launcher does while you play. It comes back when the game closes.': 'Was der Launcher macht, während du spielst. Er kommt zurück, wenn das Spiel schließt.',
    'Stay open': 'Offen bleiben', 'Hide': 'Verstecken', 'Show in Discord': 'In Discord anzeigen', 'Shows "Playing Vortex Client" in your Discord status.': 'Zeigt „Spielt Vortex Client“ in deinem Discord-Status.',
    'Not set up in this launcher build (the owner adds a Discord application ID).': 'In diesem Launcher-Build nicht eingerichtet (der Besitzer trägt eine Discord-Application-ID ein).',
    'Open the crash analysis after a crash': 'Nach einem Absturz die Analyse öffnen', 'Explains what went wrong right away.': 'Erklärt sofort, was schiefging.',
    'Files': 'Dateien', 'Launcher data': 'Launcher-Daten', 'Data folder': 'Datenordner', 'Launch log': 'Start-Log', 'Updates': 'Updates',
    'Vortex Client Launcher': 'Vortex Client Launcher', 'Vortex website': 'Vortex-Website', 'Community presets, accounts and news.': 'Community-Presets, Konten und News.',
    'Open website': 'Website öffnen', 'Vortex Plus Addon is loaded from the next start.': 'Das Vortex Plus Addon wird ab dem nächsten Start geladen.',
    'Vortex Plus Addon switched off.': 'Vortex Plus Addon ausgeschaltet.', 'Updates are checked automatically.': 'Updates werden automatisch geprüft.',
    'Checking for updates…': 'Suche nach Updates…', 'You are on the latest version.': 'Du hast die neueste Version.', 'Check again': 'Nochmal prüfen',
    'Version {0} is available.': 'Version {0} ist verfügbar.', 'Download update': 'Update laden', 'Downloading version {0}… {1}%': 'Lade Version {0}… {1} %',
    'Downloading…': 'Lädt…', 'Version {0} is ready. The launcher restarts to install it.': 'Version {0} ist bereit. Der Launcher startet zum Installieren neu.',
    'Restart & install': 'Neu starten & installieren', 'No update information found right now.': 'Gerade keine Update-Infos gefunden.', 'Try again': 'Nochmal versuchen',
    'Development start: updates are only checked in the installed app.': 'Entwicklungsstart: Updates werden nur in der installierten App geprüft.',
    'Console copied to the clipboard.': 'Konsole in die Zwischenablage kopiert.', 'All': 'Alle', 'Errors': 'Fehler', 'Open log file': 'Log-Datei öffnen',

    // --- Admin ---
    'OWNER': 'BESITZER', 'Publish new Vortex Client and addon versions. Every launcher downloads them automatically — no new launcher build needed.': 'Veröffentliche neue Versionen von Vortex Client und Addon. Jeder Launcher lädt sie automatisch – ohne neuen Launcher-Build.',
    'Sign in with your GitHub token': 'Mit deinem GitHub-Token anmelden',
    'Uploads are stored as a release in {0}. Only someone with write access to this repository can publish.': 'Uploads landen als Release in {0}. Nur wer Schreibrechte auf dieses Repo hat, kann veröffentlichen.',
    'Open <b>GitHub → Settings → Developer settings → Fine-grained tokens</b>.': 'Öffne <b>GitHub → Settings → Developer settings → Fine-grained tokens</b>.',
    'Repository access: only <code>{0}</code>. Permission: <b>Contents → Read and write</b>.': 'Repository access: nur <code>{0}</code>. Berechtigung: <b>Contents → Read and write</b>.',
    'Repository access: only <code>{0}</code>. Permissions: <b>Contents → Read and write</b> and <b>Issues → Read and write</b> (for beta bug reports).': 'Repository access: nur <code>{0}</code>. Berechtigungen: <b>Contents → Read and write</b> und <b>Issues → Read and write</b> (für Beta-Fehlerberichte).',
    'Copy the token and paste it here. It is stored encrypted on this PC only.': 'Token kopieren und hier einfügen. Er wird nur auf diesem PC verschlüsselt gespeichert.',
    'Create token': 'Token erstellen', 'Signed in to GitHub.': 'Bei GitHub angemeldet.',
    'Signed in as <b>{0}</b> · can publish to <code>{1}</code>': 'Angemeldet als <b>{0}</b> · darf nach <code>{1}</code> veröffentlichen',
    'This token cannot write to the repository.': 'Dieser Token darf nicht in das Repo schreiben.', 'The repository is private — players cannot download!': 'Das Repo ist privat – Spieler können nichts laden!',
    'Publish new files': 'Neue Dateien veröffentlichen', 'Drop Vortex jars here': 'Vortex-Jars hier ablegen',
    'Client, addon or Fabric API — the launcher reads the mod ID and version from the jar.': 'Client, Addon oder Fabric API – der Launcher liest Mod-ID und Version aus der Jar.',
    'Choose files': 'Dateien wählen', 'FILE': 'DATEI', 'IN LAUNCHER': 'IM LAUNCHER', 'ONLINE': 'ONLINE', 'UPLOADED': 'HOCHGELADEN', 'Remove online': 'Online entfernen',
    'News for all players': 'News für alle Spieler', 'Title, e.g. Vortex 4.7 is out!': 'Titel, z. B. Vortex 4.7 ist da!', 'Text (one point per line)': 'Text (ein Punkt pro Zeile)',
    'Publish news': 'News veröffentlichen', 'News published.': 'News veröffentlicht.', 'Sign out of GitHub?': 'Von GitHub abmelden?', 'The token is removed from this PC.': 'Der Token wird von diesem PC gelöscht.',
    'Remove the online file?': 'Online-Datei entfernen?', 'Players fall back to the version included in the launcher (if there is one).': 'Spieler nutzen dann wieder die Version aus dem Launcher (falls es eine gibt).',
    'needs Minecraft {0}': 'braucht Minecraft {0}', 'Publish': 'Veröffentlichen',
    '{0} {1} is now live for Minecraft {2}. All launchers download it within 30 minutes or at the next Play.': '{0} {1} ist jetzt für Minecraft {2} live. Alle Launcher laden es innerhalb von 30 Minuten oder beim nächsten Spielstart.',
    'Drop jars to publish': 'Jars zum Veröffentlichen ablegen', 'They are checked before anything is uploaded.': 'Sie werden geprüft, bevor etwas hochgeladen wird.',
    'Drop skins to add them': 'Skins zum Hinzufügen ablegen', '64×64 PNG skins': '64×64-PNG-Skins', 'Drop to add': 'Zum Hinzufügen ablegen',
    '.jar → mods of the selected instance · .mrpack → import modpack · .png → skin library': '.jar → Mods der gewählten Instanz · .mrpack → Modpack importieren · .png → Skin-Bibliothek',

    // --- Meldungen aus dem Hauptprozess ---
    'Sign-in was cancelled.': 'Anmeldung abgebrochen.', 'This Microsoft account has no Xbox profile. Sign in once on minecraft.net first.': 'Dieses Microsoft-Konto hat kein Xbox-Profil. Melde dich einmal auf minecraft.net an.',
    'This Microsoft account does not own Minecraft: Java Edition.': 'Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht.',
    'No connection to the internet (or the service is down).': 'Keine Internetverbindung (oder der Dienst ist gerade down).',
    'A launch is already in progress.': 'Es wird schon etwas gestartet.', 'Sign in with your Microsoft account first.': 'Melde dich zuerst mit deinem Microsoft-Konto an.',
    '{0} is already playing. Switch to another account to play in parallel.': '{0} spielt schon. Wechsle das Konto, um parallel zu spielen.',
    'Sign in again to play.': 'Melde dich neu an, um zu spielen.', 'Checking your account': 'Konto wird geprüft', 'Checking for Vortex updates': 'Suche nach Vortex-Updates',
    'Preparing Minecraft {0}': 'Minecraft {0} wird vorbereitet', 'Installing Fabric API': 'Fabric API wird installiert', 'Updating mods': 'Mods werden aktualisiert',
    'Backing up your worlds': 'Welten werden gesichert', 'Checking Java': 'Java wird geprüft', 'Checking game files': 'Spieldateien werden geprüft',
    'Downloading Minecraft': 'Minecraft wird geladen', 'Downloading assets': 'Assets werden geladen', 'Preparing natives': 'Natives werden vorbereitet',
    'Downloading libraries': 'Bibliotheken werden geladen', 'Copying assets': 'Assets werden kopiert', 'Downloading files': 'Dateien werden geladen',
    'Minecraft is running': 'Minecraft läuft', 'Minecraft is starting': 'Minecraft startet', 'Joining {0}': 'Trete {0} bei', 'Starting Minecraft…': 'Minecraft startet…',
    'Minecraft {0} is starting.': 'Minecraft {0} startet.', 'Minecraft {0} is starting and joins {1}.': 'Minecraft {0} startet und tritt {1} bei.',
    'Minecraft could not be started. Open the console for details.': 'Minecraft konnte nicht gestartet werden. Details stehen in der Konsole.',
    '{0} {1} for Minecraft {2} downloaded.': '{0} {1} für Minecraft {2} geladen.', '{0} mod(s) updated.': '{0} Mod(s) aktualisiert.',
    'Minecraft {0} checked: Fabric {1}, {2} file(s) updated.': 'Minecraft {0} geprüft: Fabric {1}, {2} Datei(en) aktualisiert.',
    'Unknown Minecraft version "{0}".': 'Unbekannte Minecraft-Version „{0}“.', 'Enter a release version such as 1.21.4 or 26.2.': 'Gib eine Release-Version ein, z. B. 1.21.4 oder 26.2.',
    'Fabric could not be reached to check this version. Check your internet connection and try again.': 'Fabric ist nicht erreichbar, um die Version zu prüfen. Prüfe deine Internetverbindung und versuch es nochmal.',
    'Fabric does not support Minecraft {0} (yet).': 'Fabric unterstützt Minecraft {0} (noch) nicht.', 'Vortex versions cannot be removed from the list.': 'Vortex-Versionen können nicht entfernt werden.',
    'Fabric for Minecraft {0} could not be prepared: {1}. Check your internet connection.': 'Fabric für Minecraft {0} konnte nicht vorbereitet werden: {1}. Prüfe deine Internetverbindung.',
    'The Vortex Plus Addon is switched on and off in Settings.': 'Das Vortex Plus Addon wird in den Einstellungen ein- und ausgeschaltet.',
    'This file belongs to Vortex and is managed by the launcher.': 'Diese Datei gehört zu Vortex und wird vom Launcher verwaltet.', 'The file no longer exists.': 'Die Datei existiert nicht mehr.',
    'Invalid file name.': 'Ungültiger Dateiname.', 'Modrinth answered {0}.': 'Modrinth antwortete mit {0}.', 'No Fabric build of this mod exists for Minecraft {0}.': 'Diese Mod gibt es nicht für Fabric mit Minecraft {0}.',
    'Nothing could be installed.': 'Nichts konnte installiert werden.', 'None of these mods exist for Minecraft {0} yet.': 'Keine dieser Mods gibt es schon für Minecraft {0}.',
    'No build of this pack exists for Minecraft {0}.': 'Dieses Pack gibt es nicht für Minecraft {0}.', 'No build of this shader exists for Minecraft {0}.': 'Diesen Shader gibt es nicht für Minecraft {0}.',
    'The file name is not safe.': 'Der Dateiname ist nicht sicher.', 'The file is too large.': 'Die Datei ist zu groß.', 'Checksum mismatch -- file rejected.': 'Prüfsumme falsch – Datei abgelehnt.',
    'Give the server a name.': 'Gib dem Server einen Namen.', 'That is not a valid server address.': 'Das ist keine gültige Serveradresse.',
    'This server is already in your list.': 'Dieser Server ist schon in deiner Liste.', 'The official Vortex server cannot be removed.': 'Der offizielle Vortex-Server kann nicht entfernt werden.',
    'No working Java found at this path.': 'An diesem Ort gibt es kein funktionierendes Java.', 'That is not a working Java.': 'Das ist kein funktionierendes Java.',
    'Minecraft needs Java {0}. Install it, or set the Java path in Settings.': 'Minecraft braucht Java {0}. Installiere es oder stell den Java-Pfad in den Einstellungen ein.',
    'Downloading Java {0} runtime (Eclipse Temurin) ...': 'Java {0} (Eclipse Temurin) wird geladen …',
    'Only https links can be opened.': 'Nur https-Links können geöffnet werden.', 'Unknown folder.': 'Unbekannter Ordner.',
    'Your session expired. Sign in again.': 'Deine Sitzung ist abgelaufen. Melde dich neu an.', 'Sign in again to change your skin.': 'Melde dich neu an, um deinen Skin zu ändern.',
    'Too many skin changes -- wait a minute and try again.': 'Zu viele Skin-Wechsel – warte eine Minute und versuch es nochmal.',
    'That is not a valid PNG image.': 'Das ist kein gültiges PNG-Bild.', 'A Minecraft skin must be 64×64 (or 64×32) pixels -- this one is {0}×{1}.': 'Ein Minecraft-Skin muss 64×64 (oder 64×32) Pixel groß sein – dieser ist {0}×{1}.',
    'Choose a .png skin file.': 'Wähle eine .png-Skin-Datei.', 'That is not a valid Minecraft name.': 'Das ist kein gültiger Minecraft-Name.',
    'There is no player called {0}.': 'Es gibt keinen Spieler namens {0}.', '{0} uses the default skin.': '{0} nutzt den Standard-Skin.',
    'The skin could not be loaded.': 'Der Skin konnte nicht geladen werden.', 'You are using a default skin.': 'Du nutzt einen Standard-Skin.', 'Skin not found.': 'Skin nicht gefunden.',
    'Mojang answered {0}.': 'Mojang antwortete mit {0}.', 'Minecraft services answered {0}.': 'Die Minecraft-Dienste antworteten mit {0}.',
    'Invalid world.': 'Ungültige Welt.', 'This world no longer exists.': 'Diese Welt existiert nicht mehr.', 'Invalid backup.': 'Ungültiges Backup.',
    'This backup no longer exists.': 'Dieses Backup existiert nicht mehr.', 'Close Minecraft first -- the world is open.': 'Schließe zuerst Minecraft – die Welt ist offen.',
    'The screenshot no longer exists.': 'Der Screenshot existiert nicht mehr.', 'Invalid file.': 'Ungültige Datei.',
    'Choose a .mrpack file.': 'Wähle eine .mrpack-Datei.', 'This is not a Modrinth modpack (.mrpack).': 'Das ist kein Modrinth-Modpack (.mrpack).',
    'The modpack index is broken.': 'Die Modpack-Datei ist beschädigt.', 'This modpack is not for Minecraft: Java Edition.': 'Dieses Modpack ist nicht für Minecraft: Java Edition.',
    'This modpack uses {0}. Only Fabric modpacks are supported.': 'Dieses Modpack nutzt {0}. Nur Fabric-Modpacks werden unterstützt.',
    'The pack would be larger than 1 GB. Leave out resource packs or shaders.': 'Das Pack wäre größer als 1 GB. Lass Resource Packs oder Shader weg.',
    'This is not a valid ZIP/JAR file.': 'Das ist keine gültige ZIP/JAR-Datei.',
    'Sign in with your GitHub token first.': 'Melde dich zuerst mit deinem GitHub-Token an.', 'The GitHub token is invalid or expired.': 'Der GitHub-Token ist ungültig oder abgelaufen.',
    'The GitHub token has no write access to the launcher repository (Contents: Read and write).': 'Der GitHub-Token hat keine Schreibrechte auf das Launcher-Repo (Contents: Read and write).',
    'GitHub: {0}': 'GitHub: {0}', 'That does not look like a GitHub token (ghp_… or github_pat_…).': 'Das sieht nicht nach einem GitHub-Token aus (ghp_… oder github_pat_…).',
    'This token cannot write to {0}. Give it "Contents: Read and write" for this repository.': 'Dieser Token darf nicht in {0} schreiben. Gib ihm „Contents: Read and write“ für dieses Repo.',
    'Windows encryption is not available -- the token cannot be stored safely.': 'Die Windows-Verschlüsselung ist nicht verfügbar – der Token kann nicht sicher gespeichert werden.',
    'Choose a .jar file.': 'Wähle eine .jar-Datei.', 'This jar has no fabric.mod.json -- it is not a Fabric mod.': 'Diese Jar hat keine fabric.mod.json – sie ist keine Fabric-Mod.',
    'Choose a valid Minecraft version (e.g. 26.2).': 'Wähle eine gültige Minecraft-Version (z. B. 26.2).',
    'Rename the jar: only letters, digits and . _ + - are allowed.': 'Benenne die Jar um: nur Buchstaben, Ziffern und . _ + - sind erlaubt.',
    'A file named {0} is already used for Minecraft {1}. Rename the jar.': 'Eine Datei namens {0} wird schon für Minecraft {1} benutzt. Benenne die Jar um.',
    'Give the news a title.': 'Gib der News einen Titel.',
    'Vortex Client Launcher {0} started.': 'Vortex Client Launcher {0} gestartet.', 'Minecraft {0} ({1}) closed.': 'Minecraft {0} ({1}) beendet.',
    'Minecraft {0} ({1}) was stopped from the launcher.': 'Minecraft {0} ({1}) wurde vom Launcher gestoppt.',

    // --- Absturz-Analyse ---
    '{0} does not work with this setup': '{0} funktioniert mit dieser Zusammenstellung nicht', 'Disable {0}': '{0} ausschalten',
    '{0} is the wrong version': '{0} hat die falsche Version', 'Needed: {0}.': 'Benötigt: {0}.',
    'Needed: {0}. This file comes with Vortex -- the Vortex team has to publish a matching version. Restart the launcher to fetch it.': 'Benötigt: {0}. Diese Datei kommt mit Vortex – das Vortex-Team muss eine passende Version veröffentlichen. Starte den Launcher neu, um sie zu holen.',
    'Check mod updates': 'Mod-Updates prüfen', '{0} is missing': '{0} fehlt', 'Install {0} from Modrinth': '{0} von Modrinth installieren', 'Install {0}': '{0} installieren',
    '{0} needs {1}': '{0} braucht {1}', '{0} and {1} do not work together': '{0} und {1} vertragen sich nicht', '{0} is not made for Minecraft {1}': '{0} ist nicht für Minecraft {1} gemacht',
    'Some mods do not fit together': 'Einige Mods passen nicht zusammen', 'Fabric refused to start because of incompatible or missing mods. Details are in the console.': 'Fabric startet wegen unpassender oder fehlender Mods nicht. Details stehen in der Konsole.',
    'Open mods': 'Mods öffnen', '{0} is installed twice': '{0} ist doppelt installiert', 'Two files contain the same mod. Remove the older one.': 'Zwei Dateien enthalten dieselbe Mod. Entferne die ältere.',
    'Fabric API is missing': 'Fabric API fehlt', 'A mod needs the Fabric API, but it is not installed or disabled.': 'Eine Mod braucht die Fabric API, aber sie fehlt oder ist aus.',
    'Install Fabric API': 'Fabric API installieren', 'The Vortex Client could not load': 'Der Vortex Client konnte nicht laden',
    'Usually another mod changes the same part of the game (often rendering mods). Disable recently added mods and try again. If it keeps happening, send the crash report to the Vortex team.': 'Meist verändert eine andere Mod denselben Teil des Spiels (oft Grafik-Mods). Schalte zuletzt hinzugefügte Mods aus und versuch es nochmal. Wenn es bleibt, schick den Crash-Report ans Vortex-Team.',
    '{0} crashed while loading': '{0} ist beim Laden abgestürzt', 'This mod is probably not compatible with this Minecraft version or with another mod.': 'Diese Mod passt vermutlich nicht zu dieser Minecraft-Version oder zu einer anderen Mod.',
    'Minecraft ran out of memory': 'Minecraft hatte zu wenig Arbeitsspeicher', 'Give Minecraft more RAM in the settings (4-6 GB is a good value). Very large resource packs or shaders need more.': 'Gib Minecraft in den Einstellungen mehr RAM (4–6 GB sind gut). Sehr große Resource Packs oder Shader brauchen mehr.',
    'Add 1 GB RAM': '1 GB RAM mehr', 'Too much RAM is set': 'Zu viel RAM eingestellt', 'Windows could not give Minecraft that much memory. Lower the RAM in the settings or close other programs.': 'Windows konnte Minecraft nicht so viel Speicher geben. Stell weniger RAM ein oder schließe andere Programme.',
    'Use 1 GB less': '1 GB weniger', 'Java {0} is needed': 'Java {0} wird benötigt', 'Java is needed': 'Ein neueres Java wird benötigt',
    'The Java version used is too old for this Minecraft version or a mod.': 'Das benutzte Java ist zu alt für diese Minecraft-Version oder eine Mod.', 'Choose Java automatically': 'Java automatisch wählen',
    'Graphics driver problem': 'Problem mit dem Grafiktreiber',
    "Update your {0} graphics driver from the manufacturer's website. On laptops, make sure Java uses the dedicated graphics card.": 'Aktualisiere deinen {0}-Grafiktreiber von der Herstellerseite. Stell bei Laptops sicher, dass Java die dedizierte Grafikkarte nutzt.',
    "Update your graphics driver from the manufacturer's website. On laptops, make sure Java uses the dedicated graphics card.": 'Aktualisiere deinen Grafiktreiber von der Herstellerseite. Stell bei Laptops sicher, dass Java die dedizierte Grafikkarte nutzt.',
    'Minecraft was closed by a native crash': 'Minecraft wurde durch einen nativen Absturz beendet',
    'Often caused by graphics drivers or overlays (Discord, MSI Afterburner, RivaTuner, OBS hooks). Update your graphics driver and turn overlays off.': 'Oft durch Grafiktreiber oder Overlays verursacht (Discord, MSI Afterburner, RivaTuner, OBS). Aktualisiere den Grafiktreiber und schalte Overlays aus.',
    'A mod is not made for this version': 'Eine Mod ist nicht für diese Version gemacht', '{0}: {1}. Update your mods or disable the ones you added recently.': '{0}: {1}. Aktualisiere deine Mods oder schalte die zuletzt hinzugefügten aus.',
    'No known cause found': 'Keine bekannte Ursache gefunden', 'Minecraft says: "{0}"{1}': 'Minecraft meldet: „{0}“{1}',
    'New update': 'Neues Update', 'Update now': 'Jetzt aktualisieren', 'Updating…': 'Wird aktualisiert…', 'Restarting…': 'Startet neu…',
    'Download': 'Herunterladen', 'Open download page': 'Download-Seite öffnen', 'New launcher update: version {0}.': 'Neues Launcher-Update: Version {0}.',
    'Version {0} is available. The portable version is updated by downloading it again.': 'Version {0} ist verfügbar. Die Portable-Version wird aktualisiert, indem du sie neu herunterlädst.',
    'The download failed. Try again.': 'Der Download ist fehlgeschlagen. Versuch es nochmal.', 'No update information found.': 'Keine Update-Infos gefunden.',
    'Updates are only checked in the built app.': 'Updates werden nur in der gebauten App geprüft.',
    '{0} or later': '{0} oder neuer', 'any version': 'beliebige Version',
    'Check the console and crash report. If you added mods recently, disable them and try again.': 'Schau in die Konsole und den Crash-Report. Wenn du kürzlich Mods hinzugefügt hast, schalte sie aus und versuch es nochmal.',
    // --- Freunde ---
    'Friends': 'Freunde', 'SOCIAL': 'SOZIAL', 'Chat, see where your friends play and join them with one click.': 'Chatte, sieh, wo deine Freunde spielen, und spring mit einem Klick dazu.',
    'Privacy & notifications': 'Privatsphäre & Benachrichtigungen', 'Add a friend by Minecraft name': 'Freund per Minecraft-Name hinzufügen', 'Send friend request': 'Freundschaftsanfrage senden',
    'Chats': 'Chats', 'Requests': 'Anfragen', 'Blocked': 'Blockiert', 'Search': 'Suchen', 'Accept': 'Annehmen', 'Add': 'Hinzufügen',
    'Add to favorites': 'Zu Favoriten', 'Remove from favorites': 'Aus Favoriten entfernen', 'Add to {0}': 'Zu {0} hinzufügen', 'All friends': 'Alle Freunde',
    'All your friends are already in it.': 'Alle deine Freunde sind schon drin.', 'Answered': 'Beantwortet', 'As a small popup in the corner (Vortex Client).': 'Als kleines Fenster in der Ecke (Vortex Client).',
    'Ask if you can join': 'Fragen, ob du mitspielen darfst', 'Ask to join': 'Mitspielen fragen', 'Asked {0}. They get a notification.': '{0} gefragt. Er bekommt eine Benachrichtigung.',
    'Away': 'Abwesend', 'Block': 'Blockieren', 'Block a player by name': 'Spieler per Name blockieren', 'Block {0}?': '{0} blockieren?',
    'Blocked players cannot send you requests, messages or invites and do not see when you are online.': 'Blockierte Spieler können dir keine Anfragen, Nachrichten oder Einladungen schicken und sehen nicht, wann du online bist.',
    'Blocked {0}': 'Blockiert {0}', 'Chat, invite them to your server or join the server they are on.': 'Chatte, lade ihn auf deinen Server ein oder spring auf seinen Server.',
    'Connecting…': 'Verbinde…', 'Conversation not found.': 'Chat nicht gefunden.', 'Copied.': 'Kopiert.', 'Copy name': 'Name kopieren', 'Create group': 'Gruppe erstellen',
    'Decline': 'Ablehnen', 'Delete message?': 'Nachricht löschen?', 'Direct messages': 'Direktnachrichten', 'Do not disturb': 'Nicht stören', 'Done': 'Fertig',
    'Edit': 'Bearbeiten', 'Edit message': 'Nachricht bearbeiten', 'Enter a Minecraft name.': 'Gib einen Minecraft-Namen ein.', 'Enter a name.': 'Gib einen Namen ein.',
    'Enter a server address.': 'Gib eine Serveradresse ein.', 'Everyone': 'Jeder', 'Everyone else only sees “Playing Minecraft”.': 'Alle anderen sehen nur „Spielt Minecraft“.',
    'Everyone else sees you as offline.': 'Alle anderen sehen dich offline.', 'Expired': 'Abgelaufen', 'Friend comes online': 'Freund kommt online',
    'Friend goes offline': 'Freund geht offline', 'Friend joins a server': 'Freund betritt einen Server', 'Friend request accepted.': 'Freundschaftsanfrage angenommen.',
    'Friend request sent to {0}.': 'Freundschaftsanfrage an {0} gesendet.', 'Friend requests': 'Freundschaftsanfragen', 'Friends are linked to your Minecraft account.': 'Freunde hängen an deinem Minecraft-Konto.',
    'Friends are not set up yet': 'Freunde sind noch nicht eingerichtet', 'Friends can join you directly': 'Freunde dürfen direkt nachjoinen', 'Friends of friends': 'Freunde von Freunden',
    'Friends of friends = someone who has a friend in common with you.': 'Freunde von Freunden = jemand, der mit dir einen gemeinsamen Freund hat.',
    'Friends server not reachable': 'Freunde-Server nicht erreichbar', 'Group': 'Gruppe', 'Group messages': 'Gruppennachrichten', 'Group name': 'Gruppenname',
    'Important = only messages, invites and join requests.': 'Wichtig = nur Nachrichten, Einladungen und Mitspiel-Anfragen.', 'In the launcher': 'Im Launcher', 'In the main menu': 'Im Hauptmenü',
    'Install {0} missing mod(s)': '{0} fehlende Mod(s) installieren', 'Installing {0} of {1}…': 'Installiere {0} von {1}…', 'Invite': 'Einladen', 'Invite sent to {0}.': 'Einladung an {0} gesendet.',
    'Invite {0}': '{0} einladen', 'It is deleted for everyone in this chat.': 'Sie wird für alle in diesem Chat gelöscht.', 'Join a server first or enter an address.': 'Betritt erst einen Server oder gib eine Adresse ein.',
    'Join requests': 'Mitspiel-Anfragen', 'Leave': 'Verlassen', 'Leave group': 'Gruppe verlassen', 'Leave {0}?': '{0} verlassen?', 'Load older messages': 'Ältere Nachrichten laden',
    'Mentions = only when someone writes @yourname.': 'Erwähnungen = nur, wenn jemand @deinName schreibt.', 'Message deleted': 'Nachricht gelöscht', 'Message from a blocked player': 'Nachricht eines blockierten Spielers',
    'Message {0}': 'Nachricht an {0}', 'Messages can only be edited for 15 minutes.': 'Nachrichten lassen sich nur 15 Minuten lang bearbeiten.', 'Mod profile': 'Mod-Profil', 'Mod profile of {0}': 'Mod-Profil von {0}',
    'Mojang could not confirm your account. Sign in to the launcher again.': 'Mojang konnte dein Konto nicht bestätigen. Melde dich im Launcher neu an.', 'More': 'Mehr',
    'Mute chat': 'Chat stummschalten', 'Mute notifications': 'Benachrichtigungen stummschalten', 'My current server': 'Mein aktueller Server', 'NOTIFICATIONS': 'BENACHRICHTIGUNGEN',
    'New group': 'Neue Gruppe', 'Nickname for {0}': 'Spitzname für {0}', 'No chats yet. Pick a friend to start one.': 'Noch keine Chats. Wähl einen Freund aus, um einen zu starten.',
    'No friends yet. Add someone by their Minecraft name above.': 'Noch keine Freunde. Füg oben jemanden per Minecraft-Name hinzu.', 'No messages yet': 'Noch keine Nachrichten',
    'No open friend requests.': 'Keine offenen Freundschaftsanfragen.', 'Nobody': 'Niemand', 'None': 'Keine', 'Not your friend': 'Nicht dein Freund',
    'Notifications off – turn on': 'Benachrichtigungen aus – einschalten', 'Off': 'Aus', 'Off: nobody sees when you read their messages – and you do not see theirs.': 'Aus: Niemand sieht, wann du Nachrichten gelesen hast – und du siehst es bei anderen auch nicht.',
    'Offline · last seen {0}': 'Offline · zuletzt online {0}', 'Online': 'Online', 'Only favorites': 'Nur Favoriten', 'Only important': 'Nur Wichtiges', 'Only mentions': 'Nur Erwähnungen',
    'Only the group owner can remove members.': 'Nur der Gruppenbesitzer kann Mitglieder entfernen.', 'Only you see it.': 'Nur du siehst ihn.', 'Open': 'Öffnen', 'Other address': 'Andere Adresse',
    'PRIVACY': 'PRIVATSPHÄRE', 'Pick a friend': 'Wähl einen Freund', 'Pick at least one friend.': 'Wähl mindestens einen Freund.', 'Player not found.': 'Spieler nicht gefunden.',
    'Playing Minecraft {0}': 'Spielt Minecraft {0}', 'Playing on Realms': 'Spielt auf Realms', 'Playing on {0}': 'Spielt auf {0}', 'Playing singleplayer': 'Spielt Einzelspieler',
    'Received': 'Erhalten', 'Remove friend': 'Freund entfernen', 'Remove from group': 'Aus der Gruppe entfernen', 'Rename group': 'Gruppe umbenennen', 'Reply': 'Antworten', 'Reply to {0}': 'Antwort an {0}',
    'Save': 'Speichern', 'Say hi to {0}!': 'Sag {0} Hallo!', 'Seen': 'Gesehen', 'Send': 'Senden', 'Send invite': 'Einladung senden', 'Send read receipts': 'Lesebestätigungen senden',
    'Sent': 'Gesendet', 'Server invite': 'Server-Einladung', 'Server invites': 'Server-Einladungen', 'Set nickname': 'Spitzname festlegen', 'Show': 'Zeigen', 'Show in the game': 'Im Spiel anzeigen',
    'Show when you are typing': 'Zeigen, wenn du schreibst', 'Shows a Join button next to your server.': 'Zeigt neben deinem Server einen Beitreten-Knopf.', 'Sign in to use friends': 'Melde dich an, um Freunde zu nutzen',
    'Signing in to the friends server with your Minecraft account.': 'Anmeldung beim Freunde-Server mit deinem Minecraft-Konto.', 'Slow down a little.': 'Etwas langsamer, bitte.',
    'Something went wrong on the friends server.': 'Auf dem Freunde-Server ist etwas schiefgelaufen.', 'Sound': 'Ton', 'Status, e.g. Bedwars?': 'Status, z. B. Bedwars?', 'That is you.': 'Das bist du.',
    'The friends server could not sign you in right now.': 'Der Freunde-Server konnte dich gerade nicht anmelden.', 'The launcher keeps trying in the background.': 'Der Launcher versucht es im Hintergrund weiter.',
    'The message is empty.': 'Die Nachricht ist leer.', 'The owner of this launcher has to start the friends server first. As soon as it runs, you can add friends here.': 'Der Betreiber des Launchers muss erst den Freunde-Server starten. Sobald er läuft, kannst du hier Freunde hinzufügen.',
    'This account is banned from Vortex friends.': 'Dieses Konto ist für Vortex-Freunde gesperrt.', 'This invite has expired.': 'Diese Einladung ist abgelaufen.', 'This is not a group.': 'Das ist keine Gruppe.',
    'This request no longer exists.': 'Diese Anfrage gibt es nicht mehr.', 'Too many friend requests. Try again later.': 'Zu viele Freundschaftsanfragen. Versuch es später nochmal.',
    'Too many open requests. Cancel some first.': 'Zu viele offene Anfragen. Zieh erst ein paar zurück.', 'Unblock': 'Entblocken', 'Unblocked.': 'Entblockt.', 'Unknown request.': 'Unbekannte Anfrage.',
    'Unknown status.': 'Unbekannter Status.', 'Unmute chat': 'Chat wieder laut', 'Valid for 10 minutes': '10 Minuten gültig', 'Waiting · {0}': 'Wartet · {0}',
    'When the launcher is in the background.': 'Wenn der Launcher im Hintergrund ist.', 'While you play': 'Während du spielst', 'Who can add you to groups': 'Wer dich zu Gruppen hinzufügen darf',
    'Who can ask to join you': 'Wer fragen darf, ob er mitspielen darf', 'Who can invite you to servers': 'Wer dich auf Server einladen darf', 'Who can message you': 'Wer dir schreiben darf',
    'Who can see your mod profile': 'Wer dein Mod-Profil sehen darf', 'Who can send you friend requests': 'Wer dir Freundschaftsanfragen schicken darf', 'Who sees that you are online': 'Wer sieht, dass du online bist',
    'Who sees which server you are on': 'Wer sieht, auf welchem Server du bist', 'Who sees “last seen”': 'Wer „zuletzt online“ sieht', 'Windows notifications': 'Windows-Benachrichtigungen',
    'With a Join button, if they allow it.': 'Mit Beitreten-Knopf, wenn er es erlaubt.', 'You': 'Du', 'You already sent {0} a request.': 'Du hast {0} schon eine Anfrage geschickt.',
    'You and {0} are now friends.': 'Du und {0} seid jetzt Freunde.', 'You are already friends with {0}.': 'Du bist schon mit {0} befreundet.', 'You are in too many groups.': 'Du bist in zu vielen Gruppen.',
    'You are no longer friends. The chat stays.': 'Ihr seid keine Freunde mehr. Der Chat bleibt.', 'You are not friends.': 'Ihr seid keine Freunde.', 'You are sending messages too fast.': 'Du schreibst zu schnell.',
    'You blocked this player.': 'Du hast diesen Spieler blockiert.', 'You blocked {0}.': 'Du hast {0} blockiert.', 'You blocked {0}. Unblock them first.': 'Du hast {0} blockiert. Entblocke ihn zuerst.',
    'You can only add friends.': 'Du kannst nur Freunde hinzufügen.', 'You can only ask friends.': 'Du kannst nur Freunde fragen.', 'You can only delete your own messages.': 'Du kannst nur eigene Nachrichten löschen.',
    'You can only edit your own messages.': 'Du kannst nur eigene Nachrichten bearbeiten.', 'You can only invite friends.': 'Du kannst nur Freunde einladen.', 'You cannot join {0} right now.': 'Du kannst {0} gerade nicht nachjoinen.',
    'You do not have Minecraft {0}': 'Du hast Minecraft {0} nicht', 'You have all their mods': 'Du hast alle seine Mods', 'You have it': 'Hast du', 'You no longer get messages from this group.': 'Du bekommst keine Nachrichten mehr aus dieser Gruppe.',
    'You sent an invite': 'Du hast eingeladen', 'Your friend list is full.': 'Deine Freundesliste ist voll.', 'Your mod profile is too large.': 'Dein Mod-Profil ist zu groß.',
    'Your mods per Minecraft version – friends can install the missing ones with one click.': 'Deine Mods je Minecraft-Version – Freunde können fehlende mit einem Klick installieren.',
    'edited': 'bearbeitet', 'for {0}': 'seit {0}', 'not on Modrinth': 'nicht auf Modrinth', 'off': 'aus', '{0} added {1}.': '{0} hat {1} hinzugefügt.', '{0} are typing…': '{0} schreiben…',
    '{0} blocked.': '{0} blockiert.', '{0} can no longer send you requests, messages or invites and will not see you online. An existing friendship ends.': '{0} kann dir keine Anfragen, Nachrichten oder Einladungen mehr schicken und sieht dich nicht mehr online. Eine Freundschaft endet.',
    '{0} cannot be added to groups by you.': '{0} kann von dir nicht zu Gruppen hinzugefügt werden.', '{0} created the group “{1}”.': '{0} hat die Gruppe „{1}“ erstellt.',
    '{0} does not accept friend requests from you.': '{0} nimmt keine Freundschaftsanfragen von dir an.', '{0} does not accept invites from you.': '{0} nimmt keine Einladungen von dir an.',
    '{0} does not accept join requests from you.': '{0} nimmt keine Mitspiel-Anfragen von dir an.', '{0} does not accept messages from you.': '{0} nimmt keine Nachrichten von dir an.',
    '{0} does not share their mod profile with you.': '{0} teilt sein Mod-Profil nicht mit dir.', '{0} gets a notification with a Join button – in the launcher and in the game.': '{0} bekommt eine Benachrichtigung mit Beitreten-Knopf – im Launcher und im Spiel.',
    '{0} has never used Vortex. They need to sign in to the launcher or the Vortex Client once.': '{0} hat Vortex noch nie benutzt. Er muss sich einmal im Launcher oder im Vortex Client anmelden.',
    '{0} has no mods yet.': '{0} hat noch keine Mods.', '{0} invites you': '{0} lädt dich ein', '{0} is already in the group.': '{0} ist schon in der Gruppe.', '{0} is not playing right now.': '{0} spielt gerade nicht.',
    '{0} is removed from the group.': '{0} wird aus der Gruppe entfernt.', '{0} is typing…': '{0} schreibt…', '{0} left the group.': '{0} hat die Gruppe verlassen.', '{0} members': '{0} Mitglieder',
    '{0} mod(s) installed for Minecraft {1}.': '{0} Mod(s) für Minecraft {1} installiert.', '{0} mutual friend(s)': '{0} gemeinsame(r) Freund(e)', '{0} removed {1}.': '{0} hat {1} entfernt.',
    '{0} renamed the group to “{1}”.': '{0} hat die Gruppe in „{1}“ umbenannt.', '“Do not disturb” silences everything': '„Nicht stören“ schaltet alles stumm', 'Remove {0}?': '{0} entfernen?',
    // Benachrichtigungen (Hauptprozess)
    'Friend request': 'Freundschaftsanfrage', '{0} wants to be your friend.': '{0} möchte mit dir befreundet sein.', 'New friend': 'Neuer Freund', '{0} is now your friend.': '{0} ist jetzt dein Freund.',
    '{0} is coming': '{0} kommt', '{0} declined': '{0} hat abgelehnt', 'They accepted your invite.': 'Die Einladung wurde angenommen.', 'They cannot join right now.': 'Gerade keine Zeit.',
    '{0} wants to join you': '{0} möchte mitspielen', 'Send them an invite to your server.': 'Schick eine Einladung auf deinen Server.', '{0} is online': '{0} ist online', 'Playing Minecraft': 'Spielt Minecraft',
    '{0} went offline': '{0} ist offline gegangen', '{0} joined a server': '{0} hat einen Server betreten', '{0} in {1}': '{0} in {1}', 'Invites you to {0}': 'Lädt dich auf {0} ein',
    'Sign in to your Microsoft account again to use friends.': 'Melde dich neu bei Microsoft an, um Freunde zu nutzen.', 'Mojang refused the sign-in ({0}). Sign in to your account again.': 'Mojang hat die Anmeldung abgelehnt ({0}). Melde dich neu an.',
    'Not connected to the friends server.': 'Nicht mit dem Freunde-Server verbunden.', 'Friends are not set up in this launcher.': 'Freunde sind in diesem Launcher nicht eingerichtet.',
    'The friends server did not answer.': 'Der Freunde-Server hat nicht geantwortet.', 'The connection to the friends server was lost.': 'Die Verbindung zum Freunde-Server ist abgebrochen.', 'The friends server is not reachable.': 'Der Freunde-Server ist nicht erreichbar.',
    'A group can have at most {0} members.': 'Eine Gruppe kann höchstens {0} Mitglieder haben.', 'Try again': 'Nochmal versuchen', 'Friends': 'Freunde'
  };

  let lang = 'en';
  const templates = [];
  for (const key of Object.keys(DE)) {
    if (!/\{\d+\}/.test(key)) continue;
    const order = [];
    const src = key.split(/(\{\d+\})/).map(part => {
      const m = part.match(/^\{(\d+)\}$/);
      if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    templates.push({ key, re: new RegExp(`^${src}$`), order });
  }
  // Laengere (spezifischere) Muster zuerst pruefen
  templates.sort((a, b) => b.key.length - a.key.length);

  const fill = (s, args) => s.replace(/\{(\d+)\}/g, (_, i) => (args[i] ?? ''));

  function t(key, ...args) {
    const s = lang === 'de' && Object.prototype.hasOwnProperty.call(DE, key) ? DE[key] : key;
    return fill(s, args);
  }

  /** Meldung (z. B. aus dem Hauptprozess) uebersetzen, auch mit eingesetzten Werten. */
  function tr(msg, depth = 0) {
    const m = String(msg ?? '');
    if (lang !== 'de' || !m) return m;
    if (Object.prototype.hasOwnProperty.call(DE, m) && !/\{\d+\}/.test(m)) return DE[m];
    for (const tpl of templates) {
      const hit = m.match(tpl.re);
      if (!hit) continue;
      const args = [];
      tpl.order.forEach((idx, n) => { args[idx] = depth < 2 ? tr(hit[n + 1], depth + 1) : hit[n + 1]; });
      return fill(DE[tpl.key], args);
    }
    return m;
  }

  function setLanguage(pref) {
    const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
    lang = pref === 'de' || (pref !== 'en' && /^de\b/i.test(nav)) ? 'de' : 'en';
    return lang;
  }

  /** Statische Texte im HTML uebersetzen (Textknoten, placeholder, title). */
  function translateDom(root) {
    if (lang !== 'de' || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const raw = n.nodeValue;
      const key = raw.trim();
      if (!key || !Object.prototype.hasOwnProperty.call(DE, key)) continue;
      n.nodeValue = raw.replace(key, DE[key]);
    }
    for (const el of root.querySelectorAll('[placeholder],[title]')) {
      for (const attr of ['placeholder', 'title']) {
        const v = el.getAttribute(attr);
        if (v && Object.prototype.hasOwnProperty.call(DE, v)) el.setAttribute(attr, DE[v]);
      }
    }
  }

  const api = { t, tr, setLanguage, translateDom, lang: () => lang, locale: () => (lang === 'de' ? 'de-DE' : 'en-US'), DE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VortexI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
