/**
 * Pixel Peeker — core domain types.
 *
 * Units convention (enforced by naming, there is no unit-checking type system here):
 *   *Mm   millimetres
 *   *Px   pixels
 *   *Hz   hertz
 *   *W    watts
 *   *Kg   kilograms
 *
 * PROVENANCE: every spec record carries `verified` + `source`. `verified: true` means the
 * numbers were taken from a manufacturer datasheet that a human checked. Everything else is
 * a plausible placeholder for UI work and MUST NOT be used to quote a real job. The UI
 * surfaces this; do not silently flip the flag.
 */

export type Provenance = {
  /** True only when a human has checked these numbers against a manufacturer datasheet. */
  verified: boolean;
  /** Where the numbers came from, or what still needs checking. */
  source?: string;
};

export type Manufacturer =
  | 'Aluvision'
  | 'Absen'
  | 'Gloshine'
  | 'ROE Visual'
  | 'Unilumin'
  | 'Custom';

export type ProcessorMake = 'NovaStar' | 'Brompton' | 'Custom';

/** Colour depth of the pixel data on the wire, per colour component. */
export type BitDepth = 8 | 10 | 12;

// ---------------------------------------------------------------------------
// Receiving cards
// ---------------------------------------------------------------------------

export interface ReceivingCardSpec extends Provenance {
  id: string;
  manufacturer: ProcessorMake;
  model: string;
  /** Hard cap on pixels the card can drive, regardless of geometry. */
  maxPixels: number;
  /** Geometry caps, if the card has them (many do — e.g. 256 wide max). */
  maxWidthPx?: number;
  maxHeightPx?: number;
  /** Highest visual refresh the card's driver stage can sustain, at `refreshRefBitDepth`. */
  maxRefreshHz?: number;
  refreshRefBitDepth?: BitDepth;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Cabinets (tiles)
// ---------------------------------------------------------------------------

export interface CabinetSpec extends Provenance {
  id: string;
  manufacturer: Manufacturer;
  series: string;
  model: string;
  pixelPitchMm: number;

  widthMm: number;
  heightMm: number;
  depthMm: number;

  pixelsX: number;
  pixelsY: number;

  weightKg: number;
  /** Peak power draw with an all-white frame at full brightness. */
  powerMaxW: number;
  /** Typical / average power draw for a real programme. */
  powerAvgW: number;

  /** Multiplex ratio denominator — 16 means 1/16 scan. Undefined for static drive. */
  scanRate?: number;
  /** Receiving card fitted as standard, referencing the receiver library. */
  receivingCardId?: string;
  /** Manufacturer-quoted visual refresh rate. Authoritative over the modelled value. */
  maxRefreshHz?: number;
  /**
   * The panel's INTERNAL greyscale processing depth, per colour — typically 14–16 bit.
   * This is not the same thing as `SignalFormat.bitDepth`, which is the depth of the
   * video on the wire (8/10/12). The receiving card takes the 8/10/12-bit input and
   * drives the LEDs at this internal depth, which is why input depth does not change
   * the achievable refresh rate. Conflating the two is the classic error.
   */
  greyscaleBits?: number;
  /** Nits at the quoted refresh/bit depth. */
  brightnessNits?: number;

  notes?: string;
}

export function cabinetPixels(spec: CabinetSpec): number {
  return spec.pixelsX * spec.pixelsY;
}

// ---------------------------------------------------------------------------
// Processors (sending cards / LED processors)
// ---------------------------------------------------------------------------

export type PortMedium = 'RJ45' | 'SFP' | 'SFP+' | 'Fibre';

export interface PortSpec {
  id: string;
  label: string;
  /** Physical line rate of the link. */
  linkSpeedGbps: number;
  medium: PortMedium;
  /**
   * Fraction of the line rate that actually carries pixel payload, after framing,
   * preamble, inter-packet gap and the vendor's own protocol overhead.
   * See `DEFAULT_LINK_EFFICIENCY` in capacity.ts for how the default was calibrated.
   */
  efficiency?: number;
  /**
   * Per-bit-depth override of `efficiency`, for the rare vendor who publishes a different
   * constant for one depth. NovaStar's 5G ports are the case in hand: their formula prints
   * 0.85 at 8-bit and 12-bit but 0.88 at 10-bit, and the table beneath it bears that out.
   * Depths not listed here fall back to `efficiency`.
   */
  efficiencyByDepth?: Partial<Record<BitDepth, number>>;
  /** How pixels are packed onto the wire. See `wireBitsPerPixel` in capacity.ts. */
  packing?: 'container' | 'container-legacy' | 'naive';
  /**
   * Some vendors present one physical port as N independent fixture links —
   * a Brompton 10G trunk is ten 1G connections. Informational: capacity is still
   * computed from the trunk's total link rate.
   */
  subLinks?: number;
}

export interface InputSpec {
  id: string;
  connector: string;
  maxWidthPx: number;
  maxHeightPx: number;
  maxFps: number;
  maxBitDepth: BitDepth;
}

export interface ProcessorSpec extends Provenance {
  id: string;
  manufacturer: ProcessorMake;
  model: string;
  ports: PortSpec[];
  inputs: InputSpec[];
  /**
   * Whole-device pixel ceiling at `referenceBitDepth` / `referenceFrameRateHz`.
   * Often lower than the sum of the ports — the device backplane, not the links,
   * is the limit. Undefined means "ports are the only limit".
   */
  totalCapacityPx?: number;
  referenceBitDepth?: BitDepth;
  referenceFrameRateHz?: number;
  /**
   * How `totalCapacityPx` moves with the signal format.
   *
   * - `bandwidth` (the default): a link-rate figure quoted at the reference format, so it
   *   scales by wire bits per pixel AND by frame rate. NovaStar quote this way.
   * - `pixel-rate`: a processing figure — the pixels per frame the box can map, the same
   *   at 8, 10 and 12-bit, flat up to the reference frame rate and proportional to
   *   1/frameRate above it. Brompton publish this shape: the SX40 is 9 Mpx at every bit
   *   depth up to 60 Hz, 7.5 Mpx at 72 Hz and 4.5 Mpx at 120 Hz. Bit depth still costs
   *   the ports, just not the processor.
   */
  capacityScaling?: 'bandwidth' | 'pixel-rate';
  /**
   * A FIXED pixel ceiling that does not move with bit depth or frame rate — unlike
   * `totalCapacityPx`, which is a bandwidth figure quoted at a reference format and is
   * scaled from it.
   *
   * This is the video pipeline's canvas, not its bandwidth. A send-only controller like
   * the MCTRL4K maps the input canvas to the wall pixel-for-pixel, so a 4096x2160 input
   * is 8.85 Mpx whether it arrives at 8-bit or 12-bit; feeding it deeper colour costs
   * link bandwidth and nothing else. Scaling that ceiling by wire cost would understate
   * the device at 10/12-bit by the same factor it correctly derates the ports.
   *
   * Undefined for the COEX all-in-one boxes and for Brompton: those scale and compose
   * layers, so their wall can be considerably larger than any one input.
   */
  maxCanvasPx?: number;
  /** How the device does backup. `port-pair` = ports pair up as main/backup. */
  redundancy: 'none' | 'port-pair' | 'device';
  notes?: string;
}

// ---------------------------------------------------------------------------
// Signal format — the conditions the whole wall runs at
// ---------------------------------------------------------------------------

export interface SignalFormat {
  bitDepth: BitDepth;
  /** Frame rate of the video signal. This is what consumes link bandwidth. */
  frameRateHz: number;
  /**
   * Visual refresh rate of the LED (the PWM rate the driver ICs run at).
   * This does NOT consume link bandwidth — it is a receiving-card/driver limit.
   * Kept here because it is the number cameras care about.
   */
  ledRefreshHz: number;
}

/**
 * The part of a signal format that costs link bandwidth: bit depth and frame rate.
 * The capacity functions take this rather than the whole `SignalFormat` so the Line calc
 * view can ask with exactly these two — it deliberately has no refresh input.
 */
export type LinkFormat = Pick<SignalFormat, 'bitDepth' | 'frameRateHz'> & {
  /** Allowed so a whole `SignalFormat` can be passed, and ignored: refresh costs no link bandwidth. */
  ledRefreshHz?: number;
};

// ---------------------------------------------------------------------------
// Power plan — the circuits the wall is fed from
// ---------------------------------------------------------------------------

/**
 * How the wall is powered, for the per-circuit count in the Power section and the PDF.
 * Optional on `Project`: files saved before it existed load with `DEFAULT_POWER_PLAN`
 * (see `domain/power-line.ts`). Always costed on PEAK power — a distro sized on the
 * average trips on the first white holding slide.
 */
export interface PowerPlan {
  /** One of `SUPPLIES` in `domain/power-line.ts`. */
  supplyId: string;
  breakerAmps: number;
  /** Apply the 80% continuous-load rule. Off = the full breaker rating, a trip point. */
  derated: boolean;
}

// ---------------------------------------------------------------------------
// Wall layout
// ---------------------------------------------------------------------------

/** One physical cabinet hung on the wall. */
export interface CabinetInstance {
  id: string;
  specId: string;
  /** Top-left corner, millimetres, in wall space. */
  xMm: number;
  yMm: number;
  /** 0 or 180 only — LED cabinets are not rotated 90° in practice. */
  rotation: 0 | 180;
}

export interface Canvas {
  name: string;
  /** Design envelope. Cabinets may be placed outside it; that is flagged, not blocked. */
  widthMm: number;
  heightMm: number;
  /** Snap grid for placement. */
  snapMm: number;
}

// ---------------------------------------------------------------------------
// Systems and wiring
// ---------------------------------------------------------------------------

/** A processor placed in the show — an instance of a ProcessorSpec. */
export interface ProcessorInstance {
  id: string;
  specId: string;
  name: string;
}

/**
 * An ordered daisy-chain of cabinets hanging off one output port.
 * Order matters: it is the physical cable run, and it is what LCT/VMP call the
 * "sending order". `cabinetIds[0]` is the first cabinet out of the port.
 */
export interface Chain {
  id: string;
  processorId: string;
  portId: string;
  cabinetIds: string[];
  /** Optional colour override for the wiring view. */
  colour?: string;
}

export interface Project {
  schema: 'pixel-peeker/1';
  name: string;
  client?: string;
  venue?: string;
  designer?: string;
  notes?: string;
  canvas: Canvas;
  signal: SignalFormat;
  cabinets: CabinetInstance[];
  processors: ProcessorInstance[];
  chains: Chain[];
  /** Specs authored in this project (custom panels/processors), merged over the library. */
  customCabinets: CabinetSpec[];
  customProcessors: ProcessorSpec[];
  customReceivers: ReceivingCardSpec[];
  /** Absent in files saved before the power model existed; read it through `resolvePowerPlan`. */
  power?: PowerPlan;
}
