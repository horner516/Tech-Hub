# Additional Tech Hub services

These applications run as separate local services under Tech Hub's supervisor.

- **NETGEAR AV Switchboard** — https://github.com/lukeirves/netgear-av-switchboard. Imported with redistribution permission confirmed by the Tech Hub owner on September 22, 2026. The upstream repository does not supply a general open-source license. This notice does not grant additional rights. Tech Hub adaptations serve the exported dashboard and collector on one assigned port, preserve local-only setup permissions, and keep settings in Tech Hub's per-user data directory. VLAN/profile assignment remains read-only.
- **Record Monitor** — https://github.com/davidadevore/Record_Monitor. GPL-3.0; see `services/record/LICENSE`. Complete service source and Tech Hub modifications are in `services/record/`, with packaging instructions and scripts in this repository. Modifications made September 22, 2026: managed listener configuration, per-user baseline storage, and preservation of local-only controls behind the proxy. No warranty is provided.
- **Router Panel** (formerly Ultrix Panel) — supplied by the Tech Hub owner. Original source is preserved in `services/ultrix/`, with managed ports and disconnected startup until a router is configured. Blackmagic Videohub support implements Blackmagic Design's published Videohub Ethernet Protocol; no Blackmagic code is included. Facility configuration and exported router data are not distributed.

NETGEAR's runtime dependencies retain their own licenses in their package directories. Its dashboard is built with Next.js and React. Source distributions retain the dependency lockfiles needed to rebuild it.
