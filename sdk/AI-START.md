# Tech Hub module — read this first

Use this page and the module's `MODULE-BRIEF.md` as the initial context. Read other SDK pages only when the task needs them. Do not scan the host repository or dependency source by default.

## Contract

- Node 24, `runtime: "node"`, `runtimeAPI: 1`, `platforms: ["universal"]`, `minHostVersion: "1.0.1"` or newer. One ZIP for Mac arm64, Windows x64 and (host 1.0.4+) Linux arm64/x64. Module version is independent of host version.
- Manifest: `techhub-app.json`. Entry: `server.cjs` in the starter. UI: `public/`. Device parsing belongs in a separate module with sanitized fixtures and tests.
- Use `require(process.env.TECH_HUB_RUNTIME_API)` for `context()`, `readSettings(defaults)`, `saveSettings(value)`, `isAdministrator(req)`, `readJSON(req, limit)`, `json(res,status,value)`, `listen(server)`.
- Bind only the assigned loopback port; save settings only in the supplied data directory. Do not overwrite settings when parsing fails. Save changes immediately and atomically through the helper.
- `GET /` returns 200 HTML with a `head`. Root-relative assets/APIs. HTTP polling or SSE; no WebSocket gateway support. Host injects navigation; never implement another login, module switcher, updater or tray app.
- Require administrator status and same-origin checks for configuration/credentials/control routes. Do not trust browser-supplied administrator headers. Host access passwords do not imply read-only users.
- No bundled runtimes, native add-ons, shell tools or executable downloads. Bundle portable dependencies and license notices before packaging. Module processes are not OS sandboxes.
- Preserve template CSS tokens and responsive layout. Label controls; show units, timestamps, empty/offline/stale/error states. Never show missing measurements as healthy zeros.

## Work loop

1. Read this page and `MODULE-BRIEF.md`. Ask for missing protocol facts; don't invent addresses, registers, packet layouts, units or control commands.
2. Implement one complete behavior against fixtures. Keep persistent settings compatible; avoid unrelated refactors.
3. Run `node /path/to/sdk/dev.cjs context MODULE_DIR` for compact paths/contract metadata when resuming.
4. Run `node /path/to/sdk/dev.cjs check MODULE_DIR`. Its single JSON result reports validation and syntax errors. Fix those before repeating broad tests. This check does not execute the module, test hardware, prove authentication, or inspect secrets comprehensively.
5. Run the module's focused tests. For UI work: `node /path/to/sdk/dev.cjs serve MODULE_DIR`, then repeat with `--viewer`. This executes module code using temporary settings on loopback; it is not network isolation. Use fixtures, not real devices, unless authorized.
6. Stage/package: `node /path/to/sdk/dev.cjs pack MODULE_DIR OUTPUT.zip`. Test the same ZIP through real Tech Hub on all claimed target platforms before claiming compatibility.
7. Record changed files, commands/results and remaining unknowns in `MODULE-BRIEF.md`. Keep it short; don't paste logs or the conversation into it.

## Read on demand

| Need | Read |
| --- | --- |
| Manifest fields, limits, lifecycle | APP-CONTRACT.md |
| Runtime helper semantics | SHARED-RUNTIME.md |
| UI details | DESIGN.md |
| Review/AI prompt recipes | AI-DEVELOPMENT.md |
| Catalog submission | SUBMITTING.md |

Return a concise result: what changed, checks run, and remaining uncertainty. Do not claim physical-device validation from fixtures. Do not publish, install dependencies, contact production devices or change credentials unless the task authorizes it.
