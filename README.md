# Tech Hub

One desktop application for **D’san Ready**, **Lux Link**, **Power Monitor**, **NETGEAR AV Switchboard**, **Record Monitor**, and **Router Panel**. Tech Hub runs all six services and provides a local master page with their status, ports, and shareable network URLs.

## Downloads

Current desktop release: **0.5.0**. See the [changelog](CHANGELOG.md) for app switching, live settings, backups, diagnostics, and startup update notifications.

### Companion module

**[Download the offline Companion module — v1.0.3](https://github.com/horner516/Tech-Hub/releases/download/companion-v1.0.3/streamline-techhub-1.0.3.tgz)**

Requires **Companion 5.0+**. On the Companion computer, open **Modules → Import module package** and select the .tgz without extracting it. Add **Streamline Tech Hub**, enter the Tech Hub computer’s **IP address or hostname** and the **D’san public port** shown on the master page, plus its service password if set.

Nine ready-made presets provide minutes, seconds, a combined clock, all four Limitimer program clocks, and PerfectCue arrows. Next lights green; Previous lights red. Arrow flashing, display time, text, and size are configurable. Arrow presets default to a larger size of 72. Placed buttons remain editable in Companion. The module works over the local network without internet or another Tech Hub port.

[Full setup, variables, and customization guide](companion-module-streamline-techhub/companion/HELP.md) · [Module source](companion-module-streamline-techhub)

### Windows

**[Download Tech Hub for Windows — x64](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-Windows-x64-Setup.exe)**

Windows 10 (1809+) or Windows 11, x64. Run the installer, then open Tech Hub from Start. The **TH** system-tray menu provides **Open Control Page**, **Check for Updates**, **Open Logs**, and **Quit Tech Hub**. Double-click TH to open the control page. There is no floating widget or Windows Widgets-board integration. The app includes its runtimes and does not require a separate .NET installation.

The Windows installer installs for the current user and preserves settings during upgrades/uninstall. It is unsigned. On trusted show networks, allow the bundled Node runtime through Windows Firewall when sharing dashboards; the installer does not change firewall settings.

### Mac

**[Download Tech Hub for macOS — Apple silicon](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg)**

[Release notes and all downloads](https://github.com/horner516/Tech-Hub/releases/latest) · [SHA-256 checksum](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg.sha256)

Requires **macOS 13 or later on an Apple silicon Mac (M1 or later)**. Intel Macs are not supported by this installer. Python, Node.js, and the Power Monitor binary are bundled; no development tools are needed to run it.

1. Open the DMG and drag **Tech Hub** into **Applications**.
2. Open Tech Hub. Click **TH** in the menu bar, then **Open Master Page**.
3. Add your devices in each service. New installations start with empty device lists.
4. Copy the service’s network URL from the master page to share with your crew.

This initial build is **ad-hoc signed, not Apple Developer ID signed or notarized**. macOS may require **System Settings → Privacy & Security → Open Anyway** on first launch. See [installation details](INSTALL.md).

## Dashboard ports

| Application | Default URL on the host computer | Availability |
| --- | --- | --- |
| Master page | `http://127.0.0.1:8700` | Admin, this computer only |
| D’san Ready | `http://127.0.0.1:8701` | Limitimer, PerfectCue, full-screen view at `/full` |
| Lux Link | `http://127.0.0.1:8702` | Lighting devices, sACN and Art-Net monitoring |
| Power Monitor | `http://127.0.0.1:8703` | Power devices, phases, services, and alerts |
| NETGEAR AV Switchboard | `http://127.0.0.1:8704` | SNMPv3 switch discovery, ports, VLAN monitoring, topology |
| Record Monitor | `http://127.0.0.1:8705` | HyperDeck and AJA Ki Pro status and transport controls |
| Router Panel | `http://127.0.0.1:8706` | Ross Ultrix (SW-P-08) and Blackmagic Videohub routing, profiles, and live crosspoints |

### Configure the new services

Use **Configure switches** on the NETGEAR card to enter the management subnet and SNMPv3 credentials. Setup stays local to the host computer. The collector and dashboard share the service port; no separate port 8787 is needed. VLAN/profile assignment remains read-only.

Use **Configure** on Record Monitor to edit its JSON settings. Add entries to `devices`, for example `{"name":"Recorder","type":"hyperdeck","host":"192.168.1.50"}`. Use `kipro` for AJA units. Recording controls default to the host computer only (`controlLocalOnly`); disk formatting is disabled (`allowFormat: false`). Saving restarts only Record Monitor. See its [device options](services/record/README.md).

Use **Configure routers** on Router Panel (formerly Ultrix Panel) to open its settings page. Like the NETGEAR setup page, it opens only on the Tech Hub computer. Save one or more routers, choose the type (**Ross Ultrix / SW-P-08** or **Blackmagic Videohub**), enter the address and port, and choose which router is **active**. Only the active router connects. Each saved router keeps its own levels, sources, destinations, categories, name overrides and access profiles. Switching the active router reconnects the panel with that router's setup. A blank address keeps a router disconnected. A Videohub has one level. Categories show a live preview of how the active router's names will be grouped. Existing Ultrix Panel settings are upgraded to one saved router automatically. See the [Router Panel configuration guide](services/ultrix/README.md). Facility configuration and exported router names are not included in public downloads.

All six services use the same port-conflict avoidance, password gates, logs, and individual restart controls. Existing Tech Hub ports and passwords survive upgrades. Power Monitor runs without a separate Windows tray icon when launched by Tech Hub; the standalone Power Monitor app retains its own tray.

See [third-party notices and source attribution](THIRD_PARTY.md).

For another computer, replace `127.0.0.1` with the Tech Hub computer’s LAN IP. The master page lists each available IPv4 network address and offers a Copy button. The service pages do not include navigation to the other services or master page.

At startup, Tech Hub tries each saved TCP port. If another application occupies it, Tech Hub binds an available replacement and saves it for future launches. This applies to the master page, service URLs, and internal web servers. The master page and desktop menus follow the actual assignments. Check the master page for updated URLs after a conflict; previously shared URLs may change. Lighting protocol UDP ports remain fixed.

## Power device discovery

Open **Power Monitor → Manage devices → Discover network devices**. Enter one private IP address to inspect that device, or an explicit `/24` or `/23` range to find compatible DKM-411 meters. A bare IP inspects only that address.

Results show identity, checked/open TCP ports, a validated HTTP live-feed address, and sample power readings. For recognized DKM-411 devices, discovery validates the complete required measurement set using read-only Modbus requests on port 502, unit ID 1. It never changes device registers. A successful connection alone is labeled as an open port, not proof of a working protocol. Other Modbus unit IDs are not automatically tried.

**Add** is enabled only when the web identity matches a DKM-411 and all required Modbus readings validate. Choose **Add**, then **Save changes**, to start monitoring a verified result. Discovery does not automatically add devices. Discovered units use Modbus TCP as their primary polling source, with the HTTP live feed as a fallback. The dashboard and diagnostics show the active source. If both sources fail, readings are marked offline/stale rather than presented as new data.

Existing devices default to **Auto**: the first successful web check identifies DKM-411 meters, then subsequent cycles prefer Modbus. Other devices remain on HTTP. In the device editor, choose **DKM-411 Modbus + web fallback**, **Auto**, or **Web feed only**, and set the Modbus port and unit ID. The DKM-411 register map is model-specific; do not select it for unrelated meters.

New installations poll every second. Existing refresh settings are preserved; select **1 second** under Auto refresh if desired. Each cycle reads the phase/neutral currents, voltages, frequency, power, power factor, and demand registers. Cycles never overlap and may take longer on a slow or unresponsive meter. No Modbus write functions are used.

Single-IP inspection checks TCP ports 21, 22, 23, 53, 80, 81, 443, 502, 8080, 8081, 8443, and 10001. Network discovery checks HTTP 80 and TCP 502 on matching devices. These are bounded checks, not an exhaustive port scan; UDP/SNMP and alternative web-port fingerprints are not included.

## Access control

The master page listens only on loopback and validates the request host. It cannot be opened by other computers on the LAN.

Each service has an optional, independent password, configured using **Set password** on its master-page card. Use different passwords for different crews. Password changes sign out existing viewers of that service. Passwords are stored as salted scrypt hashes, and sessions expire after 12 hours or when Tech Hub exits. All service pages and APIs pass through that service’s access gate.

New installs allow access without a password until configured. **Separate URLs and ports are not authorization by themselves.** Anyone on the same network can try another port. Set service passwords when visibility must be restricted. These are HTTP interfaces: traffic and passwords are not encrypted in transit. Use a trusted show LAN; use an HTTPS gateway or VPN for untrusted networks.

The underlying servers listen only on `127.0.0.1` (default ports `18701–18706`); remote clients cannot bypass the service gateways. Local users of the host computer can reach those internal servers and are trusted administrators. A service password grants access to that service’s existing controls, not a new read-only role. Ultrix additionally supports its own viewer profiles and PINs. Set service passwords in Tech Hub; D’san’s inherited standalone network-auth setting is not used behind Tech Hub’s loopback gateway.

## Data, updates, and troubleshooting

Use the dropdown at the top left of any service dashboard to switch directly to another enabled app. It keeps the current server hostname and uses each service's actual assigned port. Password-protected apps still require their own password. The master page appears in the switcher only on the Tech Hub computer; D’san's full-screen presentation view hides the shared header.

The master page's **Service enabled** switches stop and start individual apps. Disabled apps retain their configuration and disappear from the dropdown; this choice is saved for the next launch. Their public gateway stays available to show an “off” page, but their monitoring/control process is stopped.

**Record Monitor** and **Router Panel** have an in-app **Settings** button when opened locally on the Tech Hub computer. Record Monitor opens its recorder setup, polling and control options. Router Panel opens its settings page (`/setup`) for saved routers, levels, categories, labels, visibility and profiles. Both apply settings live: only affected recorder connections, a changed router connection or a different active router reconnect. Saving never sends recording start/stop commands or router takes. Record Monitor uses red accents and Router Panel uses blue accents. These settings forms and the master configuration editor warn before discarding edits and reject saves from a window whose configuration has changed elsewhere.

The master page's **Backup & troubleshooting** section exports password-encrypted configuration backups and restores them on the Tech Hub computer. Keep the export passphrase: it cannot be recovered. Automatic local snapshots retain the last ten distinct saved configurations; they contain credentials and are restricted to the local account. Backups cover the hub configuration and the six services' saved configuration files, not logs or browser-local layouts. Restoring stops services; quit and reopen Tech Hub to load the restored configuration.

**Troubleshooting** reports service health, data freshness and recent service errors. Its downloadable diagnostic report excludes device names, addresses, credentials and raw logs. Record Monitor marks data stale even when a status request stalls, and prevents overlapping browser polls. Service recovery and sign-in pages retain the app switcher.

Settings live in `~/Library/Application Support/Tech Hub/` on Mac and `%LOCALAPPDATA%\Streamline\Tech Hub\` on Windows:

- `config.json`: public ports, internal ports, bind host, and service password hashes.
- `dsan/`, `lux/`, `power/`: each service’s own saved configuration.
- `logs/`: the hub and service logs.

Use the TH menu to open configuration or logs. To change ports, quit Tech Hub, edit `config.json`, and reopen it. All seven ports must be unique integers between 1024 and 65535. Set `host` to `127.0.0.1` for local-only service access or `0.0.0.0` for LAN access.

Tech Hub checks GitHub for a newer desktop release at startup without delaying the services. When an update is available, the Mac app shows a notice and Windows shows a tray notification. Open **Check for Updates** in the TH menu or the **Tech Hub updates** section of the master page to see the installed and available versions and release notes for every newer version. Checks require internet access; offline operation of the services is unaffected. Companion-only releases and previews are excluded. Updates are downloaded and installed manually.

Quit Tech Hub before replacing it. Saved configuration survives updates. The original standalone apps and their saved settings are left separate; Tech Hub does not automatically import them. Stop a standalone Lux Link instance when using Tech Hub to avoid competing for lighting protocol UDP ports (sACN 5568 and Art-Net 6454).

Tech Hub runs while its menu-bar or system-tray app is open. It does not install a system daemon or enable login startup. Quitting the app stops its child services. Startup failures appear in the master page and logs. Network status indicates that a web service is running, not that physical show devices have been validated.

## Build from source

On an Apple silicon Mac with Xcode Command Line Tools, Node.js 22 or later, Go 1.26, and Python 3.12:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
cd services/lux
pnpm install --frozen-lockfile
cd ../..
pnpm --dir services/netgear install --frozen-lockfile
PYTHON_BINARY="$PWD/.venv/bin/python" bash scripts/build-mac.sh
```

The build creates `dist/Tech Hub.app`, `dist/Tech-Hub-macOS-arm64.dmg`, and its checksum. Set `NODE_BINARY` or `GO_BINARY` to override compiler/runtime paths. The source includes the six applications and their regression tests; their individual documentation remains under `services/`.

```sh
node --test tests/*.test.cjs
go -C services/power test ./...
.venv/bin/python -m unittest discover -s services/dsan -p 'test_*.py'
cd services/lux && node --test tests/*.test.cjs tests/*.test.mjs
```

### Windows build

On Windows x64, install Node.js 24, Go 1.26, Python 3.12, .NET SDK 10, pnpm 11.19, and Inno Setup 6. Then run:

```powershell
python -m pip install -r requirements-build.txt
pnpm --dir services/lux install --frozen-lockfile
pnpm --dir services/netgear install --frozen-lockfile
./scripts/build-windows.ps1
```

GitHub Actions builds and smoke-tests both platforms. A `v*` tag publishes both installers together after both builds pass. Windows host tests verify tray-only startup and process cleanup. The installer is `dist/Tech-Hub-Windows-x64-Setup.exe`.

## Source origins

Integrated from the user’s existing D’san Master View 0.3.3, Lux Link 0.4.0 workspace, and Power Monitor 2.10.0 sources. Tech Hub adds orchestration, per-service access gates, a native Mac menu-bar host, isolated storage, and combined packaging. Lux Link’s grandMA Web Remote screen reader uses macOS APIs and is Mac-only; Windows still reports console reachability and lighting-network traffic. The standalone D’san floating desktop widgets are not included; its browser dashboard and full-screen display are included. Device behavior still depends on the hardware, network interface, and permissions available on the host Mac.

### PerfectCue display settings

In D’san Ready → Settings → PerfectCue, set **Display time (seconds)** (0.1–60) and **Flash on multiple clicks**. Each click restarts the display time. Flashing applies to repeated clicks in the same direction while the arrow is lit. Settings apply to the dashboard, mobile view, and full-screen display. Existing installations default to two seconds with flashing enabled.
