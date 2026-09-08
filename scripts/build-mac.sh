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
mkdir -p "$app/Contents/MacOS" "$resources/hub" "$resources/lux/dashboard"
"$GO_BINARY" -C services/power build -trimpath -o "$resources/power-server" .
"$PYTHON_BINARY" -m PyInstaller --noconfirm --clean --onedir --name dsan-server --distpath build/python-dist --workpath build/python-work --specpath build --add-data "$project_dir/services/dsan/index.html:." services/dsan/app.py
cp -R build/python-dist/dsan-server "$resources/dsan"
(cd services/lux && "$NODE_BINARY" node_modules/vite/bin/vite.js build --config desktop/vite.config.ts)
cp -R services/lux/desktop-web/. "$resources/lux/dashboard/"
cp -R services/lux/electron services/lux/lib "$resources/lux/"
cp services/lux/package.json "$resources/lux/package.json"
cp "$NODE_BINARY" "$resources/node"
cp hub/* "$resources/hub/"
cp package.json "$resources/package.json"
cp native-mac/Info.plist "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$app/Contents/Info.plist"
/usr/bin/swiftc -module-cache-path "$project_dir/build/swift-cache" -target arm64-apple-macos13.0 native-mac/TechHub.swift -o "$app/Contents/MacOS/Tech Hub" -framework AppKit -framework Foundation
reader="$resources/MA Web Remote Reader.app"
mkdir -p "$reader/Contents/MacOS"
/usr/bin/clang -fobjc-arc -mmacosx-version-min=13.0 services/lux/native-mac/MAWebRemoteReader.m -o "$reader/Contents/MacOS/MA Web Remote Reader" -framework AppKit -framework Foundation -framework Vision -framework WebKit
cp services/lux/native-mac/MAWebRemoteReader-Info.plist "$reader/Contents/Info.plist"
/usr/bin/codesign --force --deep --sign - "$app"
/usr/bin/codesign --verify --deep --strict "$app"
staging="$project_dir/build/dmg-root"
if [[ -d "$staging" ]]; then rm -rf "$staging"; fi
mkdir -p "$staging"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
cp INSTALL.md "$staging/Install Tech Hub.txt"
/usr/bin/hdiutil create -volname "Tech Hub $version" -fs HFS+ -srcfolder "$staging" -ov -format UDZO "$project_dir/dist/Tech-Hub-macOS-arm64.dmg"
(cd dist && shasum -a 256 Tech-Hub-macOS-arm64.dmg > Tech-Hub-macOS-arm64.dmg.sha256)
echo "Built $project_dir/dist/Tech-Hub-macOS-arm64.dmg"
