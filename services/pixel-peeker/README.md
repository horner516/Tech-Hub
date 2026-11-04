# Pixel Peeker

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. The capacity model reproduces NovaStar's
> and Brompton's published figures and is pinned by tests, the cabinet library is parsed from
> manufacturer datasheets, and the power circuits are checked against the one published
> cabinets-per-cable table I found. It has **not** been used to design a wall that was then
> built; no processor, receiving card, panel or distro has been connected to it, and the Resolume
> file hasn't been opened in a running Arena. The detail is all below.

A browser tool for designing LED video walls. Lay out cabinets on a canvas, add processors, wire
the ports, and find out whether it actually fits, preferably before you find out on site.

It runs entirely in the browser. There's no account, and nothing gets uploaded, because there's no
server to upload it to. It deploys to Cloudflare as a static site.

**Status: alpha.** The capacity maths is tested against published manufacturer figures, the power
circuits are steady-state arithmetic, and the cabinet library covers 150 cabinets across five
manufacturers and 15 processors, each from its maker's own datasheet. One export format is
unverified. The details are below.

![Pixel Peeker: a 144-cabinet wall auto-wired across eleven ports of a NovaStar MX40
Pro, with the port-loading table alongside](docs/screenshots/pixel-peeker.png)

*An 8 m × 4.5 m wall of Absen PL2.5 XR V2: 144 cabinets, 3200×1800, 26.6 kW peak,
serpentine-wired to 90% fill. The MX40 Pro carries it on 11 of 20 ports at 64% device
load. Each colour on the canvas is one port.*

## What it does

- **Lay out a wall.** Pick a cabinet from the library or define a custom panel by resolution and
  receiving card. Fill a canvas, build blocks, or place tiles by hand. New and dragged cabinets
  snap flush against the ones already up, arrow keys extend a run one cabinet at a time, and
  holding Shift locks a drag to 45°.
- **Add processing.** NovaStar and Brompton controllers with their real port counts, input
  connectors and device capacity limits.
- **Wire it up.** Auto-wire in serpentine or column order to a chosen fill limit, or patch ports
  by hand. Every port shows its load, its headroom, and the highest frame rate it could sustain at
  that load.
- **Check it.** Overlapping cabinets, unpatched tiles, over-capacity ports, a device that runs out
  before its ports do, an input too small to carry the wall, panels that can't reach the refresh
  rate you want, chains that jump around the wall.
- **Power it.** Pick a supply and breaker and get cabinets per circuit and circuits per cabinet
  model, on peak power, with or without the 80% continuous-load derate.
- **Export.** PDF report, Resolume Advanced Output XML, cabinet schedule CSV, a
  screen-configuration brief for LCT/VMP, and a versioned JSON interchange file.
- **Line calc.** A second view for the rental-desk question (how many of *this* panel fit on one
  processor port, how many on one power circuit, and which of the two stops you) without laying
  out a wall. Open it from the top bar, or go straight to
  [`/#line`](https://pixel-peeker.stoatworks-labs.com/#line).

## The bit that matters: port capacity

Most LED capacity spreadsheets compute `pixels = link rate ÷ (3 × bit depth) ÷ frame
rate`. That's wrong at 10-bit, and wrong in the direction that gets you into trouble: it
overstates capacity by about 7%.

Controllers pack each colour component into a **power-of-two container** so the DMA engine stays
word-aligned:

| Bit depth | Naive (3 × depth) | Actual container |
|-----------|-------------------|------------------|
| 8-bit     | 24 bits/px        | **24 bits/px**   |
| 10-bit    | 30 bits/px        | **32 bits/px**   |
| 12-bit    | 36 bits/px        | **48 bits/px**   |

With those containers, a single link efficiency of **0.9500** reproduces NovaStar's three
published MX40 Pro per-port figures *exactly*:

| Signal          | NovaStar publishes | Pixel Peeker computes |
|-----------------|--------------------|-----------------------|
| 8-bit @ 60 Hz   | 659,722 px         | 659,722 px            |
| 10-bit @ 60 Hz  | 494,791 px         | 494,791 px            |
| 12-bit @ 60 Hz  | 329,861 px         | 329,861 px            |

With naive packing, no single efficiency constant fits all three. The published ratios
(1.00 / 0.75 / 0.50) are exactly 24/24, 24/32 and 24/48. These are pinned in
`src/domain/capacity.test.ts`: if they fail, the model has drifted and every number the app
prints is suspect.

Two other things it gets right:

- **LED refresh rate doesn't use up link bandwidth.** The frame arrives once per frame period and
  the receiving card re-scans it locally at 3840 Hz or whatever it's set to. Refresh is checked
  separately, against the panel's quoted figure, and it's *not* reduced by input bit depth,
  because the card drives the LEDs at its own internal greyscale depth (14–16 bit) regardless.
- **The device cap is often the actual limit, not the ports.** An MX40 Pro's twenty gigabit ports
  could carry 13.2 Mpx between them. The box is rated 9 Mpx.

Brompton is modelled separately, from their published per-port capacity table rather than a
headline: a Tessera gigabit output carries 525,000 / 420,000 / 350,000 px at 8 / 10 / 12-bit and
60 Hz. Those are exactly 24 : 30 : 36 bits (Brompton pack *naively*, unlike NovaStar), and one
constant of 756 Mbps of payload reproduces every row of the table. The processor caps (9 Mpx for
an SX40, 4.5 for an S8) are a different shape again: the same at every bit depth up to 60 Hz, then
halving as the frame rate doubles. Both shapes are pinned by tests.

NovaStar's 5G ports (CX40 Pro, and the 5G output cards in the MX2000/MX6000 Pro) are a third
calibration (containers at 0.85, and 0.88 at 10-bit), taken from the V1.5.1 specifications, which
re-rated the 5G solution in September 2025.

## Line calc: one panel, two lines

A run of panels hangs off one processor port *and* one power circuit, and the two are limited by
unrelated physics, so they almost never come out to the same number, and the run you can actually
build is the smaller of the two. The Line calc view shows both side by side, says which one binds,
and says by how much the other is left unused.

- **Data line:** panels per port and per processor for any controller in the library, at
  8/10/12-bit and any frame rate. It's the same capacity model as the designer (a wrapper over it,
  not a copy), so the two views can't disagree. Refresh rate isn't an input, on purpose: it costs
  the panel, not the link.
- **Power line:** `floor(breaker × derate ÷ (watts ÷ volts))` panels per circuit, for
  230 V and 400 V three-phase (UK/EU) and 120/208/240 V (US) supplies. Three phase is counted per
  leg at the phase voltage. Peak power is the default. Average is offered with a warning, because a
  distro sized on it trips on the first white holding slide.
- **Whole wall:** ports, processors, circuits and total draw for a panel count.

Almost no manufacturer publishes a panels-per-circuit figure. ROE's "Max. Hanging" and "Max.
Stacking" are mechanical limits and get misread as power ones. **Absen are the exception**: the
PL V2 Series User Manual (section 4.2, p.19) tabulates cabinets per 3×2.5 mm² cable at AC220V and
AC110V for eighteen models. The 110 V column is the 220 V column halved and rounded up in every row
(a current limit), and every row works out at 9.7–15.3 A at 220 V. So it's a conservative,
quantised recommendation inside 16 A rather than a computed maximum. Where a panel has a row, the
view shows it and the margin Absen left. Both findings are pinned in
`src/domain/power-line.test.ts`.

**What it doesn't do:** inrush at switch-on (why a wall is powered up in sections, and why a
breaker that holds all day can trip on power-up), volt drop along the chain, power factor or
neutral current. Sizing a circuit is a job for whoever signs off the distro.

Line calc replaced the separate Line Calc tool on 2026-10-11;
`line-calc.stoatworks-labs.com` now redirects here.

## Data provenance

Every cabinet and processor record carries a `verified` flag and a `source`. Verified records were
parsed out of the manufacturer datasheet named in `source`. They weren't typed from memory, or
taken from a rental house's listing page (those are often a different revision of the same product
name). Unverified records are badged in the UI and called out in the PDF report.

| Manufacturer | Models | Verified |
|--------------|--------|----------|
| Absen        | 29 — Polaris PL V2, PL V3, PL Plus V2X; Jupiter JP Pro; Aries AX Pro | ✅ datasheet |
| Aluvision    | 6 — Hi-LED 55 (four pitches), Hi-LED pro / Hi-LED+ pro P1.9 | ✅ datasheet |
| Gloshine     | 51 — Carbon, Curface Pro, Dawn, Column, AR floor, Legend, Vanish / Vanish Max | ✅ datasheet |
| ROE Visual   | 44 — Black Pearl, Black Quartz, Carbon, CB MarkII, Diamond, Graphite, Meru, Topaz, Ruby, Vanish (MKII / V8T / ST / Air / Acoustics), Black Marble | ✅ datasheet |
| Unilumin     | 20 — Upad IV (8), URM III (11), Upad III | ✅ datasheet, except the Upad III (rental-house cut sheet, power confirmed by Unilumin's manual) |
| NovaStar     | 12 — COEX MX40 Pro, CX40 Pro, MX30, MX20, KU20, MX2000 Pro and MX6000 Pro (1G and 5G); MCTRL4K, MCTRL660 PRO, MCTRL660 | ✅ datasheet |
| Brompton     | 3 — Tessera SX40, S8, SQ200 (with QD-S) | ✅ datasheet |

Receiving-card pixel limits (NovaStar A10s Pro, A8s Pro, A8s, A5s Plus, A4s; Brompton R2) are
verified against the card datasheets.

**Adding data:** take it from the manufacturer's own datasheet. Don't copy records out of another
tool's curated database: the individual specs are facts, but a compiled database is a protected
work in its own right under UK/EU database right.

## Export honesty

- **PDF report:** complete and reliable. It includes the power circuits per cabinet model for the
  supply chosen in the Power section (steady state, peak power).
- **Cabinet schedule CSV, config brief, JSON interchange:** complete and reliable. These carry the
  full pixel map, port assignments and sending order.
- **Resolume Advanced Output XML:** schema verified. Element names, nesting and number formatting
  were read off real files written by **Arena 7.27.0 (rev 14395)**, not guessed from documentation
  (the schema was reverse-engineered for the sibling project `blend-calc`). It writes one
  `<Screen>` per processor and one `<Slice>` per output port, with identity Bezier warpers and
  Virtual output devices, so assign each screen to a physical output once it's loaded. ⚠️ The
  *schema* is verified, but this particular arrangement hasn't itself been loaded into a running
  Arena, and Resolume change the format between releases. A slice CSV with identical geometry
  ships alongside as a no-risk fallback.
- **NovaStar LCT `.scr`:** properly proprietary and partly binary. Not generated.
- **NovaStar VMP `.nprj`:** **not generated yet, but no longer a dead end.** A `.nprj` turns out
  to be a zip of per-device zips of plain JSON (zips all the way down), and `cabinetID` is a
  derivable packed field rather than an opaque handle. The container, manifest and geometry are
  all mapped in [`docs/novastar-vmp-format.md`](docs/novastar-vmp-format.md), written from a real
  VMP V1.5.1 export. One thing blocks a writer, and it's a gap in the sample rather than the
  format: every cabinet sat on a single Ethernet port, so `connectID` can't be told apart from a
  port index, and nothing else in the tree names a port. That doc describes the experiment that
  settles it. Guessing would produce a file that loads and looks right but drives the wrong
  cabinets, which is far worse on site than no file at all.

  In the meantime the cabinet schedule and config brief carry the same information in a
  form you can type in or script against.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```


## Two builds

The **full** build has everything described above. The **lite** build drops the NovaStar exports
(cabinet schedule, LCT/VMP brief, JSON interchange) and ships just the design tool, the PDF report
and the Resolume export. That export keeps its caveat from [Export honesty](#export-honesty): the
schema is verified, but the file hasn't been opened in a running Arena.

```bash
npm run build        # full  -> dist/
```

```bash
npm run build:lite   # lite  -> dist-lite/
```

`build:lite` runs `scripts/check-lite.mjs`, which fails the build if the NovaStar code is still in
the bundle. That check exists because the first attempt at the flag silently stripped nothing, and
the build log looked identical either way.

## Deploy to Cloudflare

It's deployed as a **Worker serving static assets**, not a Pages project. There's still no server
code: the Worker's only job is to serve `dist/`. That's the shape Cloudflare's "Import a
repository" flow creates, and what the rest of the fleet uses.

A push to `main` that touches more than the docs deploys the full build through
`.github/workflows/deploy.yml`, which runs the tests, builds, deploys with wrangler and then checks
the live site is serving that build. The
workflow doesn't touch the lite Worker. To build either one from the Cloudflare dashboard instead,
connect the repo there with these settings:

| Setting | Full | Lite |
|---|---|---|
| Worker name | `pixel-peeker` | `pixel-peeker-lite` |
| Build command | `npm ci && npm run build` | `npm ci && npm run build:lite` |
| Deploy command | `npx wrangler deploy` | `npx wrangler deploy -c wrangler.lite.toml` |
| Output directory | `dist` | `dist-lite` |

That's two repos' worth of config in one repo, so the two Workers are created separately from the
same source and differ only in their build and deploy commands.

To publish from this machine instead (a one-off, or without pushing):

```bash
npm run deploy       # full
npm run deploy:lite  # lite
```

`wrangler.toml`, `wrangler.lite.toml` and `public/_headers` are all already in place. There's no
`_redirects`: `not_found_handling = "single-page-application"` in each wrangler file is what makes
the client-side routes resolve rather than 404.

<!-- selfhost:start -->
## Run your own copy

Pixel Peeker is a static page, so hosting it yourself is one container serving
the built files — the same files the hosted copy serves, running somewhere that
still works when the venue has no internet.

**Docker.** The image is built by this repo's `docker.yml` workflow on every
push and published as `ghcr.io/stoatworks-labs/pixel-peeker`:

```bash
docker run -d --name pixel-peeker --restart unless-stopped -p 8526:80 ghcr.io/stoatworks-labs/pixel-peeker:latest
```

Or `docker compose up -d` with the [`docker-compose.yml`](docker-compose.yml)
in this repo, which maps the same port. Either way it is then at
`http://localhost:8526/`.

A second image, `ghcr.io/stoatworks-labs/pixel-peeker-lite` (Pixel Peeker without the NovaStar export path), is built from the same repo.

**Unraid.** Search Community Applications for *Pixel Peeker* — the template is
[`templates/pixel-peeker.xml`](https://github.com/stoatworks-labs/stoatworks-unraid/blob/main/templates/pixel-peeker.xml)
in [stoatworks-unraid](https://github.com/stoatworks-labs/stoatworks-unraid), which is what the CA feed reads.

**Stoatworks Burrow** lists it under *Self-hosted*, with the compose file a
click away.

The `Dockerfile`, `docker-compose.yml`, `docker/` and the workflow are
generated from `fleet.json` in stoatworks-unraid. Change them there and
regenerate rather than editing them here.
<!-- selfhost:end -->

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT.

---

All figures are calculated, not measured. Verify against the controller before the wall
goes live.
