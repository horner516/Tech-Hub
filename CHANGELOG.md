# Changelog

## Unreleased

- Add Linux ARM64 (Raspberry Pi 64-bit) and x64 Full/Lite packaging, a systemd user service and desktop shortcut. Accept universal modules on Linux, use XDG persistent storage, and correct Lux Linux ping timeout units. Add native Linux CI and packaged offline startup/access/shutdown checks.

- Add Pixel Peeker and Otter EDID Editor as universal offline browser-tool modules with pinned source, retained MIT notices, local asset serving and no upload endpoint. Managed builds avoid PWA caches bypassing host lifecycle/access controls.
- Incorporate the DevoreClaude branch’s NETGEAR 1.1.0 AV profile editing, scheduling, endpoint identification, isolated edit cookies and Mac DMG retry handling. Keep Lux and subsequent local changes; do not import unrelated Claude workflow files.
- Add device-health summaries (including explicit unknown/tool states), common setup shortcuts and recommended crew links. Put technical/maintenance controls in expandable sections and preserve remote-administrator dashboard addresses. Defer Record Monitor setup changes pending hardware.

- Restore Lux Link as a universal module for host 1.0.4, with catalog/offline installation, navigation, retained device data and administrator-only inventory/discovery/output changes. Bundle the MA Web Remote reader in the Mac host.
- Add a first-launch module chooser, count only enabled installed modules in the running summary, hide developer/offline tools behind expandable sections, and prevent keyboard activation of unavailable dashboards.

- Add a compact AI SDK starting guide, per-module brief/agent scaffolding, and standalone development CLI with context, structured checks, isolated-data administrator/viewer previews and packaging. Full host integration still requires real Tech Hub testing.


## 1.0.3 — 2026-10-06

- Add searchable module browsing with availability/installation/update filters, optional developer attribution and source links. Add a GitHub developer submission form, review/publishing guide, and an offline catalog validation tool for publishing approved modules without a new host installer.

- Add R-Too 1.0.0, a universal, read-only d&b amplifier monitoring module based on Devore’s D80-Panel. Includes fleet/meters/detail views, portable OCA discovery, live settings, manual addresses, administrator-only fault acknowledgements, reconnect handling and stale-data warnings. The standalone package can be imported into Tech Hub 1.0.1+; included in the catalog and Full installers.

## 1.0.2 — 2026-10-06

- Move the connection-status and version bar directly below the page footer.

- Rename installable apps to modules throughout the host interface and SDK documentation; retain existing package and API names for compatibility.
- Show module versions on dashboard cards and installed/catalog versions in Module Library. Add Check for updates, Update all, last-checked time, and incompatible-update guidance.
- Keep official module versions independent of host versions in modules.json. Avoid implicit downgrades from older catalogs; unofficial modules remain manually updated.

## 1.0.1 — 2026-10-06

- One universal app package per service, usable on Mac and Windows, plus a single **Tech-Hub-All-Apps.zip** offline download.
- Shared host runtime: Node 24 and versioned SDK helpers for persistent settings, bounded JSON requests, administrator checks, and HTTP startup.
- D’san and Power Monitor use host-managed native compatibility engines. Their tested protocol implementations are retained; UI packages no longer carry platform runtimes. Protocol-engine updates require a host update.
- Lux Link is paused and removed from the catalog, navigation, and new installers. Existing Lux settings and installed package data are retained.
- SDK updated with a universal starter, shared-runtime contract, packaging rules, and detailed instructions for AI-assisted development.
- Existing service ports, passwords and settings are preserved. Legacy v1.0.0 packages remain supported for the five active apps; update them through App Library.

Choose **Host** to install apps from the App Library or **Full** for the five apps included offline. Mac and Windows installers remain separate. The universal ZIP works on either supported host. Protocol engines have not been rewritten; device behavior still depends on your hardware and network.


## 1.0.0 — 2026-10-06

- Modular host with an in-app App Library: install one app, selected apps, or all six official apps.
- Separate Host and Full installers for macOS Apple silicon and Windows x64. Full includes every app for offline setup.
- Platform-specific all-apps ZIP downloads, individual app packages, an official catalog, and SDK download linked in the README.
- App updates, rollback, and uninstall retain settings. Downloads are checksum-verified and validated before activation; failed starts restore the previous package.
- Existing service configuration, passwords, port assignments, and enabled states survive migration. Previously enabled apps can be reinstalled together.
- Shared navigation lists installed, enabled apps. Host updates remain separate from app updates.
- Install local app ZIPs for testing outside the catalog, with a review/confirmation step, unofficial labels, manual updates, rollback, and settings retention.
- Developer SDK with a working Node starter, packaging/validation tools, app contract, design guide, and detailed AI development instructions.

Full installers require no internet to install the included apps. Offline ZIP imports must match a trusted catalog. New third-party catalog apps require reopening the host once after first installation. Installed apps run with the desktop user's permissions; catalog submissions require review.

Mac: macOS 13+, Apple silicon, ad-hoc signed. Windows: Windows 10 1809+/11 x64, unsigned per-user installer. Existing Companion 1.0.3 remains compatible.


## 0.7.1 — 2026-10-06

- Replace the header admin badge with Settings and Connected Devices buttons. Move Local Network Names into Settings, move Updates above Backup & Restore, and remove the dashboard subtitle.
- Add optional password-protected network administration. Administrator passwords accept 4 or more characters; sessions expire after one hour, sign-in attempts are rate-limited, and changing access or the password revokes remote sessions. Remote access starts disabled.
- Add an admin-only Connected Devices view showing active browser page IPs, services, session counts, and last activity. Pages check in every 15 seconds and expire after 60 seconds without activity; no network scan is performed.

## 0.7.0 — 2026-10-06

- Add short LAN names (`dsan.local`, `lux.local`, `pd.local`, `netgear.local`, `record.local`, `router.local`) with a user-entered machine identifier and editable per-service hostnames, including the Tech Hub directory. Accept names with or without `.local` and reject duplicate or invalid hostnames. Advertise enabled services over Bonjour/mDNS, detect reported name conflicts, and withdraw names on disable or shutdown.
- Add an optional shared HTTP port 80 listener for URLs without port numbers, plus a `tech.local` app directory. Preserve service password checks and local-only administration; fall back to assigned ports when port 80 is unavailable. Configure and retry from the master page without restarting services. Update the app switcher to follow each service’s hostname.

## 0.6.0 — 2026-10-01

- Renamed Ultrix Panel to **Router Panel** and added **Blackmagic Videohub** support (Videohub Ethernet Protocol 2.3, TCP 9990) alongside Ross Ultrix / SW-P-08. The Videohub client uses the router's live pushes, pings every 15 seconds, reconnects on a missed acknowledgement, and never sends a change in watch-only mode.
- Router Panel can store several routers; one is active at a time. Each keeps its own levels, lists, categories and profiles. Existing single-router settings are upgraded automatically; the service ID, ports, backups and profile sign-ins are unchanged.
- Added a Router Panel settings page, like NETGEAR's setup page and restricted to the Tech Hub computer. It includes a live category preview from the active router's names and replaces the Ultrix settings forms.
- Restored Router Panel's **Revert** button for the previous route on changed levels, subject to profile permissions, and the fix that reports a busy panel port instead of silently failing.
- Added local HyperDeck discovery from Record Monitor settings using TCP 9993 greetings, with explicit Add and Save controls. AJA devices remain manually configured.
- Added selectable NETGEAR SNMPv3 security levels, including authentication without encryption, and improved trunk-port indicators and tagged-VLAN details.
- Improved D’san full-screen clock fitting and centered the clock when PerfectCue arrows are disabled.

- Replaced service checkboxes with slider switches labeled “Service enabled” and “Service disabled,” with keyboard focus and reduced-motion support.

## 0.5.0 — 2026-09-23

- Added encrypted configuration export/restore, ten automatic local snapshots, and a troubleshooting report that excludes credentials and raw logs.
- Added unsaved-edit warnings and conflicting-save detection to Record Monitor/Ultrix settings and the master configuration editor.
- Replaced Ultrix's in-app JSON editor with validated forms for levels, labels, visibility and profiles. Settings now apply live, reconnecting the router only when necessary.
- Kept app switching available on service recovery and sign-in pages, and fixed Record Monitor stale detection during stalled requests and overlapping polling.

- Record Monitor now applies configuration live, retaining unchanged recorder connections and status. Its settings button is “Save settings”; active recorder commands or formatting must finish before applying changes.

- Added a mobile-friendly app switcher to each service dashboard, using the current computer's assigned ports and retaining service password gates. Full-screen D’san presentation mode stays uncluttered.
- Added persistent service on/off controls to the master page. Disabled services stop, retain their settings, and disappear from the app switcher.
- Added in-app settings for Record Monitor and Ultrix, restricted to the Tech Hub computer. Record Monitor uses red accents; Ultrix uses blue accents in the shared dark style.

- Check for desktop updates on startup without delaying service startup. Show installed/latest versions and the release notes for every skipped version on the master page, with Mac/Windows tray access and a startup update notice.

- Simplified the master-page header to “Tech Hub” and linked its TH favicon directly.

- Added the TH application icon to macOS, Windows, and the Windows installer and system tray.
- Added service-specific browser icons for every dashboard and password screen, plus the TH icon on the master page.

## Companion module 1.0.2 — 2026-09-14

- Enlarged arrow presets to size 72 and hid their top bars to use more button space.
- Added configurable arrow text size, including automatic sizing for longer labels.

## Companion module 1.0.1 — 2026-09-14

- Added an offline Companion 5.0+ package with configurable Tech Hub IP/hostname, D’san port, and service password.
- Added live minutes/seconds variables, nine button presets, editable preset text, and stale-data handling.
- Added green Next and red Previous cue arrows with configurable flashing and display duration.

## 0.3.1 — 2026-09-14

- Added PerfectCue display time in seconds and a Flash on multiple clicks toggle.
- Applied the saved settings to dashboard, mobile, and full-screen arrows; each click restarts the display timer.
- Preserved two-second display and enabled flashing for existing settings.

## 0.3.0 — 2026-09-14

- Added DKM-411 Modbus-first polling, validated register decoding, and HTTP live-feed fallback.
- Added automatic migration for web-identified DKM-411 meters, configurable polling source, Modbus port and unit ID, and reading-source indicators.
- Required complete Modbus measurement validation before discovered PDs can be added.
- Defaulted new installations to one-second non-overlapping polling; preserved existing refresh settings.

## 0.2.2 — 2026-09-14

- Extended Power Monitor discovery with single-IP inspection, /24 and /23 scans, checked/open TCP ports, and live-reading previews.
- Verified DKM-411 low-word-first decoding against live web readings before release.
- Added read-only Modbus validation for recognized DKM-411 devices, with explicit distinction between open ports and verified data.
- Kept discovered devices opt-in through Add and Save changes.

## 0.2.0 — 2026-09-13

- Added a native Windows x64 system-tray app with control-page, updates, and log links.
- Added a per-user Windows installer, bundled runtimes, process-tree cleanup, and cross-platform release builds and smoke tests.

- Made password controls easier to find with explicit Set password buttons.

- Automatically selected and saved available TCP ports when master, service, or internal web ports are occupied. Updated Mac menu discovery to follow the active hub’s actual master port.

- Matched Tech Hub’s master page and service sign-in screens to Streamline’s orange, dark backgrounds, and white text; kept green, amber, and red for operational status.

- Fixed the D’san countdown colon rendering to the right of its centered slot, including the disconnected `--:--` view. Kept separator spacing fixed in full-screen, desktop, and mobile displays.

## 0.1.0 — 2026-09-08

- Introduced Tech Hub as a native Apple silicon Mac menu-bar app.
- Bundled D’san Ready, Lux Link, and Power Monitor, with independent web ports.
- Added a local master page with live service status, ports, copyable LAN URLs, and password controls.
- Added separate service authentication, protected loopback-only backends, port-conflict reporting, and coordinated shutdown.
- Kept configuration outside the app bundle and used empty defaults for new installations.
- Added a self-contained Mac DMG build with checksum and installation instructions.
