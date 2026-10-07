"""
Vor dem Bauen des Launchers: die im Installer mitgelieferten Vortex-Dateien
(assets/modpacks/<Minecraft-Version>/) durch die aktuell freigegebenen ersetzen
(manifest.json im Release "vortex-files").

Nur fuer Versionen, die schon einen Ordner haben. Andere mitgelieferte Mods
(Fabric API, Mod Menu) bleiben unberuehrt. Jede Datei wird per SHA-256 geprueft.
"""
import hashlib, json, os, re, sys, urllib.request

BASE = "https://github.com/Marcinator31/Vortex-Launcher/releases/download/vortex-files"
ROOT = os.path.join("assets", "modpacks")
VORTEX = re.compile(r"^(vortexclient|vortex[-_]plus[-_]addon)", re.I)


def holen(url):
    req = urllib.request.Request(url, headers={"User-Agent": "VortexLauncherBuild"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    m = json.loads(holen(f"{BASE}/manifest.json"))
    versionen = m.get("versions") or {}
    if not versionen:
        print("manifest.json ist leer -- mitgelieferte Dateien bleiben wie sie sind.")
        return 0
    for v in sorted(os.listdir(ROOT)):
        ordner = os.path.join(ROOT, v)
        files = (versionen.get(v) or {}).get("files") or {}
        if not os.path.isdir(ordner) or not files:
            continue
        neu = []
        for mod_id, f in files.items():
            name = f.get("file", "")
            if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$", name) or not VORTEX.match(name):
                continue
            daten = holen(f"{BASE}/{urllib.request.quote(name)}")
            if hashlib.sha256(daten).hexdigest() != f.get("sha256", "").lower():
                raise SystemExit(f"Pruefsumme stimmt nicht: {name}")
            neu.append((name, daten))
        if not neu:
            continue
        for alt in os.listdir(ordner):
            if VORTEX.match(alt):
                os.remove(os.path.join(ordner, alt))
        for name, daten in neu:
            with open(os.path.join(ordner, name), "wb") as fh:
                fh.write(daten)
            print(f"{v}: {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
