#!/usr/bin/env bash
# Baut assets/hosting/vortex-hosting-fix.jar (Hilfs-Mod fuer "Welt hosten").
# Braucht ein JDK (21+) sowie Brigadier und Fabric Loader als Jars:
#   hosting-fix/build.sh <brigadier.jar> <fabric-loader.jar>
# Beide liegen nach dem ersten Hosten z. B. unter
#   %APPDATA%\Vortex Client\hosting\<version>\libraries\...
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/classes
javac --release 21 -cp "$1;$2" -d build/classes src/vortex/hostingfix/HostingFix.java
cp resources/fabric.mod.json build/classes/
mkdir -p ../assets/hosting
jar --create --file ../assets/hosting/vortex-hosting-fix.jar -C build/classes .
rm -rf build
echo "OK: assets/hosting/vortex-hosting-fix.jar"
