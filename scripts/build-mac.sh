#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
: "${NODE_BINARY:=$(command -v node)}"
: "${GO_BINARY:=$(command -v go)}"
: "${PYTHON_BINARY:=$(command -v python3)}"
if [[ "$(uname -m)" != arm64 ]]; then echo 'This installer targets Apple silicon Macs.' >&2; exit 1; fi
version="$($NODE_BINARY -p 'require("./package.json").version')"
app="$project_dir/dist/Tech Hub.app"
resources="$app/Contents/Resources"
mkdir -p build dist
export PYINSTALLER_CONFIG_DIR="$project_dir/build/pyinstaller-cache"
if [[ -d "$app" ]]; then rm -rf "$app"; fi
mkdir -p "$app/Contents/MacOS" "$resources/hub" "$resources/drivers"
mkdir -p "$resources/drivers/power"
"$GO_BINARY" -C services/power build -trimpath -o "$resources/drivers/power/power-server" .
"$PYTHON_BINARY" -m PyInstaller --noconfirm --clean --onedir --name dsan-server --distpath build/python-dist --workpath build/python-work --specpath build --add-data "$project_dir/services/dsan/index.html:." services/dsan/app.py
cp -R build/python-dist/dsan-server "$resources/drivers/dsan"
cp "$NODE_BINARY" "$resources/node"
cp hub/* "$resources/hub/"
cp package.json "$resources/package.json"
if [[ ! -f dist/app-packages-universal/catalog.json ]]; then "$NODE_BINARY" scripts/build-universal.cjs; fi
"$NODE_BINARY" scripts/bundle-services.cjs "$resources" --host-only
cp dist/app-packages-universal/catalog.json "$resources/catalog.json"
cp native-mac/Info.plist "$app/Contents/Info.plist"
cp assets/TechHub.icns "$resources/TechHub.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$app/Contents/Info.plist"
/usr/bin/swiftc -module-cache-path "$project_dir/build/swift-cache" -target arm64-apple-macos13.0 native-mac/TechHub.swift -o "$app/Contents/MacOS/Tech Hub" -framework AppKit -framework Foundation
make_dmg() {
  local filename="$1"
  /usr/bin/codesign --force --deep --sign - "$app"
  /usr/bin/codesign --verify --deep --strict "$app"
  local staging="$project_dir/build/dmg-root"
  if [[ -d "$staging" ]]; then rm -rf "$staging"; fi
  mkdir -p "$staging"
  cp -R "$app" "$staging/"
  ln -s /Applications "$staging/Applications"
  cp INSTALL.md "$staging/Install Tech Hub.txt"
  # hdiutil intermittently fails with "Resource busy" on CI runners while the previous image is still being scanned.
  local attempt
  for attempt in 1 2 3; do
    if /usr/bin/hdiutil create -volname "Tech Hub $version" -fs HFS+ -srcfolder "$staging" -ov -format UDZO "$project_dir/dist/$filename"; then break; fi
    if [[ $attempt == 3 ]]; then echo "hdiutil create failed 3 times for $filename" >&2; exit 1; fi
    echo "hdiutil create failed for $filename (attempt $attempt); retrying in 10 s" >&2; sleep 10
  done
  (cd dist && shasum -a 256 "$filename" > "$filename.sha256")
}
make_dmg Tech-Hub-macOS-arm64.dmg
cp -R dist/app-packages-universal "$resources/offline-apps"
make_dmg Tech-Hub-macOS-arm64-Full.dmg
echo "Built host and full macOS installers."
