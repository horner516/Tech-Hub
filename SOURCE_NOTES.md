# Integration notes

The three source snapshots were copied into `services/` from the user's existing workspaces on 2026-09-08. Live settings, captures, caches, build artifacts, Git metadata, and dependency directories are excluded from the repository.

Tech Hub adaptations:

- D’san: environment-configurable strict loopback bind and external data directory, empty disabled device defaults, public gateway port in network metadata, inherited standalone authentication controls hidden, updates directed to Tech Hub.
- Lux Link: strict-port mode for orchestration, public gateway metadata, Tech Hub release links and version, and preservation of its native MA web remote helper.
- Power Monitor: empty defaults, existing portable Go server compiled for macOS, standalone updater disabled while managed, and public gateway port in network URLs.
- Standalone app documentation and tests under `services/lux` may still describe its original packaging. The root README and build script define the combined product.

No live device settings, passwords, packet captures, or authentication credentials are embedded in the installer.


Next-build imports (2026-10-30):

- DeVore’s Tech-Hub `DevoreClaude` commit `e6db49368359fa55ae8307c3909bfe6e3d193555`: NETGEAR source/tests/guidance, isolated session-cookie forwarding, module 1.1.0, and retrying DMG creation. Excluded the branch’s unrelated Claude workflow scaffolding and older Lux-pause changes.
- Pixel Peeker commit `0ba86a99d6f82237227d13883cf9f1a1a2c27b59` and Otter EDID Editor commit `5a88148c88d9764f1cc8fdb68b3f12464a71d939`: source and notices retained in services; UPSTREAM.json records provenance. Added pnpm locks imported from upstream npm locks. Only the managed service-worker registration changes frontend source; no domain formulas, data or EDID codecs were changed. The host supplies static serving, lifecycle, password gates and navigation. Browser state stays on the origin and is not part of host configuration backups.
- Host usability: separate device summaries, common setup shortcuts, one recommended crew URL and expandable maintenance controls. Record Monitor setup behavior is intentionally deferred pending physical device tests.
