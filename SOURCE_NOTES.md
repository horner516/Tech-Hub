# Integration notes

The three source snapshots were copied into `services/` from the user's existing workspaces on 2026-09-08. Live settings, captures, caches, build artifacts, Git metadata, and dependency directories are excluded from the repository.

Tech Hub adaptations:

- D’san: environment-configurable strict loopback bind and external data directory, empty disabled device defaults, public gateway port in network metadata, inherited standalone authentication controls hidden, updates directed to Tech Hub.
- Lux Link: strict-port mode for orchestration, public gateway metadata, Tech Hub release links and version, and preservation of its native MA web remote helper.
- Power Monitor: empty defaults, existing portable Go server compiled for macOS, standalone updater disabled while managed, and public gateway port in network URLs.
- Standalone app documentation and tests under `services/lux` may still describe its original packaging. The root README and build script define the combined product.

No live device settings, passwords, packet captures, or authentication credentials are embedded in the installer.
