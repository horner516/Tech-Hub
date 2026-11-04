# Module contract, schema 1 — host 1.0.1

Every package contains `techhub-app.json` at its root. Required fields:

- `schemaVersion`: 1
- `id`: lowercase letters, digits and hyphens, starting with a letter; 2–40 characters
- `name`: user-visible name, at most 80 characters
- `description`: plain text, at most 240 characters
- `version` and `minHostVersion`: numeric `major.minor.patch`
- `runtime`: `node` for new modules; `shared` for reserved host engines; `native` for legacy packages
- `entry`: a relative file path inside the package (Node entry point; UI entry for a reserved shared engine)
- `accent`: a six-digit hexadecimal color
- `permissions`: an array of declared capabilities (`network`, `device-control`, `data-files`)
- `platforms`: `["universal"]` for new modules; explicit platform IDs are `darwin-arm64`, `win32-x64`, `linux-arm64`, and `linux-x64`; Linux requires host 1.0.4+
- `runtimeAPI`: `1` when using the shared helper API
- `engine`: required only for `runtime: "shared"`; reserved official IDs `dsan` and `power`

Universal packages require `minHostVersion: "1.0.1"` or later and cannot contain native executables or add-ons. See [shared runtime](SHARED-RUNTIME.md) for the helper API and compatibility-engine behavior.

The host launches one process per enabled module and provides:

| Environment variable | Contract |
| --- | --- |
| TECH_HUB_BACKEND_HOST | Bind address, always 127.0.0.1 |
| TECH_HUB_BACKEND_PORT | Required assigned HTTP port; never select another port |
| TECH_HUB_DATA_DIR | Persistent module settings directory; create it if needed |
| TECH_HUB_PUBLIC_PORT | Assigned gateway port, not the internal listener |
| TECH_HUB_VERSION | Host version |
| TECH_HUB_RUNTIME_API | Absolute path to the host’s versioned CommonJS helper API |
| TECH_HUB_APP_ROOT | Installed module directory; read-only assets, never user settings |
| TECH_HUB_MANAGED | `1` when run by Tech Hub |

Return HTTP 200 from `/` when ready. Keep HTTP responses bounded and handle client disconnects. Support termination with SIGTERM; Windows shutdown may terminate the process, so persist changes atomically when saved. Do not rely solely on shutdown to save settings.

Use root-relative asset/API paths, same-origin browser requests, and an HTML `head` element. The host injects shared navigation and browser activity tracking. Do not intercept `/__hub/*`; that namespace belongs to Tech Hub. WebSocket tunneling is not part of contract 1; use HTTP polling or SSE. Keep saved data outside the package. Use `x-techhub-local-client: 1` only as a host-provided indication on your loopback backend; never expose your backend to the network.

Settings routes that disclose credentials or modify privileged configuration must require the host-provided administrator indicator. Validate all input, keep credentials out of ordinary status responses, and return actionable errors. A service password is an access gate, not a read-only role; document module-specific control permissions.

Packages contain regular files and directories only. No symlinks, executables downloaded at runtime, install scripts, absolute paths, parent traversal, platform-reserved filenames, or secrets. The default updater cannot interpret your schema migrations; make them backwards compatible where possible and keep backups before irreversible changes.
