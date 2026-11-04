# Tech Hub

One desktop application for **D’san Ready**, **Power Monitor**, **NETGEAR AV Switchboard**, **Record Monitor**, **Router Panel**, **Lux Link**, **Pixel Peeker**, **Otter EDID Editor**, and **R-Too** for d&b amplifier monitoring. Install only the modules you need. The Full download includes all nine modules, including R-Too. Tech Hub provides a local master page with their status, ports, and shareable network URLs.

## Downloads

The next build, **1.0.4**, restores Lux Link, adds Pixel Peeker and Otter EDID Editor, incorporates DeVore’s NETGEAR 1.1.0 improvements, and simplifies setup, device status and sharing. Universal packages and the shared host runtime remain supported. Published downloads below remain on the latest released build until 1.0.4 ships. See the [changelog](CHANGELOG.md).

### Full w/all modules

Tech Hub with all nine modules included for offline installation.

- [Mac — Apple silicon](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64-Full.dmg)
- [Windows — x64](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-Windows-x64-Full-Setup.exe)

### Lite Installer

Tech Hub host and shared runtime. Choose and download modules from the Module Library after installation.

- [Mac — Apple silicon](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg)
- [Windows — x64](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-Windows-x64-Setup.exe)

### Modules

Universal packages for Mac and Windows.

- **[Download bundled modules — offline ZIP](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-All-Apps.zip)**
- **[Download R-Too 1.0.0 — Mac and Windows](https://github.com/horner516/Tech-Hub/releases/download/rtoo-v1.0.0/techhub-app-rtoo-1.0.0-universal.zip)** · [Installation instructions](#r-too--new-module)
- [Individual module downloads](https://github.com/horner516/Tech-Hub/releases/latest)
- [Download Developer SDK](https://github.com/horner516/Tech-Hub/releases/download/sdk-v1.1.0/Tech-Hub-SDK.zip)
- [AI tools — development instructions and starter prompts](sdk/AI-DEVELOPMENT.md)
- [SDK documentation and shared-runtime guide](sdk/SHARED-RUNTIME.md)


Open **Module Library** in the master page to install individual modules, **Install selected**, or **Install all modules**. Full installers unpack their included modules on first launch. To use an all-modules ZIP, choose **Module Library → Offline installation → Install offline bundle**. The ZIP must match the official catalog shipped with the host or a refreshed catalog. Do not extract it first. All installed modules remain available offline.

Upgrading from 0.x retains service settings, passwords, and ports. The Host installer offers **Install previously enabled modules**; the Full installer includes all modules and respects saved enabled/disabled settings. Once a module is installed, its service slider controls whether it runs and appears in shared navigation. Module updates and rollback are separate from host updates. Uninstall removes module files while retaining settings. A newly added third-party module requires reopening Tech Hub once; the nine bundled modules activate immediately.

### Browse and submit modules

**Browse modules** is available inside Module Library: search by name, purpose or developer and filter available, installed or updatable modules. **Check for updates** refreshes the reviewed catalog, including newly approved modules. Choose **Install** on a module card; reopen Tech Hub after installing a new module ID on current hosts.

Developers: [Submit a module](https://github.com/horner516/Tech-Hub/issues/new?template=module-submission.yml) · [Submission and review process](sdk/SUBMITTING.md). Approved modules can be published in a catalog-only release without rebuilding desktop installers. Local ZIP installation remains available for testing and private modules.

### Module versions and updates

Each module package includes its own `version` and `minHostVersion` in `techhub-app.json`. **Module Library → Check for updates** shows installed and catalog versions, the last successful check, and updates requiring a newer host. Use **Update** for one module or **Update all** for compatible official updates. Checking does not install anything. Unofficial modules are updated by importing a newer package from their developer.

Host updates remain separate. D’san and Power Monitor native engine changes still require a host update.

### Universal modules and shared runtime

One module ZIP now works on both supported platforms. Tech Hub supplies Node 24, settings helpers, ports, logging and supervision. D’san and Power Monitor retain their tested native protocol engines as host-managed drivers; they have not been rewritten into JavaScript. Their UI packages are universal, while engine changes require a host update. NETGEAR AV Switchboard, Record Monitor, Router Panel, and R-Too run on shared Node. The Mac and Windows host installers remain platform-specific.

Existing v1.0.0 modules continue to work (including restored Lux Link on host 1.0.4+); use Module Library to update them to universal v1.0.1 packages. Settings, passwords and ports are retained. Lux Link returns to the catalog, navigation and Full installers in 1.0.4; existing devices, passwords, ports and enabled settings are retained. Its universal package uses the shared Node runtime. MA Web Remote screen reading uses a host-supplied macOS helper; Windows still supports network monitoring and device polling without that helper. Lux inventory edits, discovery, node changes and transmission require Tech Hub administrator access.

### Develop a module

[Download the SDK](https://github.com/horner516/Tech-Hub/releases/download/sdk-v1.1.0/Tech-Hub-SDK.zip) · [SDK documentation](sdk/README.md) · [AI development instructions](sdk/AI-DEVELOPMENT.md) · [Design guide](sdk/DESIGN.md)

The SDK source now includes a [compact AI starting guide](sdk/AI-START.md) and a [standalone development CLI](sdk/README.md#fast-path-for-ai-assisted-development) for scaffolding, JSON diagnostics, temporary local previews and packaging. Available now in SDK **1.1.0**, independently of the host installer.

The SDK includes a [shared-runtime guide](sdk/SHARED-RUNTIME.md), a working starter module, manifest validator, package builder, visual conventions, and prompts/checklists for developers using AI tools. **Testing outside the catalog:** open **Module Library → Testing & evaluation**, choose a module ZIP, review its details, and confirm installation. Unofficial modules are clearly labeled and support manual updates, rollback, and uninstall with settings retained. Use a unique module ID; local packages cannot overwrite official modules. Reopen Tech Hub once to load a newly added module. Module submissions are reviewed before inclusion in the official catalog. Modules run as the signed-in user; permission declarations are not an OS sandbox.

### R-Too — new module

Read-only d&b amplifier monitoring based on [Devore’s D80-Panel](https://github.com/davidadevore/D80-Panel): fleet status, input/output meters, channel details, and fault acknowledgement.

[Download R-Too 1.0.0](https://github.com/horner516/Tech-Hub/releases/download/rtoo-v1.0.0/techhub-app-rtoo-1.0.0-universal.zip) · [Setup and source](services/rtoo/README.md)

On older Tech Hub 1.0.1/1.0.2 installations, import the ZIP through **Module Library → Testing & evaluation**, then reopen Tech Hub. The imported module is labeled unofficial because it was installed manually. Open **R-Too → Settings** to enable discovery or enter amplifier addresses. No amplifier connections are made by default. In v1.0.3, R-Too is available in Module Library and included with Full installers. If you previously imported R-Too manually, uninstall that module before installing its catalog version; saved settings are retained.

### Pixel Peeker and Otter EDID Editor — next build

Both are universal offline modules in host 1.0.4 and the Full installer. **Pixel Peeker** designs LED walls, checks processor/port capacity, and exports reports and layouts. **Otter EDID Editor** builds, inspects and exports EDIDs, including tiled mosaic EDIDs. Their calculations and files remain in the browser; the host only serves their assets. Save/export work before clearing browser data or moving to another hostname, browser or port. Browser storage is separate for each origin; importing a module does not migrate projects from the hosted website.

Their upstream hardware/export caveats remain in each app and README. Sources, licenses and pinned upstream commits are retained under `services/pixel-peeker` and `services/otter-edid-editor`.

### Home page and setup

The home page counts running modules against enabled installed modules, and shows a separate device-health summary. Unknown readings are labeled unverified; a running module alone does not prove devices are connected. Browser tools are labeled separately because they do not monitor devices. Setup shortcuts open each module’s existing device/settings UI. The recommended crew URL stays visible; additional addresses, passwords and restart controls are under **Other addresses & maintenance**.

NETGEAR 1.1.0 incorporates the DevoreClaude branch’s staggered polling, endpoint naming and PIN-gated AV profile changes. Editing stays disabled until configured in NETGEAR settings. Stacked switches and protected ports remain locked. No real switch writes were used for integration testing.

Record Monitor’s setup redesign is deferred until recorders are available for testing.

### Companion module

**[Download the offline Companion module — v1.0.3](https://github.com/horner516/Tech-Hub/releases/download/companion-v1.0.3/streamline-techhub-1.0.3.tgz)**

Requires **Companion 5.0+**. On the Companion computer, open **Modules → Import module package** and select the .tgz without extracting it. Add **Streamline Tech Hub**, enter the Tech Hub computer’s **IP address or hostname** and the **D’san public port** shown on the master page, plus its service password if set.

Nine ready-made presets provide minutes, seconds, a combined clock, all four Limitimer program clocks, and PerfectCue arrows. Next lights green; Previous lights red. Arrow flashing, display time, text, and size are configurable. Arrow presets default to a larger size of 72. Placed buttons remain editable in Companion. The module works over the local network without internet or another Tech Hub port.

[Full setup, variables, and customization guide](companion-module-streamline-techhub/companion/HELP.md) · [Module source](companion-module-streamline-techhub)

### Windows

**[Download Tech Hub for Windows — x64](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-Windows-x64-Setup.exe)**

Windows 10 (1809+) or Windows 11, x64. Run the installer, then open Tech Hub from Start. The **TH** system-tray menu provides **Open Control Page**, **Check for Updates**, **Open Logs**, and **Quit Tech Hub**. Double-click TH to open the control page. There is no floating widget or Windows Widgets-board integration. The module includes its runtimes and does not require a separate .NET installation.

The Windows installer installs for the current user and preserves settings during upgrades/uninstall. It is unsigned. On trusted show networks, allow the bundled Node runtime through Windows Firewall when sharing dashboards; the installer does not change firewall settings.

### Mac

**[Download Tech Hub for macOS — Apple silicon](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg)**

[Release notes and all downloads](https://github.com/horner516/Tech-Hub/releases/latest) · [SHA-256 checksum](https://github.com/horner516/Tech-Hub/releases/latest/download/Tech-Hub-macOS-arm64.dmg.sha256)

Requires **macOS 13 or later on an Apple silicon Mac (M1 or later)**. Intel Macs are not supported by this installer. Node.js and the D’san/Power compatibility engines are included in the host; universal module packages contain their code and assets; no development tools are needed to run it.

1. Open the DMG and drag **Tech Hub** into **Applications**.
2. Open Tech Hub. Click **TH** in the menu bar, then **Open Master Page**.
3. Open Module Library to install selected modules (or use the Full installer), then add your devices in each service. New installations start with empty device lists.
4. Copy the service’s network URL from the master page to share with your crew.

This initial build is **ad-hoc signed, not Apple Developer ID signed or notarized**. macOS may require **System Settings → Privacy & Security → Open Anyway** on first launch. See [installation details](INSTALL.md).

## Settings and connected devices

Open **Settings** in the master page header to edit Local Network Names or enable **Allow administration from other computers on this network**. Remote administration is off by default. Set a separate administrator password of **at least 4 characters**; leave the password field blank to retain an existing password. Save administration access, then share one of the admin addresses shown there (the assigned master port, normally `http://HOST-IP:8700`). With short names enabled, `http://tech.local/admin` redirects to the administrator sign-in page. Custom directory names and machine identifiers also apply.

Signed-in administrators can manage services, access passwords, configuration, backups, diagnostics and network names. Open service settings from the master page links to retain the administrator session on the same hostname. Sessions last one hour; changing the administrator password or access setting signs out remote administrators. Sign out ends the current browser session. Disabling access takes effect immediately. These HTTP interfaces are for a trusted local network; use a network you control.

**Connected Devices**, to the left of Settings, shows client IP addresses, applications, active page counts and last activity. Browser pages check in every 15 seconds; entries disappear after 60 seconds without activity, or when their service is disabled. This is an activity list, not a network scan: browsers can suspend background pages, clients can share an IP, and non-browser API clients are not automatically counted. This information is visible only to administrators and is held in memory.

## Dashboard ports

Tech Hub offers short Bonjour/mDNS names: `http://dsan.local`, `http://lux.local`, `http://pd.local`, `http://netgear.local`, `http://record.local`, and `http://router.local`. `http://tech.local` opens a network module directory showing enabled services. Service passwords still apply; the administrative master page opens from the TH menu, with optional network access configured in Settings.

On the master page, **Settings → Local network names → Machine identifier** adds an optional suffix to every name. For example, entering `stage1` produces `dsan-stage1.local`, `tech-stage1.local`, and `pd-stage1.local`. Leave it blank for the shortest names. Under **Service hostnames**, edit each module’s name independently (including the Tech Hub directory). Enter `dsan1` or `dsan1.local`; both produce `dsan1.local` with no machine identifier, or `dsan1-stage1.local` with identifier `stage1`. Names must be distinct within Tech Hub, and each name plus identifier must fit the 63-character DNS label limit. Use a different identifier for each Tech Hub computer on the same network. Identifiers accept up to 32 letters, numbers, and internal hyphens. Saving applies live; existing viewers should reopen the updated links. Name conflicts reported by another mDNS device disable that name and show a warning; choose another identifier or use an IP link. mDNS is not a central name registry, so deliberately assign unique identifiers on shared networks.

**Use addresses without port numbers** enables a shared HTTP listener on TCP port 80. The hostname selects the existing service gateway, preserving its password checks and the client’s actual address. If port 80 is busy or permission is denied, Tech Hub keeps running with hostname-and-port links such as `http://dsan.local:8701`, explains the failure on the master page, and provides a retry button. It does not stop the other application, change firewall rules, or request elevated privileges. The `tech.local` directory is available only when the shared listener is running. Existing IP-and-port links remain available in either mode.

Hostnames work on the same local network where clients support mDNS and multicast UDP 5353 is allowed; TCP 80 must also be reachable for port-free links. VLAN boundaries, guest Wi-Fi isolation, VPNs, and some Windows configurations can prevent resolution. Names are withdrawn when a service is disabled or Tech Hub quits; address changes are refreshed automatically. The chosen identifier is saved in configuration backups—change it after restoring onto a second computer. Use explicit `http://` links; HTTPS is not configured.

| Application | Default URL on the host computer | Availability |
| --- | --- | --- |
| Master page | `http://127.0.0.1:8700` | Admin, local by default |
| D’san Ready | `http://127.0.0.1:8701` | Limitimer, PerfectCue, full-screen view at `/full` |
| Power Monitor | `http://127.0.0.1:8703` | Power devices, phases, services, and alerts |
| NETGEAR AV Switchboard | `http://127.0.0.1:8704` | SNMPv3 switch discovery, ports, VLAN monitoring, topology |
| Record Monitor | `http://127.0.0.1:8705` | HyperDeck and AJA Ki Pro status and transport controls |
| Router Panel | `http://127.0.0.1:8706` | Ross Ultrix (SW-P-08) and Blackmagic Videohub routing, profiles, and live crosspoints |

### Configure the new services

Use **Devices & settings** on the NETGEAR card to enter the management subnet and SNMPv3 credentials. Setup stays local to the host computer. The collector and dashboard share the service port; no separate port 8787 is needed. Optional AV profile changes require a configured edit PIN and switch web credentials. Protected ports remain read-only.

Use **Configure** on Record Monitor to edit its JSON settings. Add entries to `devices`, for example `{"name":"Recorder","type":"hyperdeck","host":"192.168.1.50"}`. Use `kipro` for AJA units. Recording controls default to the host computer only (`controlLocalOnly`); disk formatting is disabled (`allowFormat: false`). Saving restarts only Record Monitor. See its [device options](services/record/README.md).

Use **Configure routers** on Router Panel (formerly Ultrix Panel) to open its settings page. Like the NETGEAR setup page, it opens on the Tech Hub computer or for a signed-in network administrator. Save one or more routers, choose the type (**Ross Ultrix / SW-P-08** or **Blackmagic Videohub**), enter the address and port, and choose which router is **active**. Only the active router connects. Each saved router keeps its own levels, sources, destinations, categories, name overrides and access profiles. Switching the active router reconnects the panel with that router's setup. A blank address keeps a router disconnected. A Videohub has one level. Categories show a live preview of how the active router's names will be grouped. Existing Ultrix Panel settings are upgraded to one saved router automatically. See the [Router Panel configuration guide](services/ultrix/README.md). Facility configuration and exported router names are not included in public downloads.

All nine services use the same port-conflict avoidance, password gates, logs, and individual restart controls. Existing Tech Hub ports and passwords survive upgrades. Power Monitor runs without a separate Windows tray icon when launched by Tech Hub; the standalone Power Monitor module retains its own tray.

See [third-party notices and source attribution](THIRD_PARTY.md).

For another computer, replace `127.0.0.1` with the Tech Hub computer’s LAN IP. The master page lists each available IPv4 network address and offers a Copy button. The service pages do not include navigation to the other services or master page.

At startup, Tech Hub tries each saved TCP port. If another application occupies it, Tech Hub binds an available replacement and saves it for future launches. This applies to the master page, service URLs, and internal web servers. The master page and desktop menus follow the actual assignments. Check the master page for updated URLs after a conflict; previously shared URLs may change. Lighting protocol UDP ports remain fixed.

## Power device discovery

For recorders, open **Record Monitor → Settings → Find HyperDecks** on the Tech Hub computer. Scan one private IP address or a /24 or /23 range. The scan reads TCP 9993 greetings without sending recorder commands; choose **Add**, then **Save settings** to monitor a result. Saved HyperDeck IP addresses are skipped. AJA Ki Pro devices still require manual entry.

Open **Power Monitor → Manage devices → Discover network devices**. Enter one private IP address to inspect that device, or an explicit `/24` or `/23` range to find compatible DKM-411 meters. A bare IP inspects only that address.

Results show identity, checked/open TCP ports, a validated HTTP live-feed address, and sample power readings. For recognized DKM-411 devices, discovery validates the complete required measurement set using read-only Modbus requests on port 502, unit ID 1. It never changes device registers. A successful connection alone is labeled as an open port, not proof of a working protocol. Other Modbus unit IDs are not automatically tried.

**Add** is enabled only when the web identity matches a DKM-411 and all required Modbus readings validate. Choose **Add**, then **Save changes**, to start monitoring a verified result. Discovery does not automatically add devices. Discovered units use Modbus TCP as their primary polling source, with the HTTP live feed as a fallback. The dashboard and diagnostics show the active source. If both sources fail, readings are marked offline/stale rather than presented as new data.

Existing devices default to **Auto**: the first successful web check identifies DKM-411 meters, then subsequent cycles prefer Modbus. Other devices remain on HTTP. In the device editor, choose **DKM-411 Modbus + web fallback**, **Auto**, or **Web feed only**, and set the Modbus port and unit ID. The DKM-411 register map is model-specific; do not select it for unrelated meters.

New installations poll every second. Existing refresh settings are preserved; select **1 second** under Auto refresh if desired. Each cycle reads the phase/neutral currents, voltages, frequency, power, power factor, and demand registers. Cycles never overlap and may take longer on a slow or unresponsive meter. No Modbus write functions are used.

Single-IP inspection checks TCP ports 21, 22, 23, 53, 80, 81, 443, 502, 8080, 8081, 8443, and 10001. Network discovery checks HTTP 80 and TCP 502 on matching devices. These are bounded checks, not an exhaustive port scan; UDP/SNMP and alternative web-port fingerprints are not included.

## Access control

The master page validates the request host and denies network administration by default. When network administration is enabled in Settings, remote requests require an administrator session. The admin listener follows the configured bind address; disabling remote administration denies network access immediately.

Each service has an optional, independent password, configured using **Set password** on its master-page card. Use different passwords for different crews. Password changes sign out existing viewers of that service. Passwords are stored as salted scrypt hashes, and sessions expire after 12 hours or when Tech Hub exits. All service pages and APIs pass through that service’s access gate.

New installs allow access without a password until configured. **Separate URLs and ports are not authorization by themselves.** Anyone on the same network can try another port. Set service passwords when visibility must be restricted. These are HTTP interfaces: traffic and passwords are not encrypted in transit. Use a trusted show LAN; use an HTTPS gateway or VPN for untrusted networks.

The underlying servers listen only on `127.0.0.1` (default ports `18701–18706`); remote clients cannot bypass the service gateways. Local users of the host computer can reach those internal servers and are trusted administrators. A service password grants access to that service’s existing controls, not a new read-only role. Ultrix additionally supports its own viewer profiles and PINs. Set service passwords in Tech Hub; D’san’s inherited standalone network-auth setting is not used behind Tech Hub’s loopback gateway.

## Data, updates, and troubleshooting

Use the dropdown at the top left of any service dashboard to switch directly to another enabled module. When opened through a `.local` name, it uses the destination module’s own hostname and omits port 80. IP and localhost views keep using the assigned service ports. Password-protected modules still require their own password. Signed-in administrators keep the current hostname when switching modules so their administrator session remains available. The master page appears in the switcher for local and signed-in remote administrators; D’san's full-screen presentation view hides the shared header.

The master page's **Service enabled** switches stop and start individual modules. Disabled modules retain their configuration and disappear from the dropdown; this choice is saved for the next launch. Their public gateway stays available to show an “off” page, but their monitoring/control process is stopped.

**Record Monitor** and **Router Panel** have an in-module **Settings** button when opened locally on the Tech Hub computer. Record Monitor opens its recorder setup, polling and control options. Router Panel opens its settings page (`/setup`) for saved routers, levels, categories, labels, visibility and profiles. Both apply settings live: only affected recorder connections, a changed router connection or a different active router reconnect. Saving never sends recording start/stop commands or router takes. Record Monitor uses red accents and Router Panel uses blue accents. These settings forms and the master configuration editor warn before discarding edits and reject saves from a window whose configuration has changed elsewhere.

The master page's **Backup & troubleshooting** section exports password-encrypted configuration backups and restores them on the Tech Hub computer. Keep the export passphrase: it cannot be recovered. Automatic local snapshots retain the last ten distinct saved configurations; they contain credentials and are restricted to the local account. Backups cover the hub configuration and the active services’ saved configuration files and retained Lux settings, not logs or browser-local layouts. Restoring stops services; quit and reopen Tech Hub to load the restored configuration.

**Troubleshooting** reports service health, data freshness and recent service errors. Its downloadable diagnostic report excludes device names, addresses, credentials and raw logs. Record Monitor marks data stale even when a status request stalls, and prevents overlapping browser polls. Service recovery and sign-in pages retain the module switcher.

Settings live in `~/Library/Application Support/Tech Hub/` on Mac and `%LOCALAPPDATA%\Streamline\Tech Hub\` on Windows:

- `config.json`: public ports, internal ports, bind host, and service password hashes.
- `dsan/`, `lux/`, `power/`: each service’s own saved configuration.
- `logs/`: the hub and service logs.

Use the TH menu to open configuration or logs. To change ports, quit Tech Hub, edit `config.json`, and reopen it. All admin, public and internal ports must be unique integers between 1024 and 65535. Set `host` to `127.0.0.1` for local-only service access or `0.0.0.0` for LAN access.

Tech Hub checks GitHub for a newer desktop release at startup without delaying the services. When an update is available, the Mac module shows a notice and Windows shows a tray notification. Open **Check for Updates** in the TH menu or the **Tech Hub updates** section of the master page to see the installed and available versions and release notes for every newer version. Checks require internet access; offline operation of the services is unaffected. Companion-only releases and previews are excluded. Updates are downloaded and installed manually.

Quit Tech Hub before replacing it. Saved configuration survives updates. The original standalone modules and their saved settings are left separate; Tech Hub does not automatically import them.

Tech Hub runs while its menu-bar or system-tray module is open. It does not install a system daemon or enable login startup. Quitting the module stops its child services. Startup failures appear in the master page and logs. Network status indicates that a web service is running, not that physical show devices have been validated.

## Build from source

On an Apple silicon Mac with Xcode Command Line Tools, Node.js 22 or later, Go 1.26, and Python 3.12:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-build.txt
pnpm install --frozen-lockfile
pnpm --dir services/netgear install --frozen-lockfile
pnpm --dir services/lux install --frozen-lockfile
pnpm --dir services/pixel-peeker install --frozen-lockfile
pnpm --dir services/otter-edid-editor install --frozen-lockfile
PYTHON_BINARY="$PWD/.venv/bin/python" bash scripts/build-mac.sh
```

The build creates `dist/Tech Hub.app`, `dist/Tech-Hub-macOS-arm64.dmg`, and its checksum. Set `NODE_BINARY` or `GO_BINARY` to override compiler/runtime paths. The next build includes nine active modules and their regression tests; their individual documentation remains under `services/`.

```sh
node --test tests/*.test.cjs
go -C services/power test ./...
.venv/bin/python -m unittest discover -s services/dsan -p 'test_*.py'
```

### Windows build

On Windows x64, install Node.js 24, Go 1.26, Python 3.12, .NET SDK 10, pnpm 11.19, and Inno Setup 6. Then run:

```powershell
python -m pip install -r requirements-build.txt
pnpm install --frozen-lockfile
pnpm --dir services/netgear install --frozen-lockfile
pnpm --dir services/lux install --frozen-lockfile
pnpm --dir services/pixel-peeker install --frozen-lockfile
pnpm --dir services/otter-edid-editor install --frozen-lockfile
./scripts/build-windows.ps1
```

GitHub Actions builds and smoke-tests both platforms. A `v*` tag publishes both installers together after both builds pass. Windows host tests verify tray-only startup and process cleanup. The installer is `dist/Tech-Hub-Windows-x64-Setup.exe`.

## Source origins

Integrated from the user’s existing D’san Master View 0.3.3, Lux Link 0.4.0 workspace, and Power Monitor 2.10.0 sources. Tech Hub adds orchestration, per-service access gates, a native Mac menu-bar host, isolated storage, and combined packaging. Lux Link was paused in v1.0.1–1.0.3 and returns in v1.0.4. The standalone D’san floating desktop widgets are not included; its browser dashboard and full-screen display are included. Device behavior still depends on the hardware, network interface, and permissions available on the host Mac.

### PerfectCue display settings

In D’san Ready → Settings → PerfectCue, set **Display time (seconds)** (0.1–60) and **Flash on multiple clicks**. Each click restarts the display time. Flashing applies to repeated clicks in the same direction while the arrow is lit. Settings apply to the dashboard, mobile view, and full-screen display. Existing installations default to two seconds with flashing enabled.

### Linux / Raspberry Pi — next build

Linux ARM64 and x64 Full/Lite installers are being added for 1.0.4. See [Linux installation, headless setup and limitations](LINUX.md). The same nine universal module packages work across supported hosts. Linux downloads will appear in the release after both native build jobs pass.
