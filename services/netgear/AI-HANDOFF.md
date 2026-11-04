# Netgear Discovery — AI project handoff

## What this project is

Netgear Discovery is a Windows-hosted monitoring dashboard for NETGEAR AV switches. It discovers switches on a configured management subnet with SNMPv3, displays physical port layouts, VLAN colors, connected endpoints, errors, optical receive levels, bandwidth sampling, and LLDP-derived topology links. Multiple client devices open the dashboard served by the Windows computer.

The application intentionally shows **no devices found** when discovery returns nothing. Never restore demo or fake devices as a fallback.

## Runtime architecture

Two local services run together:

- Dashboard: Next.js on TCP port `3000`, normally available to LAN clients.
- Collector/settings server: Node.js in `collector/server.mjs` on TCP port `8787`.
- SNMP: the collector talks directly to switches over SNMPv3/UDP port `161`.
- Launcher/tray: Windows scripts start and supervise both processes and expose dashboard/settings shortcuts.

Important source locations:

- `app/page.tsx` — dashboard, switch detail, read-only port modal, VLAN display, and topology UI.
- `app/globals.css` — established dark NETGEAR Discovery visual system.
- `collector/server.mjs` — SNMP discovery, polling, cache, read-only AV profile import, and HTTP APIs.
- `collector/setup.html`, `setup.js`, `setup.css` — server-only settings interface.
- `lib/netgear-models.ts` — known NETGEAR model layouts and physical port arrangement.
- `scripts/installed-tray.ps1` — installed runtime supervisor/tray behavior.
- `installer/Netgear Discovery.iss` — Inno Setup installer definition and stable upgrade App ID.
- `installer/build-installer.ps1` and `finalize-installer.ps1` — packaging pipeline.

## Data and configuration

Development reads `collector/.env` when present. Installed copies store mutable data under:

`%ProgramData%\Netgear Discovery`

This includes `.env`, logs, discovery cache, saved VLAN color scheme, and other runtime state. Installer upgrades must never delete or overwrite this directory.

The collector cache allows devices to remain visible between scans, but stale switches age out. Dashboard requests use the current browser hostname to reach collector port `8787`.

## Discovery and port data

`collector/server.mjs` uses standard IF-MIB, BRIDGE/Q-BRIDGE MIB, LLDP, neighbor/FDB tables, PoE tables, and NETGEAR optical OIDs. Polling (`collector/scheduler.mjs`) runs three independent lanes so it scales to 30+ switches: a discovery sweep of the subnet (every `DISCOVERY_SECONDS`, default 300, or on demand); a full read of each known switch every `POLL_SECONDS`, staggered, four switches at a time, with backoff for offline switches; and a link-status GET per switch every `STATUS_SECONDS` (default 3, 0 = off) on a reused session. A switch never has more than one collector request in flight. Results are pushed per switch over `/api/events`. A full read:

1. Confirms the switch still answers discovery (sysDescr/sysName/sysUpTime).
2. Walks its tables over one shared SNMPv3 session, four walks at a time, each with a deadline.
3. Inspects the responding NETGEAR switch.
4. Maps interface indexes to bridge ports and PVIDs.
5. Learns MAC/IP/LLDP endpoint information where the network exposes it.
6. Calculates bandwidth from counter deltas between samples.
7. Saves the resulting state to the local cache.

Endpoint names and IP addresses: switches only learn MACs (FDB). A port's IP comes from LLDP, the switches' own neighbor tables (management VLAN only), the routers listed in **Endpoint names** settings (`ARP_ROUTERS`, read over SNMP every minute from ipNetToPhysical, falling back to the legacy ipNetToMedia table), or this computer's ARP table. Names come from LLDP, then Bonjour/mDNS (`collector/endpoints.mjs`, legacy-unicast queries on attached private networks each discovery interval; `ENDPOINT_MDNS=0` disables), then reverse DNS. macOS (seen on 27.0) returns an empty ARP table to processes started by the Tech Hub app, though `arp` works in Terminal, so on Mac hosts router ARP is the dependable MAC → IP source. Tests keep `ENDPOINT_MDNS=0` so they never query a real network. Optical readings depend on the installed transceiver exposing DDM and the model/firmware OID implementation.

## VLAN names and colors

The gear menu can pull NETGEAR AV profile names and colors from one selected switch's web API. The preview is not applied until the user selects **Use this scheme**. The saved scheme is reused until manually replaced. There is also a built-in scheme based on the user's current network.

Port hover text and line items display the VLAN ID and saved profile name. Physical port visuals use VLAN colors, with distinct SFP styling and connected/disconnected treatments.

## VLAN safety boundary

VLAN changes go **only** through the switch's AV profile workflow (the AV interface API the switch's own AV UI uses: HTTPS 4443 on current firmware, then 443, then HTTP 80; the port that worked is remembered per switch), never as a raw PVID or membership write. That rules out SNMP SETs and the documented ConfigAgent REST API on 8443 (`dot1q_sw_port_config`, `swcfg_vlan_membership`), because changing a PVID does not apply the complete NETGEAR AV network profile (PTP, QoS, multicast, tagging). `/api/ports/vlan` must stay absent.

How a change runs (`collector/port-edit.mjs`, wired in `server.mjs`):

- Access ports only. `portLock()` makes trunks, LAG members, uplinks to discovered switches, the port carrying this computer's MAC, and ports with more than four learned MACs read-only, with the reason shown in the dashboard.
- One change at a time with a cooldown. The port's live PVID and membership are re-read over SNMP and compared with what the page showed; nothing is written if they differ. The target VLAN must exist on the switch and have an AV profile there.
- Assign the profile, verify over SNMP (PVID and untagged membership), save to startup config only if verified, force a fresh read of that switch (waiting for any read already in flight), publish it, and append to `vlan-changes.jsonl` in the data directory.
- Access: a scrypt-hashed edit PIN (`EDIT_PIN_HASH`), set on `/setup` alongside `VLAN_EDITING` and the switch admin login. `/api/login` issues an HttpOnly SameSite=Strict `sid` cookie (Tech Hub's gateway renames it `techhub_netgear_edit`, as with Router Panel). Five wrong PINs lock everyone out with doubling backoff. Edit endpoints accept only same-origin JSON and send no wildcard CORS. Changing or removing the PIN ends every unlock.

The AV UI calls (`collector/av-ui.mjs`) were captured from an M4250's AV UI on 2026-10-01:

- Assign: `POST /api/v1/profile/port` with `{"portToProfile":{"vlanId":10,"profileType":"Data","Untaged":[6]}}` (sic). Ports are identified by number. `profileType` comes from `/api/v1/profile/list`. Only profiles with exactly one static VLAN are assignable, which is the AV UI's own rule (`assignableProfile()`).
- Save (the AV UI's Save button): `POST /api/v1/switch_config` with `{"switchConfig":{"save":true}}`. It runs only after SNMP verification succeeds.
- Both use the `Session` header from `/api/v1/login`, and every session is logged out.

Not yet verified on hardware: other model families (M4300, M4350, M4500), and stacks. Stacked switches are locked in `portLock()` until stack port numbering in the assign call is confirmed. Never test against real switches; extend `test/mock-switch.mjs` from new captures instead.

## Main HTTP APIs

- `GET /api/health` — collector health.
- `GET /api/switches` — live/cached switch, VLAN, and dashboard-address data.
- `POST /api/scan` — starts a discovery sweep (rate limited); with `{ip}` re-reads one switch.
- `GET /api/events` — server-sent events: `switch` (one switch after each read), `ports` (link/speed changes), `removed`, `status`.
- `GET /api/edit-access`, `POST /api/login`, `POST /api/logout` — edit PIN unlock state.
- `POST /api/ports/profile` — `{switchIp, ifIndex, fromVlan, toVlan}`; PIN-gated AV profile change (see VLAN safety boundary).
- `GET /api/interfaces` — local-server-only adapter discovery.
- `GET|POST /api/config` — local-server-only settings.
- `GET|POST /api/color-scheme` — read/apply saved AV profile scheme.
- `POST /api/color-scheme/pull` — local-server-only NETGEAR AV web API import.

## UI behavior worth preserving

- Dashboard and topology are tabs in the main header.
- Topology uses a large scrollable/zoomable canvas with saved browser-local node positions.
- Topology edges show local/remote ports, sampled bandwidth, optical values, and errors.
- Switch drawings use model layouts from `lib/netgear-models.ts`.
- SFP ports look different from RJ45 ports.
- Disconnected ports retain muted VLAN outlines; internal socket squares appear only when connected.
- Port errors appear on switch drawings and port line items.
- Port modal shows the current VLAN and saved profile color/name; when VLAN changes are available it offers unlock → choose → confirm → apply, a Revert for the last change, or the lock reason for that port.

## Local development and verification

Install dependencies with `npm install` if needed. Common commands:

```powershell
npm run collector
npm run dev
node --check collector/server.mjs
npm run build
```

Dashboard: `http://localhost:3000`

Server settings: `http://localhost:8787/setup`

Before handing off a change:

1. Run the collector syntax check.
2. Run the production Next.js build.
3. Verify `/api/health` and the dashboard return successfully.
4. Verify that `/api/ports/vlan` is not available, and run `node --test services/netgear/test/*.test.mjs` from the repo root. The collector test runs the real collector against a mock switch (real SNMPv3 packets via net-snmp's agent) and reports measured switch load. Never test changes against real switches.

The broad lint command may traverse staged installer build output; use build/type checking as the primary gate and scope linting to source when needed. There is a pre-existing React hooks lint finding in the topology local-storage initialization.

## Windows installer and upgrades

The installer bundles the production dashboard, collector, scripts, dependencies, and Node.js runtime. It creates shortcuts, optional startup behavior, and private-network firewall rules.

The Inno Setup `AppId` in `installer/Netgear Discovery.iss` must remain unchanged. That is what makes a newer installer upgrade the existing installation. Increase only the semantic version for releases.

Version locations that must agree:

- `package.json`
- root package entry in `package-lock.json`
- `installer/Netgear Discovery.iss`

Build with:

```powershell
npm run package:windows
```

Output is written to `installer-output/Netgear-Discovery-Setup-X.Y.Z.exe`. Record its SHA-256 after building. The installer is currently unsigned, so Windows may display a SmartScreen warning.

During upgrade the installer stops the installed Netgear Discovery processes, replaces application files, retains `%ProgramData%\Netgear Discovery`, and relaunches the app. Existing SNMP credentials, color scheme, and topology browser layout remain intact. Administrator credentials saved by version 0.2.1 are ignored and are removed from the local environment file the next time Server Settings are saved.

## Hosting note

The repository contains `.openai/hosting.json`, but the operational product must remain local because cloud hosting cannot directly perform raw SNMP/UDP discovery against the user's private switch network. Do not deploy a cloud copy as a replacement for the Windows collector. A future hosted companion would require an explicitly designed secure HTTP relay, which is outside the current architecture.

## Current release state

The dashboard is monitoring-only for VLAN/profile assignment. Version 0.2.1 briefly introduced an SNMP PVID-only write control; it has been removed from the source because it did not apply complete NETGEAR AV profiles.
