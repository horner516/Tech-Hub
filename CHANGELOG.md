# Changelog

## Unreleased

- Renamed Ultrix Panel to **Router Panel** and added **Blackmagic Videohub** support (Videohub Ethernet Protocol 2.3, TCP 9990) alongside Ross Ultrix / SW-P-08. The Videohub client uses the router's live pushes, pings every 15 seconds, reconnects on a missed acknowledgement, and never sends a change in watch-only mode.
- Router Panel can store several routers; one is active at a time. Each keeps its own levels, lists, categories and profiles. Existing single-router settings are upgraded automatically; the service ID, ports, backups and profile sign-ins are unchanged.
- Added a Router Panel settings page, like NETGEAR's setup page and restricted to the Tech Hub computer. It includes a live category preview from the active router's names and replaces the Ultrix settings forms.
- Restored Router Panel's **Revert** button, which undoes the last change on a destination across all levels, and the fix that reports a busy panel port instead of silently failing.

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
