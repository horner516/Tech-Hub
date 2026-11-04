# Linux and Raspberry Pi

The next Tech Hub release adds Linux ARM64 and x64 Full/Lite packages. Use a Raspberry Pi 4 or 5 with **64-bit Raspberry Pi OS Bookworm or newer**. 32-bit Raspberry Pi OS, ARMv7, and Alpine/musl are not supported. Packages are built on Debian 12 (glibc 2.36); Ubuntu 24.04 or newer is also a target. Physical Pi/network-hardware testing remains required before show use.

## Install

Download the `Tech-Hub-Linux-arm64-Full.tar.gz` package for Pi, or `x64` for an Intel/AMD PC. Full includes all nine modules; Lite downloads selected modules from the Module Library. Node and the native D’san/Power engines are included; no development toolchain is needed.

Extract, then run as your normal user (not root):

```sh
tar -xzf Tech-Hub-Linux-arm64-Full.tar.gz
bash Tech-Hub/install.sh
```

The installer copies the application to `~/.local/lib/tech-hub`, creates a systemd user service, enables it at login and adds a Tech Hub desktop-menu shortcut. It keeps settings in `${XDG_DATA_HOME:-~/.local/share}/tech-hub`. An upgrade retains the previous program at `~/.local/lib/tech-hub.previous`; move that backup aside before upgrading again. Settings are never removed by the installer.

Use the desktop shortcut or open `http://127.0.0.1:8700`. Port conflicts may change this address; the journal prints `TECH_HUB_READY` with the actual URL. Linux runs as a background service, not a system tray icon.

```sh
systemctl --user status tech-hub
systemctl --user restart tech-hub
systemctl --user stop tech-hub
journalctl --user -u tech-hub -f
```

For unattended operation after reboot without logging in:

```sh
sudo loginctl enable-linger "$USER"
```

On a headless Pi, use an SSH tunnel for initial administration: `ssh -L 8700:127.0.0.1:8700 pi-user@pi-address`. Open localhost:8700 on your computer, then enable remote administration and its password in Settings if desired. Substitute the actual administrator port if reassigned. Do not expose the administrator port to the internet.

## Modules and network behavior

The same universal module ZIPs run on Mac, Windows, Linux ARM64 and Linux x64. Linux supplies native D’san/Power engines for its CPU. Lux Link returns alongside D’san Ready, Power Monitor, NETGEAR AV Switchboard, Record Monitor, Router Panel, R-Too, Pixel Peeker and Otter EDID Editor.

Lux's MA Web Remote screen reader uses macOS frameworks and is unavailable on Linux/Windows. Its portable network monitoring features remain available. Install the distribution's `iputils-ping` package for Lux reachability checks and `xdg-utils` for the desktop shortcut.

Allow the selected service ports and multicast discovery on your trusted LAN. Wi-Fi isolation/VLANs can block discovery. Portless `.local` URLs require permission to bind port 80; the unprivileged service falls back to URLs with ports when unavailable. Do not run the whole host as root just to enable portless names.

## Remove / recover

Stop and disable with `systemctl --user disable --now tech-hub`. Remove the user unit and desktop shortcut if uninstalling. Keep the data directory for reinstall/restore. For program rollback, stop the service, move the current program directory aside, restore `tech-hub.previous` to `tech-hub`, and start the service. Back up settings in the web UI before an upgrade.

## Build and verify

CI builds natively on ARM64 and x64 inside Debian 12 using Node 24, Go 1.26 and Python/PyInstaller. Run `bash scripts/build-linux.sh` after building the universal packages. CI must pass the packaged startup/access/shutdown smoke test on each architecture. These checks verify software behavior with empty device inventories; they do not certify physical device operation.
