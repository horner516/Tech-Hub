#!/bin/bash
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'This package requires Linux.' >&2; exit 1; }
[[ $EUID != 0 ]] || { echo 'Run as your normal login user, without sudo.' >&2; exit 1; }
source_dir="$(cd "$(dirname "$0")" && pwd)"
expected="$(cat "$source_dir/architecture")"
case "$(uname -m)" in aarch64|arm64) actual=arm64;; x86_64) actual=x64;; *) echo 'Only 64-bit ARM and x64 are supported.' >&2; exit 1;; esac
[[ $actual == "$expected" ]] || { echo "Download the $actual package." >&2; exit 1; }
"$source_dir/resources/node" --version >/dev/null
systemctl --user show-environment >/dev/null || { echo 'A systemd user session is required. Log in normally, then retry.' >&2; exit 1; }
install_dir="$HOME/.local/lib/tech-hub"
[[ ! -e "$install_dir.previous" ]] || { echo 'Move ~/.local/lib/tech-hub.previous aside before upgrading again.' >&2; exit 1; }
mkdir -p "$HOME/.local/lib" "$HOME/.config/systemd/user" "$HOME/.local/share/applications"
stage="$(mktemp -d "$HOME/.local/lib/tech-hub-stage.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp -a "$source_dir/." "$stage/"
chmod +x "$stage/tech-hub" "$stage/resources/node"
systemctl --user stop tech-hub.service 2>/dev/null || true
if [[ -e "$install_dir" ]]; then mv "$install_dir" "$install_dir.previous"; fi
mv "$stage" "$install_dir"
cat > "$HOME/.config/systemd/user/tech-hub.service" <<'UNIT'
[Unit]
Description=Tech Hub module host
After=network.target
[Service]
Type=simple
ExecStart="%h/.local/lib/tech-hub/tech-hub"
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
KillMode=control-group
UMask=0077
[Install]
WantedBy=default.target
UNIT
# Desktop entry is generated with escaping required by the desktop-entry specification.
"$install_dir/resources/node" "$install_dir/desktop-entry.cjs" "$install_dir" > "$HOME/.local/share/applications/tech-hub.desktop"
systemctl --user daemon-reload
systemctl --user enable --now tech-hub.service
printf 'Tech Hub installed. Default control page: http://127.0.0.1:8700\nActual address/logs: journalctl --user -u tech-hub -f\nFor unattended boot: sudo loginctl enable-linger "%s"\n' "$USER"
