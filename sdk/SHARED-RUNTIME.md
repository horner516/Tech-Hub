# Shared runtime — Tech Hub 1.0.1

Build one module ZIP for Mac, Windows and Linux. Tech Hub supplies Node.js 24, module process supervision, ports, access gates, logging, updates, local network names, persistent storage locations, and the shared navigation. Users do not install Node, Python, Go, npm, or development tools.

## New modules: use Node

Start with `template`. Set `runtime: "node"`, `runtimeAPI: 1`, `platforms: ["universal"]`, and `minHostVersion: "1.0.1"`. Keep device protocol logic in portable JavaScript. Include your browser assets and pure-JavaScript dependencies. Bundle dependencies before packaging; the host never runs install scripts. Do not bundle a Node executable, Python interpreter, native add-ons, or operating-system shell scripts. Starting with host 1.0.4, universal packages also run on Linux arm64 and Linux x64. Earlier hosts support macOS arm64 and Windows x64 only. Linux builds target Debian 12 / Raspberry Pi OS Bookworm 64-bit or newer; ARMv7 and musl are unsupported.

Use the same package bytes in testing on both hosts. Avoid case-sensitive filename assumptions, absolute paths, `/tmp` paths, shell commands, platform-specific filesystem calls and external commands. Use `node:path`, Node networking APIs, and the provided data directory. WebSocket tunneling is not supported by the current gateway; use HTTP polling or SSE.

```js
const runtime = require(process.env.TECH_HUB_RUNTIME_API)
const {port, host, dataDir, hostVersion} = runtime.context()
let settings = runtime.readSettings({label: 'My device'})
// Validate input before saving it.
runtime.saveSettings(settings)
```

`TECH_HUB_RUNTIME_API` is an absolute path supplied by the host. Do not copy the helper into each installed module or hard-code a host installation path. The SDK includes a development copy for local tests. `runtimeAPI: 1` identifies the helper contract; a host rejects an unsupported API version during package validation.

## API version 1

| Helper | Behavior |
| --- | --- |
| `context()` | Returns assigned loopback host/port, data directory, module root, and host version. Requires a host or SDK launch environment. |
| `readSettings(defaults, name?)` | Reads a JSON settings file or clones defaults if absent. Invalid saved JSON raises an error; do not silently discard settings. |
| `saveSettings(value, name?)` | Atomically replaces JSON in the persistent data directory. Name defaults to `settings.json`; only a simple JSON filename is accepted. Validate the value first. |
| `isAdministrator(req)` | Checks loopback connection and the host-injected administrator header. Required for privileged routes and sensitive settings. |
| `readJSON(req, limit?)` | Parses JSON with a byte limit (default 64 KiB). Catch errors and return an appropriate response. |
| `json(res, status, value)` | Sends JSON with no-store and nosniff headers. |
| `listen(server)` | Listens on the assigned loopback port and handles basic HTTP shutdown. Modules with timers/device sockets must clean them up too. |

These helpers do not replace module-specific input validation or provide an OS security sandbox. Save settings when changed; Windows may terminate a process without a graceful shutdown. Use administrator checks together with same-origin checks for configuration changes. Never trust a client-supplied administrator header on a public listener.

## Existing D’san and Power Monitor engines

Tech Hub's installers include the tested D’san Python-based engine and Power Monitor Go engine under `resources/drivers`. Their universal packages contain web assets and a manifest selecting `runtime: "shared"` with `engine: "dsan"` or `"power"`. Tech Hub resolves the platform executable, persistent data directory, and listener port, then supervises the driver directly. No wrapper process or second tray application is created.

This is a shared host runtime with native compatibility engines, **not a rewrite of those engines into JavaScript**. Engine/protocol changes require a host update; UI updates can be delivered through the Module Library. The engine names are reserved for these official modules. Third-party modules use the Node runtime; arbitrary native engines cannot be registered by an unofficial module package. Legacy v1.0.0 platform-specific packages remain supported for updates and rollback.

## Test and package

1. Run `node sdk/validate.cjs /path/to/app`.
2. Run `node sdk/run.cjs /path/to/app` from a checkout of the Tech Hub repository with dependencies installed. It uses temporary settings and disables other services. It does not supply the private native compatibility engines.
3. Test device behavior with loopback fixtures, including disconnection, stale data, malformed packets, and configuration changes. Test authentication through the host gateway.
4. Run `node sdk/package.cjs /path/to/app /path/to/my-app.zip`.
5. Install that exact ZIP on Mac, Windows, Linux arm64 and Linux x64 through **Module Library → Testing & evaluation**. New IDs require one host restart. Verify settings survive updating, rollback, and uninstall/reinstall.
6. Publish only after the tests pass. The universal catalog key is `packages.universal`; it contains the URL, SHA-256, and byte count for that one ZIP. Existing platform keys still work for legacy packages.

## Linux-specific verification

Use the exact same ZIP on every target. Host-managed D’san and Power engines are built natively for Linux. Use XDG data paths through the runtime helper. Never assume a desktop, `open`, `cmd.exe`, or macOS-only frameworks exist. External utility flags may differ: Linux ping timeouts use seconds. A Raspberry Pi can run headless with systemd; see [Linux setup](../LINUX.md). MA Web Remote screen reading in Lux remains Mac-only. Test CPU load, reconnects and multicast on actual Pi hardware before deployment.
