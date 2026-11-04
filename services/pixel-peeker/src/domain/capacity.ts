/**
 * Pixel Peeker — capacity maths.
 *
 * THE CENTRAL DISTINCTION, and the thing most spreadsheets get wrong:
 *
 *   1. LINK capacity (how many pixels fit down one output port) is set by
 *      link rate, colour bit depth and FRAME rate. The LED's visual refresh
 *      rate is irrelevant here — the frame arrives once per frame period and
 *      the receiving card re-scans it locally.
 *
 *   2. DRIVE capacity (whether the receiving card can actually paint those
 *      pixels at the wanted refresh) is set by the driver IC clock, the scan
 *      ratio and the panel's internal greyscale depth. Frame rate and input
 *      bit depth are nearly irrelevant here.
 *
 * Mixing the two is why people "lose" capacity at high refresh rates and can't
 * explain where it went. We model them separately and report both.
 */

import type {
  BitDepth,
  CabinetSpec,
  LinkFormat,
  PortSpec,
  ProcessorSpec,
  ReceivingCardSpec,
  SignalFormat,
} from './types';

/**
 * How a vendor packs a pixel onto the wire.
 *
 * THIS IS NOT `3 x bitDepth`, and assuming it is will overstate 10-bit capacity by
 * about 7%. Controllers pack each colour component into a power-of-two container so
 * the DMA engine stays word-aligned, so 10-bit costs the same wire space as 16-bit:
 *
 *   8-bit  -> 8+8+8    packed into 24 bits/px
 *   10-bit -> 10+10+10 packed into 32 bits/px   (not 30)
 *   12-bit -> 12+12+12 packed into 48 bits/px   (not 36)
 *
 * VERIFICATION: this was originally derived from NovaStar's three published MX40 Pro
 * per-port figures at 60 Hz — 659,722 px at 8-bit, 494,791 px at 10-bit and 329,861 px
 * at 10/12-bit — which ONE efficiency constant of exactly 0.9500 reproduces to the
 * pixel with the containers above, and which naive 3 x bitDepth packing fits with no
 * constant at all.
 *
 * It is no longer a derivation. The MX20, MX30, MX2000 Pro and MX6000 Pro
 * specifications print the formula itself:
 *
 *    8bit:  Load capacity x 24 x Frame rate < 1000 x 1000 x 1000 x 0.95
 *   10bit:  Load capacity x 32 x Frame rate < 1000 x 1000 x 1000 x 0.95
 *   12bit:  Load capacity x 48 x Frame rate < 1000 x 1000 x 1000 x 0.95
 *
 * Both constants, stated by the vendor. Nothing here is inferred any more.
 *
 * The same tables also show the 32-bit 10-bit container is a RECEIVING CARD property,
 * not a controller one: NovaStar publish a second table headed "When Working with Other
 * Armor Series Receiving Cards" in which 10-bit costs 48 bits and the per-port figure
 * drops from 494,791 to 329,861. `container` here is therefore the A10s Pro case. See
 * the known gap noted in `receiverCheck`.
 *
 * `container-legacy` is the pre-COEX MCTRL generation, which has no 32-bit path at all:
 * 10-bit costs the full 48 bits whatever card is on the other end. The MCTRL660 PRO
 * datasheet states both of its figures, and they are exactly 2:1 — 650,000 px at 8-bit
 * and 325,000 px at 10/12-bit — which is 24 vs 48 bits and cannot be 24 vs 32.
 *
 * `naive` — 24/30/36 bits — is not a straw man: it is what a Brompton Tessera link does.
 * Brompton's own per-port capacity table gives 525,000 / 420,000 / 350,000 px at 8/10/12-bit
 * and 60 Hz, which are exactly 24:30:36, and every row of it is one constant of
 * 756 Mbps of payload per gigabit port. (NovaStar's 5G solution was ALSO naive in its
 * V1.1.1 specification, at 24/30/36 bits and 0.7465 — V1.5.0 of September 2025 re-rated
 * it to power-of-two containers at 0.85, and that is what the library now carries.)
 */
export type PixelPacking = 'container' | 'container-legacy' | 'naive';

export function wireBitsPerPixel(
  bitDepth: BitDepth,
  packing: PixelPacking = 'container',
): number {
  if (packing === 'naive') return 3 * bitDepth;
  if (bitDepth <= 8) return 24;
  if (packing === 'container-legacy') return 48;
  if (bitDepth <= 10) return 32;
  return 48;
}

/**
 * Fraction of the raw line rate available to pixel payload, after framing, preamble,
 * inter-packet gap and the vendor's own protocol overhead.
 *
 * 0.95 is not a guess — see the verification note on `wireBitsPerPixel`. It reproduces
 * NovaStar's three published MX40 Pro figures exactly. Brompton's links carry
 * substantially more than raw RGB and are calibrated separately, per port, in the
 * processor library.
 */
export const DEFAULT_LINK_EFFICIENCY = 0.95;

/** The efficiency a port runs at for one bit depth — the per-depth override wins. */
export function portEfficiency(port: PortSpec, bitDepth: BitDepth): number {
  return port.efficiencyByDepth?.[bitDepth] ?? port.efficiency ?? DEFAULT_LINK_EFFICIENCY;
}

export interface PortCapacity {
  /** Pixels this port can carry at the given signal format. */
  capacityPx: number;
  /** Payload bits per second the port can move. */
  payloadBps: number;
  /** Bits each pixel occupies on the wire, after container packing. */
  bitsPerPixel: number;
}

/**
 * Pixels one output port can carry.
 *
 *   capacity = (linkRate x efficiency) / wireBitsPerPixel / frameRate
 *
 * No safety derate is applied: these figures match what the vendor's own software
 * will allow, and a designer comparing Pixel Peeker against VMP or Tessera needs the
 * numbers to agree. Headroom is a design decision, exposed as `fillTo` in auto-wiring.
 */
export function portCapacity(port: PortSpec, signal: LinkFormat): PortCapacity {
  const efficiency = portEfficiency(port, signal.bitDepth);
  const bitsPerPixel = wireBitsPerPixel(signal.bitDepth, port.packing);
  const payloadBps = port.linkSpeedGbps * 1e9 * efficiency;
  return {
    capacityPx: Math.floor(payloadBps / bitsPerPixel / signal.frameRateHz),
    payloadBps,
    bitsPerPixel,
  };
}

/**
 * Whole-device capacity at the given signal format.
 *
 * Vendors quote `totalCapacityPx` at a reference bit depth and frame rate; scale it to
 * the actual signal by wire cost. The device cap is frequently *lower* than the sum of
 * the ports and is then the real limit — the MX40 Pro has 20 gigabit ports that could
 * carry 13.2 Mpx between them but the box is rated 9 Mpx.
 *
 * `maxCanvasPx` is the third limit and the one that does NOT scale: it is the video
 * pipeline's canvas rather than its bandwidth, so it stays put while the other two
 * derate. On the send-only MCTRL boxes it is the limit at 8-bit and the ports take over
 * at 10/12-bit. See the field comment on `ProcessorSpec`.
 *
 * Brompton sit between the two: a Tessera processor's headline is a pixel count that
 * ignores bit depth entirely but still halves when the frame rate doubles past 60 Hz.
 * `capacityScaling: 'pixel-rate'` selects that shape — see the field comment.
 */
export function processorCapacity(spec: ProcessorSpec, signal: LinkFormat): number {
  const portSum = spec.ports.reduce((n, p) => n + portCapacity(p, signal).capacityPx, 0);
  const canvasCap = spec.maxCanvasPx ?? Infinity;
  if (spec.totalCapacityPx == null) return Math.min(portSum, canvasCap);

  const refFps = spec.referenceFrameRateHz ?? 60;
  if (spec.capacityScaling === 'pixel-rate') {
    const scaled = Math.floor(spec.totalCapacityPx * Math.min(1, refFps / signal.frameRateHz));
    return Math.min(portSum, scaled, canvasCap);
  }

  const refBits = wireBitsPerPixel(spec.referenceBitDepth ?? 8, spec.ports[0]?.packing);
  const nowBits = wireBitsPerPixel(signal.bitDepth, spec.ports[0]?.packing);
  const scaled = Math.floor(
    (spec.totalCapacityPx * refBits * refFps) / nowBits / signal.frameRateHz,
  );
  return Math.min(portSum, scaled, canvasCap);
}

// ---------------------------------------------------------------------------
// Drive-side model — can the receiving card actually paint it?
// ---------------------------------------------------------------------------

export interface DriveCheck {
  /** Highest visual refresh achievable, per whichever source we trust most. */
  achievableRefreshHz: number;
  /** True when `achievableRefreshHz` came from a manufacturer figure, not the model. */
  fromDatasheet: boolean;
  ok: boolean;
  detail: string;
}

/**
 * Can this cabinet hit the wanted visual refresh rate?
 *
 * NOTE ON WHAT DOES *NOT* MATTER HERE: the signal bit depth. A panel's quoted refresh
 * rate is achieved at its own internal greyscale depth (`spec.greyscaleBits`, typically
 * 14-16 bit). The receiving card takes the 8/10/12-bit input and drives the LEDs at that
 * internal depth regardless, so feeding a panel 10-bit instead of 8-bit costs link
 * bandwidth but does not cost refresh rate.
 *
 * When a manufacturer figure exists it is used as-is. Otherwise we fall back to a MODEL:
 * a multiplexed panel clocks out `2^greyscaleBits` grey slots for each of `scanRate`
 * row-groups per refresh period, so
 *
 *   maxRefresh = driverClock x spwmGain / (scanRate x 2^greyscaleBits)
 *
 * Real S-PWM driver ICs spread those slots and beat the naive figure, hence the gain
 * term. The model is rough and is labelled as such wherever it surfaces in the UI.
 */
export function driveCheck(
  spec: CabinetSpec,
  receiver: ReceivingCardSpec | undefined,
  signal: SignalFormat,
): DriveCheck {
  const quoted = spec.maxRefreshHz ?? receiver?.maxRefreshHz;
  if (quoted != null) {
    return {
      achievableRefreshHz: quoted,
      fromDatasheet: true,
      ok: quoted >= signal.ledRefreshHz,
      detail: `Manufacturer-quoted ${quoted.toLocaleString()} Hz${
        spec.greyscaleBits ? ` at ${spec.greyscaleBits}-bit internal greyscale` : ''
      }.`,
    };
  }

  const scan = spec.scanRate ?? 1;
  const grey = spec.greyscaleBits ?? 14;
  const DRIVER_CLOCK_HZ = 30e6; // typical 30 MHz shift clock
  const SPWM_GAIN = 512; // S-PWM slot-spreading gain over naive binary-weighted PWM
  const achievable = Math.floor((DRIVER_CLOCK_HZ * SPWM_GAIN) / (scan * 2 ** grey));
  return {
    achievableRefreshHz: achievable,
    fromDatasheet: false,
    ok: achievable >= signal.ledRefreshHz,
    detail: `Modelled from 1/${scan} scan at ${grey}-bit greyscale — this cabinet has no manufacturer refresh figure, treat as indicative only.`,
  };
}

/**
 * Does one cabinet exceed what its receiving card can address?
 *
 * KNOWN GAP: on the COEX controllers the receiving card also decides the 10-bit wire
 * cost — 32 bits with an A10s Pro, 48 bits with any other Armor card, which is the
 * difference between 494,791 px and 329,861 px per gigabit port at 60 Hz. `container`
 * packing models the A10s Pro case for every card, so a wall built on A8s cards is
 * currently shown 50% more 10-bit port capacity than it has. Closing this means
 * threading the receiver into `portCapacity`, which today is called from `wiring.ts`
 * and `export/novastar.ts` with only the port in scope.
 */
export function receiverCheck(
  spec: Pick<CabinetSpec, 'pixelsX' | 'pixelsY'>,
  receiver: ReceivingCardSpec | undefined,
): { ok: boolean; detail: string } {
  if (!receiver) {
    return { ok: true, detail: 'No receiving card assigned — not checked.' };
  }
  const px = spec.pixelsX * spec.pixelsY;
  if (px > receiver.maxPixels) {
    return {
      ok: false,
      detail: `${px.toLocaleString()} px exceeds the ${receiver.model} limit of ${receiver.maxPixels.toLocaleString()} px.`,
    };
  }
  if (receiver.maxWidthPx && spec.pixelsX > receiver.maxWidthPx) {
    return {
      ok: false,
      detail: `${spec.pixelsX} px wide exceeds the ${receiver.model} limit of ${receiver.maxWidthPx} px.`,
    };
  }
  if (receiver.maxHeightPx && spec.pixelsY > receiver.maxHeightPx) {
    return {
      ok: false,
      detail: `${spec.pixelsY} px high exceeds the ${receiver.model} limit of ${receiver.maxHeightPx} px.`,
    };
  }
  return {
    ok: true,
    detail: `${px.toLocaleString()} px of ${receiver.maxPixels.toLocaleString()} px on the ${receiver.model}.`,
  };
}

/** Highest frame rate a port can sustain for a given pixel count. */
export function maxFrameRateFor(
  port: PortSpec,
  pixels: number,
  bitDepth: BitDepth,
): number {
  if (pixels <= 0) return Infinity;
  const bps = port.linkSpeedGbps * 1e9 * portEfficiency(port, bitDepth);
  return bps / wireBitsPerPixel(bitDepth, port.packing) / pixels;
}
