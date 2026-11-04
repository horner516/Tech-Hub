# Tech Hub 1.0.4 — next build

- Add Linux ARM64/Raspberry Pi and x64 Full/Lite installers, a systemd background service, desktop browser shortcut, XDG storage and universal-module support. See LINUX.md for headless setup, boot configuration and platform limitations.

- Restore **Lux Link** in Module Library and Full installers as a universal module. Existing device lists, passwords, ports and enabled settings are retained. Mac builds include the MA Web Remote screen reader; Windows and Linux support the shared network/device tools without that Mac-only reader.
- Require Tech Hub administrator access for Lux inventory edits, discovery, port changes, network selection and transmitter changes. Viewers can read dashboards.
- Add **Pixel Peeker** and **Otter EDID Editor** as local, offline browser-tool modules. Project and EDID data stays in the browser. Native host updates and each module’s updates remain separate.
- Incorporate DeVore’s **NETGEAR 1.1.0** improvements: staggered polling, endpoint naming, and PIN-gated AV profile changes through the switch’s AV interface. Editing remains opt-in and protected ports remain locked.
- Add separate device-health summaries, setup shortcuts and one recommended crew link; move ports, alternate addresses and maintenance into expandable details. Remote administrators open dashboards on the server’s address.
- Add a clear first-launch **Choose modules** action and report running modules against the enabled, installed set.
- Simplify Module Library with expandable developer/offline options, clearer selection behavior, and keyboard-safe unavailable dashboard links.

Lite installs selected modules; Full includes all nine modules offline. This source prepares the next release; desktop installers have not yet been published.

Record Monitor’s device setup redesign is deferred until physical recorders are available. Hardware behavior for newly imported tools has not been validated by this integration.
