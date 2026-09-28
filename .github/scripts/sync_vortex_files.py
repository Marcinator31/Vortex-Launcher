#!/usr/bin/env python3
"""
Holt die neuesten Client- und Addon-Jars und veroeffentlicht sie im Release
"vortex-files" -- genau wie der Admin-Bereich des Launchers, nur automatisch.

Laeuft als GitHub Action in DIESEM Repo (sync-vortex-files.yml):
  - alle 15 Minuten
  - sofort per "Run workflow" (oder API-Aufruf)

Quellen (SOURCES unten):
  Marcinator31/Vortex-Client    oeffentlich -> kein Token noetig
  Marcinator31/Vortex-Addon-v2  privat      -> Secret ADDON_TOKEN (nur Lesen)

Pro Quelle wird je Minecraft-Version das neueste Release genommen (die
Version steht hinter dem "+", z. B. 2.25.0+26.2 -> 26.2). Veroeffentlicht
wird nur, wenn es NEUER ist als das, was schon im Launcher liegt -- oder
gleich neu, aber eine andere Datei (neu gebaut). Aelter nie: eine Jar, die
du von Hand im Admin-Bereich hochgeladen hast, wird nicht zurueckgedreht.

BETA-KANAL: Neue Builds landen in manifest-beta.json. Nur Admins/Tester mit
eingeschaltetem "Beta-Updates" bekommen sie. Fuer alle freigeben:
  - im Launcher: Admin -> "Fuer alle freigeben"
  - oder hier: Run workflow mit "promote" = true
(Umgebung CHANNEL=stable: direkt fuer alle, ohne Beta.)

Die Notizen der Spieler ("Was ist neu") kommen aus dem Text des Releases im
Client-/Addon-Repo -- also aus den Commit-Nachrichten.

Ablauf wie im Admin-Bereich: Jar hochladen -> Manifest ersetzen -> alte Jar
loeschen, aber nur, wenn KEIN Manifest sie mehr braucht.
"""
import datetime
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPOSITORY") or "Marcinator31/Vortex-Launcher"
TAG = "vortex-files"
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()          # schreibt in dieses Repo

SOURCES = [
    # (Repo, Umgebungsvariable mit Lese-Token oder None)
    ("Marcinator31/Vortex-Client", None),
    ("Marcinator31/Vortex-Addon-v2", "ADDON_TOKEN"),
]

SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,150}\.jar$")
MC_OF = re.compile(r"\+(\d+\.\d+(?:\.\d+)?)$")


def http(method, url, token, body=None, raw=None, content_type=None, accept=None):
    headers = {
        "Accept": accept or "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VortexFilesSync",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if raw is not None:
        data = raw
        headers["Content-Type"] = content_type or "application/octet-stream"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url if url.startswith("http") else API + url,
                                 data=data, method=method, headers=headers)
    # Dateien leitet GitHub auf einen Speicher-Server um. Der will den Token
    # NICHT sehen -- deshalb selbst umleiten, ohne Authorization.
    opener = urllib.request.build_opener(_KeineUmleitung) if accept == "application/octet-stream" \
        else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=180) as res:
            payload = res.read()
            if accept == "application/octet-stream":
                return payload
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 307, 308) and accept == "application/octet-stream":
            ziel = e.headers.get("Location")
            frei = urllib.request.Request(ziel, headers={"User-Agent": "VortexFilesSync",
                                                         "Accept": "application/octet-stream"})
            with urllib.request.urlopen(frei, timeout=180) as res:
                return res.read()
        if e.code == 404 and method == "GET":
            return None
        raise RuntimeError(f"GitHub {e.code} bei {method} {url}: {e.read().decode('utf8', 'replace')[:300]}")


class _KeineUmleitung(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def version_key(v):
    """'2.25.0+26.2' -> (2, 25, 0); nur der Teil vor dem '+'."""
    core = str(v).split("+")[0].lstrip("vV")
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-]", core))


# --------------------------------------------------------------------------
# Launcher-Seite: Release und Manifest
# --------------------------------------------------------------------------

def release():
    rel = http("GET", f"/repos/{REPO}/releases/tags/{TAG}", TOKEN)
    if rel:
        return rel
    print(f'Lege das Release "{TAG}" an.')
    return http("POST", f"/repos/{REPO}/releases", TOKEN, body={
        "tag_name": TAG,
        "name": "Vortex files (managed by the launcher)",
        "body": "Client/addon jars published from the Vortex launcher admin area. "
                "Please do not edit or delete this release by hand.",
        "prerelease": True,
        "make_latest": "false",
    })


STABLE = "manifest.json"
BETA = "manifest-beta.json"
CHANNEL = (os.environ.get("CHANNEL") or "beta").strip().lower()      # wohin neue Builds gehen


def read_manifest(rel, name=STABLE):
    asset = next((a for a in rel.get("assets", []) if a["name"] == name), None)
    if not asset:
        return {"schema": 1, "versions": {}, "news": []}
    buf = http("GET", f"/repos/{REPO}/releases/assets/{asset['id']}", TOKEN, accept="application/octet-stream")
    m = json.loads(buf.decode("utf8"))
    if not isinstance(m.get("versions"), dict):
        raise RuntimeError(f"{name} ist kaputt -- breche ab, statt sie zu ueberschreiben.")
    m.setdefault("news", [])
    m["schema"] = 1
    return m


def write_manifest(name, manifest):
    manifest["updatedAt"] = now()
    upload(release(), name, json.dumps(manifest, indent=2).encode(), "application/json")


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def used_files():
    rel = release()
    out = set()
    for name in (STABLE, BETA):
        for e in read_manifest(rel, name)["versions"].values():
            for f in (e.get("files") or {}).values():
                out.add(f.get("file"))
    return out


def delete_if_unused(file_name):
    """Alte Jar nur loeschen, wenn KEIN Manifest (stabil oder Beta) sie noch braucht."""
    if not file_name or file_name in used_files():
        return
    for a in release().get("assets", []):
        if a["name"] == file_name:
            http("DELETE", f"/repos/{REPO}/releases/assets/{a['id']}", TOKEN)


def clean_notes(body):
    """Release-Text -> Notizen fuer die Spieler (ohne technische Zeilen)."""
    out = []
    for line in str(body or "").splitlines():
        l = line.strip()
        if not l or re.match(r"(?i)^(co-authored-by|claude-session|signed-off-by|automatisch gebaut|built from)", l):
            continue
        if l.startswith("http") and "claude.ai" in l:
            continue
        out.append(l)
    return "\n".join(out)[:4000]


def upload(rel, name, data, content_type):
    for a in rel.get("assets", []):
        if a["name"] == name:
            http("DELETE", f"/repos/{REPO}/releases/assets/{a['id']}", TOKEN)
    url = (f"https://uploads.github.com/repos/{REPO}/releases/{rel['id']}/assets"
           f"?name={urllib.parse.quote(name)}")
    return http("POST", url, TOKEN, raw=data, content_type=content_type)


def publish(name, data, mc, notes):
    """Neuen Build in den Kanal CHANNEL legen (Standard: Beta)."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        meta = json.loads(z.read("fabric.mod.json").decode("utf8"))
    mod_id, mod_name, version = str(meta["id"]), str(meta.get("name") or meta["id"]), str(meta.get("version") or "")
    sha = hashlib.sha256(data).hexdigest()
    ziel = BETA if CHANNEL == "beta" else STABLE

    rel = release()
    stable = read_manifest(rel, STABLE)
    target = stable if ziel == STABLE else read_manifest(rel, BETA)
    s_prev = stable["versions"].get(mc, {}).get("files", {}).get(mod_id)
    entry = target["versions"].setdefault(mc, {"files": {}})
    entry.setdefault("files", {})
    prev = entry["files"].get(mod_id)

    for p in (prev, s_prev):
        if p and p.get("sha256") == sha:
            print(f"  {mod_name} {version} ({mc}) liegt schon genau so im Launcher.")
            return False
    for p in (prev, s_prev):
        if p and version_key(p.get("version")) > version_key(version):
            print(f"  {mod_name}: im Launcher liegt schon {p.get('version')} (neuer als {version}) -- lasse es.")
            return False
    for m in (stable, target):
        for ov, oe in m["versions"].items():
            for oid, of in (oe.get("files") or {}).items():
                if of.get("file") == name and not (ov == mc and oid == mod_id):
                    raise RuntimeError(f"Dateiname {name} wird schon fuer Minecraft {ov} benutzt.")

    upload(rel, name, data, "application/java-archive")
    entry["files"][mod_id] = {"file": name, "version": version, "name": mod_name, "sha256": sha,
                              "size": len(data), "uploadedAt": now(), "notes": notes}
    write_manifest(ziel, target)
    if prev and prev.get("file") and prev["file"] != name:
        delete_if_unused(prev["file"])
    kanal = "BETA" if ziel == BETA else "fuer alle"
    print(f"  VEROEFFENTLICHT ({kanal}): {mod_name} {version} fuer Minecraft {mc}.")
    return True


def promote():
    """Alles, was in der Beta neuer ist als die freigegebene Version, fuer alle freigeben."""
    rel = release()
    stable, beta = read_manifest(rel, STABLE), read_manifest(rel, BETA)
    alt = []
    n = 0
    for mc, e in beta["versions"].items():
        for mod_id, f in (e.get("files") or {}).items():
            cur = stable["versions"].get(mc, {}).get("files", {}).get(mod_id)
            if cur and (cur.get("sha256") == f.get("sha256") or version_key(cur.get("version")) > version_key(f.get("version"))):
                continue
            stable["versions"].setdefault(mc, {"files": {}}).setdefault("files", {})[mod_id] = {**f, "uploadedAt": now()}
            if cur and cur.get("file") != f.get("file"):
                alt.append(cur.get("file"))
            print(f"  FREIGEGEBEN: {f.get('name')} {f.get('version')} fuer Minecraft {mc}.")
            n += 1
    if n:
        write_manifest(STABLE, stable)
        for file_name in alt:
            delete_if_unused(file_name)
    else:
        print("  Nichts freizugeben -- die Beta ist nicht neuer als die freigegebene Version.")
    return n


# --------------------------------------------------------------------------
# Quellen: neuestes Release je Minecraft-Version
# --------------------------------------------------------------------------

def newest_jars(src, token, im_launcher):
    """
    {mc: (version, asset_name, asset_id)} -- je MC-Version das neueste Release.

    Nur fuer MC-Versionen, die schon im Launcher liegen, plus die Version
    des allerneuesten Releases (so kommt eine neue MC-Version automatisch
    dazu). Alte Releases fuer laengst abgeloeste Versionen bleiben draussen.
    """
    rels = http("GET", f"/repos/{src}/releases?per_page=30", token) or []
    rels = [r for r in rels if not r.get("draft")]
    rels.sort(key=lambda r: r.get("published_at") or r.get("created_at") or "", reverse=True)
    erlaubt = set(im_launcher)
    for r in rels[:1]:
        for a in r.get("assets", []):
            m = MC_OF.search(a["name"][:-4]) if a["name"].endswith(".jar") else None
            if m:
                erlaubt.add(m.group(1))
    best = {}
    alle = {}
    for r in rels:
        if r.get("draft"):
            continue
        for a in r.get("assets", []):
            n = a["name"]
            if not n.endswith(".jar") or "-sources" in n or not SAFE_NAME.match(n):
                continue
            version = n[:-4]
            m = MC_OF.search(version)
            if not m:
                continue
            mc = m.group(1)
            if mc not in erlaubt:
                continue
            notes = clean_notes(r.get("body"))
            alle.setdefault(mc, []).append((version, n, notes))
            if mc not in best or version_key(version) > version_key(best[mc][0]):
                best[mc] = (version, n, a["id"], notes)
    for mc in alle:
        alle[mc].sort(key=lambda x: version_key(x[0]), reverse=True)
    return best, alle


def aenderungen_eintragen(alle_quellen):
    """
    BETA-CHECKLISTE: zu jeder Beta-Datei die Notizen ALLER Releases bis zu
    ihrer Version eintragen ("changes", neueste zuerst, hoechstens 25).

    Der Launcher filtert davon alles weg, was schon freigegeben (oder im
    Launcher mitgeliefert) ist -- uebrig bleiben genau die Neuerungen, die
    noch niemand ausser den Testern hat, auch aus aelteren Beta-Builds.
    Die Quelle einer Datei wird am Dateinamen erkannt (= Asset-Name).
    """
    rel = release()
    beta = read_manifest(rel, BETA)
    geaendert = False
    for mc, e in beta["versions"].items():
        for mod_id, f in (e.get("files") or {}).items():
            liste = None
            for alle in alle_quellen:
                kandidaten = alle.get(mc) or []
                if any(name == f.get("file") for _, name, _ in kandidaten):
                    liste = kandidaten
                    break
            if liste is None:
                continue
            changes = [{"version": v, "notes": n} for v, _, n in liste
                       if n and version_key(v) <= version_key(f.get("version"))][:25]
            if f.get("changes") != changes:
                f["changes"] = changes
                geaendert = True
    if geaendert:
        write_manifest(BETA, beta)
        print("  Beta-Checkliste: Aenderungen im Beta-Manifest aktualisiert.")


def main():
    if not TOKEN:
        raise SystemExit("GITHUB_TOKEN fehlt.")
    changed = 0
    alle_quellen = []
    for src, token_env in SOURCES:
        token = os.environ.get(token_env, "").strip() if token_env else None
        print(f"== {src}")
        if token_env and not token:
            print(f"::warning::Secret {token_env} fehlt -- {src} ist privat und wird uebersprungen.")
            continue
        try:
            rel = release()
            bekannt = set(read_manifest(rel, STABLE)["versions"]) | set(read_manifest(rel, BETA)["versions"])
            jars, alle = newest_jars(src, token, bekannt)
            alle_quellen.append(alle)
            if not jars:
                print("  keine passenden Releases gefunden.")
            for mc, (version, name, asset_id, notes) in sorted(jars.items()):
                data = http("GET", f"/repos/{src}/releases/assets/{asset_id}", token,
                            accept="application/octet-stream")
                if publish(name, data, mc, notes):
                    changed += 1
        except Exception as e:                                 # eine Quelle darf die andere nicht blockieren
            print(f"::error::{src}: {e}")
    print(f"Fertig: {changed} Datei(en) neu veroeffentlicht (Kanal: {CHANNEL}).")
    try:
        aenderungen_eintragen(alle_quellen)
    except Exception as e:
        print(f"::warning::Beta-Checkliste nicht aktualisiert: {e}")
    if (os.environ.get("PROMOTE") or "").strip().lower() in ("1", "true", "yes"):
        print("== Freigabe fuer alle")
        promote()


if __name__ == "__main__":
    main()
