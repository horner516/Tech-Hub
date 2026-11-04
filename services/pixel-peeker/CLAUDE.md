# CLAUDE.md — command reference

See `AGENTS.md` for the mental model, invariants and traps. This file is commands only.

```bash
npm install
npm run dev        # vite dev server (port 5173)
npm test           # vitest: capacity calibration + export regression
npm run typecheck  # tsc -b (app + test projects)
npm run build      # tsc -b && vite build -> dist/
npm run deploy     # build + wrangler deploy       (Worker + static assets)
npm run deploy:lite # build:lite + wrangler deploy -c wrangler.lite.toml
```

Write export artefacts to disk while testing:

```bash
PP_WRITE_ARTEFACTS=/tmp/pp npx vitest run
```

Key files:

- `src/domain/capacity.ts` — port/device capacity. Calibrated against published vendor
  figures; `capacity.test.ts` pins it. Fix the model, never the test.
- `src/data/cabinets/<maker>.ts`, `src/data/processors.ts` — the library. Every record
  needs `verified` + `source`. Primary datasheets only. `src/data/library.test.ts`
  sanity-checks every record.
- `src/export/resolume.ts` — schema taken from real Arena 7.27 files (via `blend-calc`),
  not from Resolume's docs. Version stamp lives in `ARENA_VERSION`.
- `src/export/novastar.ts` — deliberately does not emit `.scr`/`.vmp`. Read the comment.
- `src/domain/power-line.ts` — cabinets per power circuit, steady state, peak by default.
  `src/domain/data-line.ts` is the Line calc view's wrapper over `capacity.ts`, not a
  second model (AGENTS.md 4.7). The view lives at `/#line`; old line-calc links redirect
  there, so keep the hash.
