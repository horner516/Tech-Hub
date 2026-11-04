/**
 * Pixel Peeker — processor (sending card / controller) and receiving card library.
 *
 * See the provenance policy at the top of `cabinets/index.ts`. Same rules apply.
 *
 * CALIBRATION NOTE — why efficiencies differ between vendors.
 *
 * NovaStar gigabit ports run at 0.95 link efficiency with power-of-two pixel
 * containers, which reproduces their three published MX40 Pro figures exactly
 * (659,722 / 494,791 / 329,861 px at 8 / 10 / 12-bit @ 60 Hz). See `wireBitsPerPixel`.
 *
 * NovaStar 5G ports (the CX40 Pro, and the CX_1x40G_Fiber / MX_8x5G_Base-T cards in the
 * MX2000 Pro and MX6000 Pro) are a different link: containers again, but at 0.85 — and
 * 0.88 at 10-bit, the one place a vendor prints a different constant per depth. Both come
 * from the V1.5.1 specifications, which print the formula and the table.
 *
 * Brompton's links carry more than raw RGB — per-fixture calibration data, ShutterSync
 * timing and their frame protocol ride along — so their effective efficiency is far
 * lower, and their packing is NAIVE. Both facts come straight from Brompton's published
 * per-port capacity table rather than from a headline: 525,000 / 420,000 / 350,000 px per
 * gigabit port at 8 / 10 / 12-bit and 60 Hz. Those are exactly 24 : 30 : 36 bits, and one
 * constant — 756 Mbps of payload — reproduces every row of the table.
 */

import type { ProcessorSpec, ReceivingCardSpec } from '../domain/types';

// ---------------------------------------------------------------------------
// Receiving cards
// ---------------------------------------------------------------------------

export const RECEIVER_LIBRARY: ReceivingCardSpec[] = [
  {
    id: 'novastar-a10s-pro',
    manufacturer: 'NovaStar',
    model: 'A10s Pro',
    maxPixels: 512 * 512,
    maxWidthPx: 512,
    maxHeightPx: 512,
    verified: true,
    source:
      'NovaStar A10s Pro Receiving Card Specifications V1.5.1, 2026-01-19, novastar.tech',
    notes:
      '512x512 at 60 Hz for 8-bit and 10-bit sources; 512x384 for 12-bit, which this single limit does not model. The only card that unlocks the 32-bit 10-bit container (494,791 px/port) on the COEX controllers, and the card Frame Rate Adaptive and Full Grayscale Calibration require.',
  },
  {
    id: 'novastar-a8s-pro',
    manufacturer: 'NovaStar',
    model: 'A8s Pro',
    maxPixels: 512 * 512,
    maxWidthPx: 512,
    maxHeightPx: 512,
    verified: true,
    source: 'NovaStar A8s Pro Receiving Card Specifications V1.1.2, 2023-12-30, oss.novastar.tech',
    notes:
      'Named alongside the A10s Pro in the COEX V1.5.1 specifications as the other card with the 32-bit 10-bit path.',
  },
  {
    id: 'novastar-a8s',
    manufacturer: 'NovaStar',
    model: 'A8s',
    maxPixels: 512 * 384,
    maxWidthPx: 512,
    maxHeightPx: 384,
    verified: true,
    source: 'NovaStar A8s Receiving Card Specifications V2.2.0, 2021-11-25, oss.novastar.tech',
    notes: 'On a COEX controller this card gets the 48-bit 10-bit container: 329,861 px/port, not 494,791.',
  },
  {
    id: 'novastar-a5s-plus',
    manufacturer: 'NovaStar',
    model: 'A5s Plus',
    maxPixels: 512 * 384,
    maxWidthPx: 512,
    maxHeightPx: 384,
    verified: true,
    source: 'NovaStar A5s Plus Receiving Card Specifications V1.1.4, 2021-12-03, oss.novastar.tech',
  },
  {
    id: 'novastar-a4s',
    manufacturer: 'NovaStar',
    model: 'A4s',
    maxPixels: 256 * 256,
    maxWidthPx: 256,
    maxHeightPx: 256,
    verified: true,
    source: 'NovaStar A4s Receiving Card Specifications V2.1.4, 2021-08-25, oss.novastar.tech',
    notes: 'Fitted to the Aluvision Hi-LED 55 2.8. NovaStar now list it as discontinued.',
  },
  {
    id: 'brompton-r2',
    manufacturer: 'Brompton',
    model: 'Tessera R2',
    maxPixels: 262_144,
    verified: true,
    source: 'Brompton Tessera R2 Data Sheet, Mar 2026 EN, bromptontech.com',
    notes:
      '262,144 RGB pixels per card, 16-bit processing, two gigabit data connections. The R2+ is the same card with more data pins; same capacity.',
  },
];

export function receiverById(id: string): ReceivingCardSpec | undefined {
  return RECEIVER_LIBRARY.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

/**
 * NovaStar COEX gigabit output port.
 *
 * 0.95 is not back-calculated — the MX20, MX30, MX2000 Pro and MX6000 Pro
 * specifications print the constant in the formula itself. See `wireBitsPerPixel`.
 */
function novaGigPort(n: number) {
  return {
    id: `eth${n}`,
    label: `ETH ${n}`,
    linkSpeedGbps: 1,
    medium: 'RJ45' as const,
    efficiency: 0.95,
    packing: 'container' as const,
  };
}

/**
 * NovaStar COEX 5-gigabit port — the "5G solution".
 *
 * Calibrated from the V1.5.1 specifications (CX40 Pro; MX2000 Pro and MX6000 Pro with
 * the CX_1x40G_Fiber or MX_8x5G_Base-T output card), which print the formula
 *
 *    8bit: Load capacity x 24 x Frame rate < 5G x 0.85
 *   10bit: Load capacity x 32 x Frame rate < 5G x 0.88
 *   12bit: Load capacity x 48 x Frame rate < 5G x 0.85
 *
 * and a table beneath it. Power-of-two containers, like the gigabit path. The constants
 * here are what the TABLE works out to rather than the rounded figures in the prose:
 *
 *   - NovaStar compute the 24 Hz row, round it down to a thousand (7,378,000 px at 8-bit,
 *     3,689,000 at 12-bit) and scale the rest of the column from it. 0.8499456 is what
 *     that rounding leaves of 0.85, and it reproduces the 8-bit and 12-bit columns to the
 *     pixel: 2,951,200 and 1,475,600 px at 60 Hz.
 *   - The 10-bit column is 4,399,319,040 bps of payload in every row — 0.8799 rather than
 *     the 0.88 in the formula — and gives 2,291,312 px at 60 Hz. The CX40 Pro's own
 *     "Outputs" paragraph prints 2,213,200 for the same cell, which is the 0.85 constant
 *     applied to 10-bit. Two numbers for one fact; the table is the source, as it is for
 *     every other NovaStar figure in this file.
 *   - One cell is simply wrong: 12-bit at 144 Hz prints 612,374 where the constant gives
 *     614,833 and the neighbouring rows agree with the constant.
 *
 * HISTORY: the V1.1.1 specifications (2023) rated the same 40G card on a naive 24/30/36
 * packing at 0.7465 — 2,592,000 / 2,073,000 / 1,728,000 px per 5G link at 60 Hz. V1.5.0
 * (2025-09-30) replaced that table with this one, 14% up at 8-bit and 15% down at
 * 12-bit, with the XA50 Pro and CA50E as the named receiving cards. The library follows
 * the current sheet.
 */
const NOVA_5G_EFFICIENCY = (2_951_200 * 24 * 60) / 5e9; // 0.8499456
const NOVA_5G_EFFICIENCY_10BIT = (2_291_312 * 32 * 60) / 5e9; // 0.879863808

function nova5GPort(n: number) {
  return {
    id: `eth${n}`,
    label: `5G ETH ${n}`,
    linkSpeedGbps: 5,
    medium: 'RJ45' as const,
    efficiency: NOVA_5G_EFFICIENCY,
    efficiencyByDepth: { 10: NOVA_5G_EFFICIENCY_10BIT },
    packing: 'container' as const,
  };
}

/**
 * Pre-COEX MCTRL gigabit output port.
 *
 * efficiency 0.936 is back-calculated, and unlike most back-calculations it is
 * over-determined: the MCTRL660 PRO publishes BOTH of its figures — 650,000 px at
 * 8-bit and 325,000 px at 10/12-bit, 60 Hz — and one constant reproduces both exactly.
 *
 *   650,000 x 24 x 60 = 936 Mbps      325,000 x 48 x 60 = 936 Mbps
 *
 * That is 1440 bytes of payload in each 1538-byte slot a gigabit link actually spends
 * on a full frame, which is what a 1500-byte MTU leaves after IP, UDP and a 32-byte
 * vendor header. Suggestive rather than proven, but it is the right order of thing.
 *
 * Note this generation is genuinely slower than COEX, not just quoted more coarsely:
 * 936 Mbps against 950, and no 32-bit container at 10-bit.
 */
function mctrlGigPort(n: number) {
  return {
    id: `eth${n}`,
    label: `ETH ${n}`,
    linkSpeedGbps: 1,
    medium: 'RJ45' as const,
    efficiency: 0.936,
    packing: 'container-legacy' as const,
  };
}

/**
 * NovaStar MX_4x10G_Fiber output card trunk — the "1G solution".
 *
 * Modelled the same way as a Brompton trunk: one 10G fibre carrying ten independent 1G
 * fixture links, which is NovaStar's own description ("A single optical port has the
 * same load capacity of 10x 1G Ethernet ports, and a single card supports up to 40x
 * Ethernet port outputs"). The Ethernet drops themselves live in a CVT10 converter at
 * the far end of the fibre, so the trunk is the thing the controller actually has.
 */
function novaFibreTrunk10G(card: number, n: number) {
  return {
    id: `out${card}-opt${n}`,
    label: `OUT ${card} / OPT ${n}`,
    linkSpeedGbps: 10,
    medium: 'SFP+' as const,
    efficiency: 0.95,
    packing: 'container' as const,
    subLinks: 10,
  };
}

/**
 * NovaStar CX_1x40G_Fiber output card trunk — the "5G solution".
 *
 * One 40G fibre feeding a CVT8-5G converter, which fans out to eight 5-gigabit Ethernet
 * links serving 5G receiving cards (XA50 Pro, CA50E). Each link is a `nova5GPort`, so
 * the calibration — and its history — is documented there. Since V1.5.1 the same eight
 * links are also available on copper straight off the chassis, as the MX_8x5G_Base-T
 * output card, with the same per-port figures.
 *
 * The 40G trunk at 12-bit gives 11,804,800 px, which is precisely NovaStar's "maximum
 * load of a single output card" for that card. At 8/10-bit they cap the card at
 * 17,694,720 px (8192x2160), below the 23.6 Mpx the eight links could carry; that
 * per-card ceiling is not modelled.
 */
function novaFibreTrunk40G(card: number) {
  return {
    id: `out${card}-opt1`,
    label: `OUT ${card} / OPT 1`,
    linkSpeedGbps: 40,
    medium: 'Fibre' as const,
    efficiency: NOVA_5G_EFFICIENCY,
    efficiencyByDepth: { 10: NOVA_5G_EFFICIENCY_10BIT },
    packing: 'container' as const,
    subLinks: 8,
  };
}

/** Every OPT trunk across `cards` output cards of the 4x10G kind. */
function fibreTrunks10G(cards: number) {
  return Array.from({ length: cards }, (_, c) =>
    Array.from({ length: 4 }, (_, i) => novaFibreTrunk10G(c + 1, i + 1)),
  ).flat();
}

/**
 * Brompton Tessera gigabit link.
 *
 * 0.756 is read off Brompton's own per-port capacity table ("Tessera Processor Output
 * Port Capacity", dl.bromptontech.com, processor version 3.5.2): 525,000 px at 8-bit,
 * 420,000 at 10-bit and 350,000 at 12-bit, all at 60 Hz, on one gigabit output.
 *
 *   525,000 x 24 x 60 = 420,000 x 30 x 60 = 350,000 x 36 x 60 = 756 Mbps
 *
 * One constant, NAIVE packing. The 24 Hz row (1,312,500 / 1,050,000 / 875,000) and the
 * 120 Hz row (262,500 / 210,000 / 175,000) are the same constant again. The S8 data
 * sheet states the 8-bit figure independently ("a nominal 525K pixels at 8 bits per
 * colour, 60Hz frame rate"). Ultra Low Latency mode halves every cell; not modelled.
 *
 * An earlier version of this file back-calculated 0.648 from the SX40's 9 Mpx headline
 * on the assumption that the headline was a link limit. It is not — it is the
 * processor's pixel cap, which the table shows is the same 9 Mpx at 8, 10 and 12-bit —
 * and that assumption understated every Brompton link by 30% at 8-bit.
 */
const BROMPTON_LINK_EFFICIENCY = (525_000 * 24 * 60) / 1e9; // 0.756

function bromptonGigPort(n: number) {
  return {
    id: `1g${n}`,
    label: `1G ${n}`,
    linkSpeedGbps: 1,
    medium: 'RJ45' as const,
    efficiency: BROMPTON_LINK_EFFICIENCY,
    packing: 'naive' as const,
  };
}

/**
 * Brompton 10G trunk: ten independent 1G fixture connections, "each having the same
 * pixel capacity as a 1G Tessera output" (SX40 data sheet), broken out by an XD unit.
 */
function bromptonTrunk(n: number) {
  return {
    id: `10g${n}`,
    label: `10G ${n}`,
    linkSpeedGbps: 10,
    medium: 'SFP+' as const,
    efficiency: BROMPTON_LINK_EFFICIENCY,
    packing: 'naive' as const,
    subLinks: 10,
  };
}

export const PROCESSOR_LIBRARY: ProcessorSpec[] = [
  {
    id: 'novastar-mx40-pro',
    manufacturer: 'NovaStar',
    model: 'MX40 Pro',
    ports: Array.from({ length: 20 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'dp1', connector: 'DP 1.2', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
    ],
    totalCapacityPx: 9_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source: 'NovaStar MX40 Pro LED Display Controller Specifications V1.4.1, oss.novastar.tech',
    notes:
      'Device cap of 9 Mpx is well below the 13.2 Mpx the 20 gigabit ports could carry — the box, not the links, is the limit. 4x 10G optical ports carry the same data as the copper ports (20-port mode: OPT1 = ETH 1-10, OPT2 = ETH 11-20, OPT3/4 are copies for redundancy), so they are not modelled as extra capacity. Max input 4096x2160@60 per connector; 8192 px max width in forced 8192x1080 mode. Capacity figures re-checked against V1.5.1 (2026-04-30): unchanged.',
  },
  {
    id: 'novastar-cx40-pro',
    manufacturer: 'NovaStar',
    model: 'CX40 Pro',
    ports: Array.from({ length: 6 }, (_, i) => nova5GPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'dp1', connector: 'DP 1.2', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi2', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
    ],
    totalCapacityPx: 9_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'none',
    verified: true,
    source:
      'NovaStar CX40 Pro LED Display Controller Specifications V1.5.1, 2026-04-30, novastar.tech',
    notes:
      'The 5G sibling of the MX40 Pro: six 5GBASE-T ports at 2,951,200 px each (8-bit/60) for 5G receiving cards (XA50 Pro, CA50E), and the same 9 Mpx device cap — so the box binds at 8-bit and the ports only take over at 12-bit above 7680x1080 per port. One 40G QSFP+ optical port carries the wall to a remote CVT8-5G, which fans it out to eight 5G links; it is another route for the same 9 Mpx, not extra capacity, so it is not modelled. The specification does not state Ethernet-port backup; NovaStar document COEX backup separately. 12-bit at 4K is 24/25/30 Hz only. 8192 px max width or height in forced mode.',
  },
  {
    id: 'novastar-mx30',
    manufacturer: 'NovaStar',
    model: 'MX30',
    ports: Array.from({ length: 10 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 10 },
      { id: 'hdmi2', connector: 'HDMI 1.4', maxWidthPx: 4096, maxHeightPx: 1080, maxFps: 240, maxBitDepth: 10 },
      { id: 'dp1', connector: 'DP 1.1', maxWidthPx: 4096, maxHeightPx: 1080, maxFps: 240, maxBitDepth: 10 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
      { id: 'sdi2', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 6_500_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MX30 LED Display Controller Specifications V1.4.0, 2024-06-13, oss.novastar.tech',
    notes:
      'Unlike the MX40 Pro, the 6.5 Mpx headline is not a backplane limit — it is the port sum rounded down (10 gigabit ports carry 6,597,220 px at 8-bit/60). 2x 10G optical carry the same data as the copper: OPT1 = ETH 1-10, OPT2 is its copy for redundancy, so they add nothing. 8-bit and 10-bit inputs only — there is no 12-bit path on this box. HDMI 2.0 takes 8192 px wide in forced 8192x1080 mode. Frame Rate Adaptive (23.98-240 Hz) and Full Grayscale Calibration both require the A10s Pro; so does 10-bit at 494,791 px/port rather than 329,861. Capacity figures re-checked against V1.5.1 (2026-04-30): unchanged.',
  },
  {
    id: 'novastar-mx20',
    manufacturer: 'NovaStar',
    model: 'MX20',
    ports: Array.from({ length: 6 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 144, maxBitDepth: 10 },
      { id: 'hdmi2', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 144, maxBitDepth: 10 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 3_900_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MX20 LED Display Controller Specifications V1.4.1, 2024-08, oss.novastar.tech',
    notes:
      'Smallest MX box. 3.9 Mpx is the port sum rounded down (6 x 659,722 = 3,958,332 at 8-bit/60). 2x 10G optical: OPT1 = ETH 1-6, OPT2 is its copy. 8/10-bit only. Inputs cap at 1920x1200, but this is an all-in-one with scaling and three layers, so the wall may legitimately be larger than any input — 3840 px wide is available in forced mode. This datasheet is the one that prints NovaStar’s capacity formula in full; see wireBitsPerPixel. Capacity figures re-checked against V1.5.1 (2026-04-30): unchanged.',
  },
  {
    id: 'novastar-ku20',
    manufacturer: 'NovaStar',
    model: 'KU20',
    ports: Array.from({ length: 6 }, (_, i) => novaGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 120, maxBitDepth: 8 },
    ],
    totalCapacityPx: 3_900_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar KU20 LED Display Controller Specifications V1.5.1, 2026-04-30, novastar.tech',
    notes:
      'The entry-level COEX box: one HDMI 1.3 input with loop-through (up to 8 units in a loop), six gigabit ports with hot backup between them, and one 10G optical port that mirrors the six. 8-bit output only — 10-bit needs a customised program from NovaStar and the A10s Pro. 3.9 Mpx is the port sum rounded down, as on the MX20. Max width 3840 (3840x600) or height 2560 (800x2560) in forced mode; 4096 px max output width/height.',
  },
  {
    id: 'novastar-mx2000-pro',
    manufacturer: 'NovaStar',
    model: 'MX2000 Pro (1G fibre)',
    ports: fibreTrunks10G(2),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 35_380_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX2000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'Card-based 2U chassis, so this record is a CONFIGURATION, not a fixed box: 2x MX_4x10G_Fiber output cards (8 trunks, 80 gigabit drops via CVT10 converters) and one MX_4xHDMI 2.0 input card. The chassis takes 2 input cards — up to 8x 4K or 4x 8K — from HDMI 2.0, HDMI 2.1, DP 1.2, DP 1.4, 12G-SDI and ST 2110; the inputs listed here are one card’s worth. For the 5G output cards see the MX2000 Pro (5G) record, which has different maths. The 35.38 Mpx device cap is the real limit: the eight trunks could carry 52.8 Mpx. Authentic 12-bit, and up to 360 Hz where the panels allow it. 1G figures re-checked against V1.5.1 (2026-04-30): unchanged.',
  },
  {
    id: 'novastar-mx2000-pro-5g',
    manufacturer: 'NovaStar',
    model: 'MX2000 Pro (5G)',
    ports: [novaFibreTrunk40G(1), novaFibreTrunk40G(2)],
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 35_380_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX2000 Pro LED Display Controller Specifications V1.5.1, 2026-04-30, novastar.tech',
    notes:
      'Same chassis as the 1G record, fitted with 2x 5G output cards instead — each either a CX_1x40G_Fiber trunk to a CVT8-5G converter or, since V1.5.1, an MX_8x5G_Base-T card with the eight 5-gigabit ports on copper; the per-port maths is identical. This is a different SYSTEM, not just a different cable: it needs 5G receiving cards (XA50 Pro, CA50E). Sixteen 5G links carry 47.2 Mpx at 8-bit/60, so the 35.38 Mpx chassis cap still binds. Re-rated by NovaStar in V1.5.0 — see nova5GPort for what changed.',
  },
  {
    id: 'novastar-mx6000-pro',
    manufacturer: 'NovaStar',
    model: 'MX6000 Pro (1G fibre)',
    ports: fibreTrunks10G(8),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 141_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX6000 Pro LED Display Controller Specifications V1.1.1, 2023-10-13, oss.novastar.tech',
    notes:
      'The flagship: a 6U card-based chassis, modelled here fully populated with 8x MX_4x10G_Fiber output cards — 32 trunks, 320 gigabit drops via CVT10 converters. The chassis takes 8 input cards (up to 32x 4K or 8x 8K, including SMPTE ST 2110 VoIP at 25G and 100G); the four inputs listed are one MX_4xHDMI 2.0 card’s worth. 141 Mpx is a genuine chassis limit — the 32 trunks could carry 211 Mpx — and it is the sum of eight per-card ceilings of 17,694,720 px (8192x2160). Hot backup at three levels: between devices, between output cards, and between Ethernet ports, with dual PSUs. 1G figures re-checked against V1.5.1 (2026-04-30): unchanged.',
  },
  {
    id: 'novastar-mx6000-pro-5g',
    manufacturer: 'NovaStar',
    model: 'MX6000 Pro (5G)',
    ports: Array.from({ length: 8 }, (_, i) => novaFibreTrunk40G(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi2', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi3', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
      { id: 'hdmi4', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 240, maxBitDepth: 12 },
    ],
    totalCapacityPx: 141_000_000,
    referenceBitDepth: 8,
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'NovaStar MX6000 Pro LED Display Controller Specifications V1.5.1, 2026-04-30, novastar.tech',
    notes:
      'Same chassis with 8x 5G output cards — CX_1x40G_Fiber trunks to CVT8-5G converters, or the MX_8x5G_Base-T copper card added in V1.5.1; either way eight 5-gigabit links per card, 64 drops instead of 320. They could carry 189 Mpx at 8-bit/60, comfortably past the 141 Mpx chassis cap, which is the point of the 5G solution. Needs 5G receiving cards (XA50 Pro, CA50E). Re-rated by NovaStar in V1.5.0 — see nova5GPort for what changed.',
  },
  {
    id: 'novastar-mctrl4k',
    manufacturer: 'NovaStar',
    model: 'MCTRL4K',
    ports: Array.from({ length: 16 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dp1', connector: 'DP 1.2', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 120, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 2.0', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 120, maxBitDepth: 12 },
      { id: 'dvi1', connector: 'DL-DVI', maxWidthPx: 3840, maxHeightPx: 1080, maxFps: 120, maxBitDepth: 12 },
      { id: 'dvi2', connector: 'DL-DVI', maxWidthPx: 3840, maxHeightPx: 1080, maxFps: 120, maxBitDepth: 12 },
    ],
    maxCanvasPx: 8_800_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL4K LED Display Controller Specifications V1.2.1, 2024-08-22, oss.novastar.tech',
    notes:
      'A send-only controller, not an all-in-one: no layers, no scaling, so the wall is the input canvas and 8.8 Mpx is a canvas ceiling rather than a bandwidth one — it is exactly 4096x2160 rounded down. From DVI the ceiling is 8.3 Mpx (2x 3840x1080). The 16 ports could carry 10.4 Mpx at 8-bit, so the canvas binds there and the ports bind at 10/12-bit. 4x 10G optical mirror the copper (OPT1 = ETH 1-8, OPT2 = ETH 9-16, OPT3/4 are their copies). NovaStar print 650,000 px/port at 8-bit and 320,000 at 10/12-bit; the 320,000 is a round-down of the 325,000 that their own MCTRL660 PRO figures imply, so this model shows ~1.6% more at 10/12-bit than the datasheet headline. HDR halves per-port capacity and needs 10-bit HDMI; so does 3D, and so does a forced 144 Hz input. Up to 10 units cascade.',
  },
  {
    id: 'novastar-mctrl660-pro',
    manufacturer: 'NovaStar',
    model: 'MCTRL660 PRO',
    ports: Array.from({ length: 6 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dvi1', connector: 'SL-DVI', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 1.4a', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'sdi1', connector: '3G-SDI', maxWidthPx: 1920, maxHeightPx: 1080, maxFps: 60, maxBitDepth: 12 },
    ],
    maxCanvasPx: 2_304_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL660 PRO Independent Controller Specifications V1.4.1, 2024-08-22, oss.novastar.tech',
    notes:
      'The box the mctrlGigPort efficiency is calibrated from: NovaStar publish both figures, 650,000 px/port at 8-bit and 325,000 at 10/12-bit, and the exact 2:1 is what proves the 48-bit container at 10-bit on this generation. 2.304 Mpx canvas ceiling is 1920x1200 at 60 Hz — the six ports could carry 3.9 Mpx, so the pipeline is the limit, not the links. At 30 Hz a forced 800x3840 gives 3.07 Mpx, which this ceiling does not model. 2x 10G optical: OPT1 carries all six Ethernet ports, OPT2 backs it up; the box also runs as a fibre converter rather than a sending card.',
  },
  {
    id: 'novastar-mctrl660',
    manufacturer: 'NovaStar',
    model: 'MCTRL660',
    ports: Array.from({ length: 4 }, (_, i) => mctrlGigPort(i + 1)),
    inputs: [
      { id: 'dvi1', connector: 'SL-DVI', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
      { id: 'hdmi1', connector: 'HDMI 1.3', maxWidthPx: 1920, maxHeightPx: 1200, maxFps: 60, maxBitDepth: 12 },
    ],
    maxCanvasPx: 2_304_000,
    redundancy: 'port-pair',
    verified: true,
    source:
      'NovaStar MCTRL660 LED Display Controller Specifications V1.4.4, 2024-08-22, oss.novastar.tech',
    notes:
      'The workhorse four-port sender. NovaStar publish only the 8-bit figure, 650,000 px/port; the 325,000 shown at 10/12-bit is inherited from the MCTRL660 PRO datasheet, which shares this port generation and states both. 2.304 Mpx canvas ceiling is 1920x1200 at 60 Hz, below the 2.6 Mpx the four ports could carry. No optical ports. Up to 20 units cascade over UART.',
  },
  {
    id: 'brompton-sx40',
    manufacturer: 'Brompton',
    model: 'Tessera SX40',
    ports: Array.from({ length: 4 }, (_, i) => bromptonTrunk(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0b', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 250, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 9_000_000,
    capacityScaling: 'pixel-rate',
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'Brompton Tessera SX40 Data Sheet, Feb 2025 EN, bromptontech.com; per-port and per-processor figures from Brompton’s "Tessera Processor Output Port Capacity" table (dl.bromptontech.com, processor version 3.5.2)',
    notes:
      '9 Mpx is a processor cap, not a link one: Brompton’s table gives the SX40 9,000,000 px at 8, 10 and 12-bit alike up to 60 Hz, then 7,500,000 at 72 Hz and 4,500,000 at 120 Hz. The four 10G trunks — copper or fibre, each breaking out to ten 1G fixture links through an XD unit — could carry 21 Mpx at 8-bit and 14 Mpx at 12-bit, so the box binds at every depth. HDMI 2.0b accepts 23.98-250 Hz at 8/10/12-bit; Ultra Low Latency halves every capacity figure. Processor Redundancy is whole-device failover. Brompton also cap a port at 500 panels and an SX40 at 2,000.',
  },
  {
    id: 'brompton-s8',
    manufacturer: 'Brompton',
    model: 'Tessera S8',
    ports: Array.from({ length: 8 }, (_, i) => bromptonGigPort(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.0b', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 250, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 10 },
    ],
    totalCapacityPx: 4_500_000,
    capacityScaling: 'pixel-rate',
    referenceFrameRateHz: 60,
    redundancy: 'port-pair',
    verified: true,
    source: 'Brompton Tessera S8 Data Sheet, Mar 2025 EN, bromptontech.com',
    notes:
      'The mid-range 1U box: eight direct gigabit Tessera outputs, "each capable of a nominal 525K pixels at 8 bits per colour, 60Hz", and a 4.5 Mpx processor cap. At 8-bit the ports sum to 4.2 Mpx and bind before the cap does; at 12-bit they carry 2.8 Mpx. Closed-loop redundancy pairs ports into loops (which is what "port-pair" means here). Full 4K60 input with a zero-latency scaler. The processor cap is assumed to derate above 60 Hz the way the SX40’s does; Brompton publish the shape for the SX40 only.',
  },
  {
    id: 'brompton-sq200',
    manufacturer: 'Brompton',
    model: 'Tessera SQ200 (36 Mpx, with QD-S)',
    ports: Array.from({ length: 12 }, (_, i) => bromptonTrunk(i + 1)),
    inputs: [
      { id: 'hdmi1', connector: 'HDMI 2.1', maxWidthPx: 8192, maxHeightPx: 4320, maxFps: 250, maxBitDepth: 12 },
      { id: 'dp1', connector: 'DP 2.1', maxWidthPx: 8192, maxHeightPx: 4320, maxFps: 250, maxBitDepth: 12 },
      { id: 'sdi1', connector: '12G-SDI', maxWidthPx: 4096, maxHeightPx: 2160, maxFps: 60, maxBitDepth: 12 },
    ],
    totalCapacityPx: 36_000_000,
    capacityScaling: 'pixel-rate',
    referenceFrameRateHz: 60,
    redundancy: 'device',
    verified: true,
    source:
      'Brompton Tessera SQ200 Data Sheet, Oct 2025 EN, and Tessera QD-S Data Sheet, June 2026 EN, bromptontech.com',
    notes:
      'A SYSTEM record: the SQ200 itself has two 100G QSFP28 outputs (primary and closed-loop backup) and no fixture ports. They feed a QD-S distribution unit, whose twelve 10G SFP+ ports are what is modelled here — each breaking out to ten 1G fixture links through an XD-S, exactly as an SX40 trunk does. Pixel capacity is licensed at 9, 18, 27 or 36 Mpx; this record is the 36 Mpx (8K) tier, and 36 Mpx at 36 bits and 60 Hz is precisely twelve trunks at 0.756 — Brompton size the QD-S to the licence. For a lower tier, set totalCapacityPx to the licence. The inputs listed are one baseband input card (HDMI 2.1, DP 2.1, 12G-SDI, one active at a time); up to four cards, plus 100G/25G/10G AV-over-IP (ST 2110, IPMX) up to 8K.',
  },
];

export function processorById(id: string): ProcessorSpec | undefined {
  return PROCESSOR_LIBRARY.find((p) => p.id === id);
}
