# Vortex Client Launcher 2.1

Der offizielle Launcher fuer den Vortex Client: Microsoft-Login, Fabric,
Vortex Client + Vortex Plus Addon, Mods, Resource Packs und Server --
komplett neu gebaut, im Design des Clients.

## EXE bauen (Windows, CMD)

1. **Node.js LTS** installieren: <https://nodejs.org> (einmalig, danach PC neu starten
   oder zumindest CMD neu oeffnen).
2. Dieses ZIP entpacken, z. B. nach `C:\Vortex-Launcher`.
3. **`build.bat` doppelklicken** -- oder in CMD:

   ```bat
   cd C:\Vortex-Launcher
   npm install
   npm run dist
   ```

4. Fertig. Im Ordner **`release\`** liegen:
   - `Vortex-Client-Setup-2.1.0.exe` -- Installer (Startmenue + Desktop-Verknuepfung)
   - `Vortex-Client-Portable-2.1.0.exe` -- laeuft ohne Installation

Nur eine der beiden bauen: `npm run dist:setup` oder `npm run dist:portable`.

**Testen ohne EXE:** `start.bat` doppelklicken (bzw. `npm start`).

### Falls der Build scheitert

| Meldung | Loesung |
|---|---|
| `'node' is not recognized` / `'npm' ...` | Node.js installieren, CMD neu oeffnen |
| `Cannot create symbolic link` | CMD **als Administrator** starten *oder* Windows-Entwicklermodus einschalten (Einstellungen > System > Fuer Entwickler), dann nochmal |
| Windows SmartScreen warnt beim Starten der EXE | Normal bei unsignierten Programmen: *Weitere Informationen > Trotzdem ausfuehren* |
| `EPERM` / Datei gesperrt | Laufenden Launcher schliessen, `release\` loeschen, nochmal |

## Ueber GitHub bauen (optional)

`.github/workflows/release.yml` baut die EXE auf GitHub, sobald ein Tag wie
`v2.0.0` gepusht wird, und veroeffentlicht sie als Release in
`Lukas3578/Vortex-launcher`. Von dort holt sich der eingebaute Auto-Updater
neue Versionen. Vor einem neuen Release die `version` in `package.json` erhoehen.

## Was drin ist

- **Home:** PLAY mit Fortschritt, Versionswahl, Stop, Schnell-Beitreten, Instanz, Neuigkeiten, Absturz-Hinweis
- **Versions:** Vortex-Versionen + jede andere Release-Version (reines Fabric), pruefen/reparieren,
  **Export als Modpack (.mrpack)**, **Modpack importieren**
- **Mods:** Namen + Icons aus den Jars, an/aus, Papierkorb, eigene Jars (auch per Drag & Drop),
  Modrinth-Suche mit Abhaengigkeiten, **Update-Pruefung + "Alle aktualisieren"**, **Performance-Paket**
  (Sodium, Lithium, Entity Culling)
- **Resource Packs** und **Shaders** (mit Iris-Knopf), jeweils mit Modrinth-Suche
- **Worlds:** Welten mit Groesse und Symbol, **Backups** (manuell + automatisch vor Updates), wiederherstellen
- **Screenshots:** Galerie, Grossansicht, kopieren, im Ordner zeigen, loeschen
- **Servers:** Live-Status, direkt beitreten
- **Skins:** echter Skin-Wechsel ueber Mojang, 3D-Vorschau, Umhang waehlen, Skin-Bibliothek,
  Skin eines Spielers kopieren
- **Absturz-Analyse:** erklaert die Ursache (fehlende/unpassende Mods, RAM, Java, Grafiktreiber)
  und bietet direkt die Loesung an (Mod ausschalten, RAM +1 GB, Fabric API installieren ...)
- **Settings:** RAM, Fenster, JVM, Java, Addon, Auto-Mod-Updates, Auto-Backups, Discord, **Sprache (Deutsch/English)**
- **Discord Rich Presence** (siehe unten), **Konsole**, mehrere Konten, startet auch offline

## Admin-Bereich: neue Client-/Addon-Versionen ohne neuen Launcher

Der Launcher-Besitzer laedt neue Jars direkt im Launcher hoch. Alle Launcher holen sie
automatisch (beim Start, alle 30 Minuten und vor jedem Spielstart) -- kein neuer
Launcher-Build noetig.

**Einmalig einrichten:**

1. Das Repo `Lukas3578/Vortex-launcher` muss **oeffentlich** sein (sonst koennen die Spieler nichts laden).
2. Auf GitHub einen Token erstellen: *Settings > Developer settings > Personal access tokens >
   Fine-grained tokens > Generate new token*
   - Repository access: *Only select repositories* > `Vortex-launcher`
   - Permissions: *Contents* > **Read and write**
3. Im Launcher **Strg + Umschalt + A** druecken (oeffnet den Admin-Bereich), Token einfuegen, *Anmelden*.
   Der Token wird mit der Windows-Verschluesselung nur auf deinem PC gespeichert.
   Danach steht "Admin" dauerhaft in der Seitenleiste.

**Neue Version veroeffentlichen:** Jar(s) in den Admin-Bereich ziehen (oder *Dateien waehlen*),
Minecraft-Version pruefen (wird aus der Jar erkannt), *Veroeffentlichen*. Fertig.

- Pro Minecraft-Version und Mod-ID gilt immer die **neueste** Datei: mitgeliefert oder online.
- Auch **neue Minecraft-Versionen** gehen: einfach eine Client-Jar fuer z. B. `26.3` hochladen --
  die Version erscheint bei allen Spielern (Fabric API holt der Launcher dann selbst von Modrinth).
- Auch eine neuere **Fabric API** kann hochgeladen werden, falls der Client sie braucht.
- *Online entfernen* nimmt eine Datei zurueck (Spieler nutzen dann wieder die mitgelieferte).
- Unter **News fuer alle Spieler** erscheint dein Text bei allen unter "Neuigkeiten".
- Jede Datei wird per SHA-256 geprueft -- eine manipulierte Datei wird nicht benutzt.
- Gespeichert wird alles im Release **vortex-files** deines Repos (als Pre-Release, stoert den
  Launcher-Updater nicht). Bitte dieses Release nicht von Hand loeschen.

Optional: In `src/main/config.js` unter `admins` deinen Minecraft-Namen eintragen, dann ist der
Menuepunkt auch ohne Token sichtbar. Hochladen geht trotzdem nur mit Token.

## Discord-Anzeige einrichten (optional)

1. <https://discord.com/developers/applications> > *New Application* > Name **Vortex Client**
   (so steht es dann in Discord: "Spielt Vortex Client").
2. Unter *Rich Presence > Art Assets* das Logo hochladen (`assets/branding/icon.png`) mit dem Namen **logo**.
3. Die *Application ID* kopieren und in `src/main/config.js` bei `discordClientId` eintragen, neu bauen.

## Aufbau

```
src/main/       Hauptprozess (Fenster, IPC, Start, Konten, Mods, Java, Updates,
                Admin, Skins, Welten, Absturz-Analyse, Discord, Modpacks)
src/main/config.js   <- hier Repo, Admins und Discord-ID einstellen
src/renderer/   Oberflaeche (index.html, styles.css, app.js, preload.js, vendor/skinview3d)
src/shared/     Uebersetzungen (i18n.js: Deutsch)
assets/         Logo, Icon, mitgelieferte Mods pro Version
build/          Installer-Bild + Installer-Texte
```
