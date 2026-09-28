# Vortex Friends – Server

Freunde, Chat (auch Gruppen), Online-Status mit Server, Einladungen, Nachjoinen,
Mod-Profile und Blockieren für den **Vortex Launcher** und den **Vortex Client**.

Launcher und Spiel verbinden sich per WebSocket mit `wss://<deine-adresse>/ws`.
Anmeldung läuft über Mojang (wie beim Beitreten eines Minecraft-Servers) – Passwörter
oder Minecraft-Tokens kommen hier **nie** an.

## Einmal einrichten (kostenlos, ca. 10 Minuten)

Der Server muss rund um die Uhr laufen. Empfohlen: **Render** (Webdienst) +
**Neon** (Datenbank). Beides kostenlos.

### 1. Datenbank bei Neon

1. <https://neon.tech> → mit GitHub anmelden → **Create project** (Region: Frankfurt).
2. Auf der Projektseite **Connect** → die Verbindungs-URL kopieren
   (beginnt mit `postgresql://…`).

> Warum eine eigene Datenbank? Render löscht bei kostenlosen Diensten die Festplatte
> bei jedem Neustart. Ohne Datenbank wären danach alle Freundschaften weg.

### 2. Webdienst bei Render

1. <https://dashboard.render.com> → **New → Web Service** → Repo `Vortex-Launcher` wählen.
2. Einstellungen:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm ci --omit=dev`
   - **Start Command:** `node --no-warnings src/server.js`
   - **Instance Type:** Free
3. **Environment** → Variable `DATABASE_URL` = die URL von Neon.
   Außerdem `NODE_VERSION` = `22`.
4. **Create Web Service**. Nach dem Build steht oben die Adresse, z. B.
   `https://vortex-friends.onrender.com`.
5. Test: diese Adresse im Browser öffnen → es muss
   `{"name":"Vortex Friends", …}` erscheinen.

### 3. Adresse in den Launcher

In `src/main/config.js` bei `friendsServer` eintragen – mit `wss://` und `/ws`:

```js
friendsServer: 'wss://vortex-friends.onrender.com/ws',
```

Committen → der Launcher baut sich neu und gibt die Adresse beim Spielstart auch
an den Vortex Client weiter.

## Gut zu wissen

- **Render Free schläft** nach ca. 15 Minuten ohne Verkehr ein und braucht beim
  Aufwachen etwa eine Minute. Offene Verbindungen halten ihn wach; Launcher und
  Spiel verbinden sich automatisch neu. Wer das nicht will: Render „Starter“ (bezahlt)
  oder ein eigener Server.
- **Eigener Server / VPS:** `docker build -t vortex-friends server && docker run -d -p 8080:8080 -v vf:/data vortex-friends`
  (ohne `DATABASE_URL` nutzt er eine SQLite-Datei in `/data`). Davor gehört ein
  HTTPS-Proxy (z. B. Caddy), damit die Adresse mit `wss://` erreichbar ist.
- **Sperren:** Umgebungsvariable `BANNED` = Komma-Liste von Minecraft-Namen oder UUIDs.
- **Status:** `GET /` zeigt, wie viele Spieler registriert und gerade verbunden sind.
- Nachrichten älter als 180 Tage werden automatisch gelöscht.

## Test

```
cd server && npm install && npm test
```
