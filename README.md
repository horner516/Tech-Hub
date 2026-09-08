# Tech Hub

One Mac application for **D’san Ready**, **Lux Link**, and **Power Monitor**. Tech Hub runs all three services and provides a local master page with their status, ports, and shareable network URLs.

## Download for Mac

**[Download Tech Hub for macOS — Apple silicon](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg)**

[Release notes and all downloads](https://github.com/horner516/Tech-Hub/releases/latest) · [SHA-256 checksum](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg.sha256)

Requires **macOS 13 or later on an Apple silicon Mac (M1 or later)**. Intel Macs are not supported by this installer. Python, Node.js, and the Power Monitor binary are bundled; no development tools are needed to run it.

1. Open the DMG and drag **Tech Hub** into **Applications**.
2. Open Tech Hub. Click **TH** in the menu bar, then **Open Master Page**.
3. Add your devices in each service. New installations start with empty device lists.
4. Copy the service’s network URL from the master page to share with your crew.

This initial build is **ad-hoc signed, not Apple Developer ID signed or notarized**. macOS may require **System Settings → Privacy & Security → Open Anyway** on first launch. See [installation details](INSTALL.md).

## Dashboard ports

| Application | Default URL on the host Mac | Availability |
| --- | --- | --- |
| Master page | `http://127.0.0.1:8700` | Admin, this Mac only |
| D’san Ready | `http://127.0.0.1:8701` | Limitimer, PerfectCue, full-screen view at `/full` |
| Lux Link | `http://127.0.0.1:8702` | Lighting devices, sACN and Art-Net monitoring |
| Power Monitor | `http://127.0.0.1:8703` | Power devices, phases, services, and alerts |

For another computer, replace `127.0.0.1` with the Tech Hub Mac’s LAN IP. The master page lists each available IPv4 network address and offers a Copy button. The service pages do not include navigation to the other services or master page.

Ports stay fixed. If a port is occupied, Tech Hub reports the conflict instead of silently moving the service to a different URL. Other services continue running. Quit and reopen Tech Hub after resolving a conflict.

## Access control

The master page listens only on loopback and validates the request host. It cannot be opened by other computers on the LAN.

Each service has an optional, independent password, configured using **Change** on its master-page card. Use different passwords for different crews. Password changes sign out existing viewers of that service. Passwords are stored as salted scrypt hashes, and sessions expire after 12 hours or when Tech Hub exits. All service pages and APIs pass through that service’s access gate.

New installs allow access without a password until configured. **Separate URLs and ports are not authorization by themselves.** Anyone on the same network can try another port. Set service passwords when visibility must be restricted. These are HTTP interfaces: traffic and passwords are not encrypted in transit. Use a trusted show LAN; use an HTTPS gateway or VPN for untrusted networks.

The underlying servers listen only on `127.0.0.1:18701–18703`; remote clients cannot bypass the service gateways. Local users of the Mac can reach those internal servers and are trusted administrators. A service password grants access to that service’s existing controls, not a new read-only role. Set passwords in Tech Hub; D’san’s inherited standalone network-auth setting is not used behind Tech Hub’s loopback gateway.

## Data, updates, and troubleshooting

Settings live in `~/Library/Application Support/Tech Hub/`:

- `config.json`: public ports, internal ports, bind host, and service password hashes.
- `dsan/`, `lux/`, `power/`: each service’s own saved configuration.
- `logs/`: the hub and service logs.

Use the TH menu to open configuration or logs. To change ports, quit Tech Hub, edit `config.json`, and reopen it. All seven ports must be unique integers between 1024 and 65535. Set `host` to `127.0.0.1` for local-only service access or `0.0.0.0` for LAN access.

Use **Downloads & Updates** in the TH menu to download a new complete Tech Hub app. Quit Tech Hub before replacing it. Saved configuration survives updates. The original standalone apps and their saved settings are left separate; Tech Hub does not automatically import them. Stop a standalone Lux Link instance when using Tech Hub to avoid competing for lighting protocol UDP ports (sACN 5568 and Art-Net 6454).

Tech Hub runs while its menu-bar app is open. It does not install a system daemon or enable login startup. Quitting the app stops its child services. Startup failures appear in the master page and logs. Network status indicates that a web service is running, not that physical show devices have been validated.

## Build from source

On an Apple silicon Mac with Xcode Command Line Tools, Node.js 22 or later, Go 1.26, and Python 3.12:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
cd services/lux
pnpm install --frozen-lockfile
cd ../..
PYTHON_BINARY="$PWD/.venv/bin/python" bash scripts/build-mac.sh
```

The build creates `dist/Tech Hub.app`, `dist/Tech-Hub-macOS-arm64.dmg`, and its checksum. Set `NODE_BINARY` or `GO_BINARY` to override compiler/runtime paths. The source includes the three applications and their regression tests; their individual documentation remains under `services/`.

```sh
node --test tests/*.test.cjs
go -C services/power test ./...
.venv/bin/python -m unittest discover -s services/dsan -p 'test_*.py'
cd services/lux && node --test tests/*.test.cjs tests/*.test.mjs
```

## Source origins

Integrated from the user’s existing D’san Master View 0.3.3, Lux Link 0.4.0 workspace, and Power Monitor 2.10.0 sources. Tech Hub adds orchestration, per-service access gates, a native Mac menu-bar host, isolated storage, and combined packaging. The standalone D’san floating desktop widgets are not included; its browser dashboard and full-screen display are included. Device behavior still depends on the hardware, network interface, and permissions available on the host Mac.
