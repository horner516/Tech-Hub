# AGENTS.md — bringing an LLM up to speed on Pixel Peeker

Orientation for an AI assistant (or a new human) picking this up cold. `README.md` is
the user-facing story; this file is the map, the invariants, and how to tell finished
work from scaffolding.

---

## 1. What this is

A **static browser app** for designing LED video walls — cabinet layout, processor
patching, port capacity, power circuits, and export to the formats a video crew actually
uses. A second view, **Line calc** (`/#line`), answers "how many of this panel fit on one
port, and on one circuit?" without opening the designer; it was the separate Line Calc
tool until 2026-10-11. React +
TypeScript + Vite, deployed to Cloudflare as a Worker that serves static assets.
Everything runs client-side; there is no backend and there should never be one — the
Worker exists only to serve `dist/`, not to run code.

Public repo, MIT.

## 2. Layout

```
src/
  domain/       The whole model. No React in here, ever.
    types.ts       Data shapes + the provenance contract
    capacity.ts    THE IMPORTANT FILE — port/device capacity + refresh feasibility
    wall.ts        Geometry, derived physical figures, layout validation
    snapping.ts    Placement snapping, 45° drag constraint, adjacent-slot search
    wiring.ts      Port loading, wiring validation, auto-wire
    pixelmap.ts    Shared pixel-space map that every export builds on
    power-line.ts  Cabinets per power circuit (breaker, 80% derate, phase voltage), and
                   the per-model circuit count the Power section and PDF use
    published-chains.ts  Absen's published cabinets-per-cable table, the one check on it
    data-line.ts   Line calc's data half — a WRAPPER over capacity.ts, see 4.7
    line-verdict.ts  Which of the two lines binds
  data/         The library. Facts from datasheets, each with a provenance flag.
    cabinets/      One module per manufacturer, `index.ts` aggregates; library.test.ts
                   sanity-checks every record (pitch vs pixels, W/m2 vs W/panel, card ids)
    processors.ts  Controllers and receiving cards, with the per-vendor calibrations
  export/       PDF, Resolume XML, NovaStar/interchange
  state/        One zustand store: project document + selection + undo. lineCalc.ts is
                the Line calc view's inputs, deliberately outside the project document
  ui/           React components. Presentation only — no maths in here.
    linecalc/      The Line calc view (`#line`); App.tsx switches between it and the designer
```

**`domain/` must stay React-free and side-effect-free.** It is the part that is tested,
and the part whose correctness the whole product rests on. If you find yourself
importing a hook into `domain/`, the design has gone wrong.

**`ui/` must not do arithmetic that belongs in `domain/`.** If a component computes a
capacity, a pixel coordinate or a power figure inline, move it. The exports and the
canvas have to agree, and the only way to guarantee that is one implementation.

## 3. Build, run, test

```bash
npm run dev        # vite dev server
npm test           # vitest — capacity model + export regression
npm run typecheck  # tsc -b across app + test configs
npm run build      # tsc -b && vite build
npm run deploy     # build + wrangler deploy (Worker + static assets, not Pages)
```

**tsconfig trap:** tests are Node-flavoured (`node:fs`, `Buffer`, `process`) and are
excluded from `tsconfig.app.json`, which is browser-only. They are typechecked by
`tsconfig.test.json`. If you add a test and `tsc -b` complains it cannot find `process`,
you have put it somewhere the test config does not `include`.

## 4. The invariants that matter

### 4.1 Capacity maths is calibrated, not guessed

`src/domain/capacity.ts` is the heart of the app. Two rules:

1. **Pixels are packed into power-of-two containers** — 8-bit → 24 bits/px, 10-bit → 32,
   12-bit → 48. Not `3 × bitDepth`. (NovaStar. Brompton, it turns out, do pack at
   `3 × bitDepth` — see below.)
2. **Link efficiency is 0.9500 for NovaStar COEX gigabit ports.** Every other link is
   calibrated separately from its own vendor's published table.

Both of those were originally *derived* from NovaStar's three published MX40 Pro
per-port numbers. They are no longer derived: the MX20, MX30, MX2000 Pro and MX6000 Pro
specifications print the formula itself — `Load capacity × 24 × Frame rate < 1e9 × 0.95`
and the same with 32 and 48 bits. The vendor states both constants.

Two paths deliberately do **not** use them, and each is calibrated from its own
datasheet — do not "unify" them:

- **`container-legacy` at 0.936** — the pre-COEX MCTRL generation (MCTRL4K, MCTRL660,
  MCTRL660 PRO). No 32-bit path, so 10-bit costs the full 48 bits. Over-determined by
  the MCTRL660 PRO, which publishes both figures at exactly 2:1.
- **NovaStar 5G ports at 0.8499456, and 0.879864 at 10-bit** — the CX40 Pro and the
  5G output cards in the MX2000/MX6000 Pro. Containers, like the gigabit path, but a
  different constant, and the only place a vendor prints a per-depth constant (their
  formula says 0.85 / 0.88 / 0.85; the odd decimals are what their own rounding of the
  24 Hz row leaves, and reproduce the table to the pixel). `PortSpec.efficiencyByDepth`
  exists for exactly this. HISTORY: the V1.1.1 sheets (2023) rated the same card on
  naive 24/30/36 packing at 0.7465, and this file used to say so; V1.5.0 (2025-09)
  re-rated it 14% up at 8-bit and 15% down at 12-bit. The library follows the current
  sheet. When a NovaStar number looks wrong, check the specification's version first.
- **Brompton at 0.756, packed NAIVELY** — from Brompton's own "Tessera Processor Output
  Port Capacity" table: 525,000 / 420,000 / 350,000 px per gigabit output at 8/10/12-bit
  and 60 Hz, which is 24 : 30 : 36 bits at one constant. The processor cap is a
  different shape again — 9 Mpx on an SX40 at every bit depth up to 60 Hz, then
  ∝ 1/frameRate — and `ProcessorSpec.capacityScaling: 'pixel-rate'` models it. An
  earlier version of this file back-calculated 0.648 from the 9 Mpx headline on the
  assumption that it was a link limit; it is not, and that understated every Brompton
  link by 30% at 8-bit. Do not go back to it.

`capacity.test.ts` pins all of this against the published numbers. **If those tests
fail, fix the model — do not relax the test.** They are the only thing standing between
this app and a plausible-looking spreadsheet that is quietly wrong.

### 4.2 Link bandwidth and drive capability are different things

The single most common error in this domain, and one an earlier draft of this file made:

- **Link capacity** depends on link rate, bit depth and **frame rate**. LED refresh rate
  is irrelevant to it.
- **Drive capability** (can the card paint it at 3840 Hz?) depends on the driver IC,
  scan ratio and the panel's **internal greyscale depth** (14–16 bit). Input bit depth
  is irrelevant to it — the card upsamples to its own depth regardless.

Anything that scales refresh rate by input bit depth is a bug. That was written once and
corrected; do not reintroduce it.

### 4.3 Provenance is not decoration

Every record in `data/` has `verified: boolean` and `source: string`.

- `verified: true` means **a human checked it against the manufacturer datasheet named
  in `source`**. Nothing else earns that flag.
- Do not flip a flag to true to silence a UI badge.
- Do not populate the library from another tool's database. Primary sources only —
  individual specs are facts, a compiled database is not.

Rental-house listing pages are *not* primary sources; they routinely describe a
different revision under the same product name.

### 4.4 Exports must not fabricate proprietary containers

`export/novastar.ts` deliberately does **not** emit `.scr` or `.nprj` files. This is a
decision, not an omission — read the block comment before "fixing" it. A file that loads
with a subtly wrong map is worse on site than no file.

**VMP `.nprj` is now largely mapped** — see `docs/novastar-vmp-format.md`, written from a
real VMP V1.5.1 export. It is a zip of zips of plain JSON, and `cabinetID` is a derivable
bit-packed field, not an opaque handle. A writer is realistic. The one blocker is that the
sample exercised a single Ethernet port, leaving `connectID` ambiguous between sending
order and port index, and nothing else in the tree names a port. The doc records the exact
experiment that resolves it. Do not implement the writer before that is settled.

LCT `.scr` remains genuinely proprietary and is a separate problem.

`export/resolume.ts` emits XML against a schema **reverse-engineered from real Arena
7.27.0 files** (done for the sibling project `blend-calc` — see its
`docs/resolume-export.md` for the annotated sources). An earlier version of this file
was written from Resolume's public documentation and was substantially wrong: no vertex
lists, no Warper, no OutputDevice, no uniqueIds. Do not simplify back towards that.
`ARENA_VERSION` holds the version stamp if it needs bumping.

The remaining honest gap: the schema is verified, but Pixel Peeker's particular
arrangement (many slices in one screen, one screen per processor) has not itself been
loaded into a running Arena.

### 4.5 The lite build flag

`src/config/features.ts` exports `NOVASTAR_EXPORTS`, a build-time constant. `npm run
build:lite` reads `.env.lite` and produces a variant without the NovaStar exports.

Two traps here, both hit for real:

1. **The flag must stay a bare top-level `const` boolean.** It was first written as a
   property on a `FEATURES` object; Rollup would not inline a property read across the
   module boundary, so the guarded JSX stayed in the bundle.
2. **The flag alone is not enough.** Rollup fixes chunk boundaries from the module graph
   before dead-code elimination, so it still emitted an orphaned `novastar-*.js` chunk.
   `vite.config.ts` resolves the module to a stub in `lite` mode so it never enters the
   graph.

`scripts/check-lite.mjs` asserts both — it runs as part of `build:lite` and fails the
build if NovaStar strings survive, or if the PDF/Resolume/save paths were stripped by
mistake. **A feature flag you cannot see failing is worse than no feature flag.** When
the VMP format is unblocked, delete the flag rather than leaving it lying around.

### 4.6 Snapping is geometry, and it lives in `domain/`

`src/domain/snapping.ts` decides where a cabinet lands: alignment against the cabinets
already on the wall, the 45° drag lock, and the adjacent-slot search behind the arrow
keys. `WallCanvas` converts pointer events to millimetres and draws the result; it does
not do the arithmetic. Four things that are decisions rather than accidents:

1. **Alignment beats the grid, and abutting beats both.** Candidate positions come from
   pairing the moving cabinet's edges with every static cabinet's edges, so "flush
   against that one" falls out of the same mechanism as "lined up with that one". The
   canvas `snapMm` grid is only the fallback for an axis that found no alignment.
2. **Tolerance is a screen distance, converted to millimetres by the caller.** Ten
   screen pixels at the current zoom. A fixed millimetre tolerance would be unusable at
   one end of the zoom range or the other.
3. **A constrained drag restricts snapping to the axis it is free on.** Snapping across
   a 45° lock would silently break the lock. On a diagonal there is no free axis, so
   alignment is off entirely.
4. **The 45° lock quantises distance along the lock, not x and y separately.** Rounding
   the two components independently pulls a diagonal off 45° by up to half a grid step
   each. Quantising the distance keeps the components equal, so the drag stays exactly
   diagonal *and* lands on whole grid units — which matters because a diagonal drag is
   the one path where alignment snapping is off and nothing else would round it.

Drag commits once, on release, not per pointer-move: one undo step per drag, and no
`structuredClone` of the project at 60 Hz.

### 4.7 Line calc is a view on this model, not a second one

The Line calc view came from a standalone repo (`line-calc`, now a redirect to `/#line`)
that carried its own copy of the capacity maths and a dated snapshot of this library.
Merging it in was the point: **`domain/data-line.ts` only rounds `portCapacity`,
`processorCapacity` and `receiverCheck` to whole cabinets.** Do not grow it a formula of
its own, and do not pin calibration figures in `data-line.test.ts` — they live in
`capacity.test.ts`. Three consequences that look like bugs and are not:

- Panels per processor applies `processorCapacity`, which includes `maxCanvasPx`. Line
  Calc's snapshot dropped that field, so it over-stated the MCTRL boxes (256 rather than
  220 200×200 tiles on an MCTRL4K at 8-bit/60).
- The receiving-card check is `receiverCheck`, which tests width and height as well as
  the pixel total. Line Calc tested only the total.
- One port stands for the box. `data-line.test.ts` asserts every library processor has
  identical ports; a mixed-port controller must fail that test, not be described by its
  first port.

The power half (`power-line.ts`) is steady-state arithmetic, and every surface says so:
**peak power is the default and the only basis the designer uses** (a distro sized on
average trips on a white frame), **three phase uses the phase voltage** (`SupplySpec.volts`
is 230 of a 400 V supply; `label` is the line-to-line name), and inrush, cable length and
power factor are not modelled. Sizing a circuit is a qualified person's job; do not let
the wording drift into implying it is a design.

**`#line` is an external contract.** `line-calc.stoatworks-labs.com` 301-redirects every
request to `https://pixel-peeker.stoatworks-labs.com/#line`. Renaming the hash breaks
every old link. The view is selected by the hash in `ui/App.tsx`; there is no router.

**The designer unmounts while Line calc shows.** WallCanvas listens for Delete, arrows,
F and S on `window`, so a hidden canvas would act on a selection nobody can see. And
Line calc scrolls inside `.lc-scroll`, the `1fr` row of the fixed-height `.app` — it must
not make the page scroll (see the `.stage` note in docs/NOTES.md for why an unclamped row
runs away).

## 5. What is genuinely done vs scaffolding

**Done and tested:**
- Capacity model, calibrated against two vendors' published figures (28 tests)
- Resolume Arena 7.27 preset export, schema taken from real Arena files
- Wall geometry, stats, layout validation
- Auto-wire (serpentine/column/row) with fill limits, and wiring validation
- Pixel map, PDF report, cabinet schedule, config brief, JSON interchange (9 tests);
  the map divides by the true pitch (width / pixels), not the datasheet's rounded label (3 tests)
- Canvas: place, drag-move, marquee-select, nudge, delete, pan/zoom, undo/redo
- Snapping, 45° drag constraint and arrow-key wall growth (22 tests) — see 4.6
- Cloudflare Worker (static-assets) config, lazy-loaded PDF bundle
- Power circuits per cabinet model (Power section, PDF) and the Line calc view: power
  arithmetic, Absen's published table and the whole-cabinet wrapper (31 tests)

**Scaffolding / known gaps:**
- **Cabinet library covers the rental ranges of five manufacturers** — 150 records as of
  2026-09-11 (Absen, Aluvision, Gloshine, ROE, Unilumin), all but one from the maker's
  own sheet. Not covered: fixed-install fine pitch (ROE Coral/Denali/Sierra, Absen CL/
  PO), mesh panels with a non-square pitch (the model has one pitch per axis), curved and
  cube-only variants, and the Gloshine series whose only public specs are website tables
  without power or resolution (MV Ultra, MR, MT, CS II, ZS III, RB-B, CR MAX).
- **Processors are NovaStar and Brompton only.** Colorlight, Megapixel HELIOS and
  Evision (ROE's own platform, and the only one some Graphite/Topaz tiles list) need a
  `ProcessorMake` extension and their datasheets.
- **A per-output-card ceiling is not modelled** on the MX2000/MX6000 Pro: NovaStar cap
  each output card at 17,694,720 px (8192x2160) at 8/10-bit, below what its eight 5G
  links or forty gigabit drops carry. The chassis caps are the sum of the card caps, so
  a fully loaded chassis comes out right; a lightly populated one is over-stated.
- **The receiving card's effect on 10-bit wire cost is not modelled.** On COEX
  controllers the card decides whether 10-bit costs 32 bits or 48 — 494,791 px/port
  against 329,861, a 50% difference — and only the A10s Pro gets the 32. `container`
  assumes A10s Pro for every card, so a wall on A8s cards is shown too much 10-bit
  capacity. Fixing it means threading the receiver into `portCapacity`, which is
  called from `wiring.ts` and `export/novastar.ts` with only the port in scope.
- **Resolume XML** uses a verified schema but this app's slice arrangement has not been
  opened in a running Arena.
- **No manual port patching UI** — you can auto-wire or clear, but not drag a cabinet
  onto a specific port. `patchCabinetsTo` exists in the store and is unused.
- **No CSV/JSON import** for bulk-loading a cabinet library.
- **VMP `.nprj` writer** not started — format documented, blocked on one ambiguity.
- **No redundancy modelling** — `ProcessorSpec.redundancy` is recorded but not used in
  any calculation or check.
- **Mixed-pitch walls** produce an approximate pixel map, flagged but not solved.
- **Power is steady state only.** No inrush, no volt drop along a chain (the arithmetic is
  on the website's cable-voltage-drop page), no power factor or neutral current. A mixed
  wall's circuits are counted per model, which can over-count by one or two.
- **Only Absen publish a cabinets-per-circuit figure** among the five makers (PL V2 user
  manual p.19). ROE print mechanical Max. Hanging/Stacking instead; nothing found for
  Unilumin, Gloshine or Aluvision. No `CabinetSpec` field for the power connector.

## 6. Conventions

- British spelling in user-facing text and comments (`colour`, `metre`, `utilisation`).
- Units are carried in identifier names: `xMm`, `capacityPx`, `powerMaxW`, `frameRateHz`.
  There is no unit type system; the naming is the discipline.
- Comments explain **why**, especially where a number looks arbitrary. Every magic
  constant in `capacity.ts` has its derivation written next to it.
- The wall coordinate system is millimetres, origin top-left, +x right, +y down.
  Pixel space is derived from it, never stored.

## Notes

`docs/NOTES.md` carries this repo's working notes — current status, decisions
already made, and the traps that have actually bitten. Read it before changing
anything non-obvious. Cross-cutting fleet knowledge lives in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).
