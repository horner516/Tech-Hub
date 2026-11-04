#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux ]] || { echo 'Build on Linux using the target CPU architecture.' >&2; exit 1; }
: "${NODE_BINARY:=$(command -v node)}"
: "${GO_BINARY:=$(command -v go)}"
: "${PYTHON_BINARY:=$(command -v python3)}"
arch="$($NODE_BINARY -p process.arch)"
[[ $arch == arm64 || $arch == x64 ]] || { echo 'Only Linux arm64 and x64 are supported.' >&2; exit 1; }
[[ $($NODE_BINARY -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node 24 is required.' >&2; exit 1; }
app="$PWD/dist/linux-$arch/Tech-Hub"
resources="$app/resources"
rm -rf "$app"
mkdir -p "$resources/hub" "$resources/drivers/power"
"$GO_BINARY" -C services/power build -trimpath -o "$resources/drivers/power/power-server" .
"$PYTHON_BINARY" -m PyInstaller --noconfirm --clean --onedir --name dsan-server --distpath "build/linux-$arch/python-dist" --workpath "build/linux-$arch/python-work" --specpath "build/linux-$arch" --add-data "$PWD/services/dsan/index.html:." services/dsan/app.py
cp -a "build/linux-$arch/python-dist/dsan-server" "$resources/drivers/dsan"
cp "$NODE_BINARY" "$resources/node"
cp hub/* "$resources/hub/"
cp package.json "$resources/package.json"
"$NODE_BINARY" scripts/bundle-services.cjs "$resources" --host-only
[[ -f dist/app-packages-universal/catalog.json ]] || "$NODE_BINARY" scripts/build-universal.cjs
cp dist/app-packages-universal/catalog.json "$resources/catalog.json"
cp native-linux/{tech-hub,open.cjs,desktop-entry.cjs,install.sh} "$app/"
cp LINUX.md "$app/README.md"
printf '%s\n' "$arch" > "$app/architecture"
chmod +x "$app/tech-hub" "$app/install.sh"
package() {
 local name="$1"
 tar -czf "dist/$name" -C "dist/linux-$arch" Tech-Hub
 (cd dist && sha256sum "$name" > "$name.sha256")
}
package "Tech-Hub-Linux-$arch-Lite.tar.gz"
cp -a dist/app-packages-universal "$resources/offline-apps"
package "Tech-Hub-Linux-$arch-Full.tar.gz"
echo "Built Linux $arch Lite and Full installers."
