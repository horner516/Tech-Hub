import type { Timing } from '../timing/types.ts'

/**
 * The EDID model.
 *
 * Deliberately NOT a byte array with accessors. Every field here is stated in
 * the unit a person thinks in — gamma as 2.20, not 120; year as 2026, not 36;
 * pixel clock in Hz, not tens of kHz — and the encoder is the single place that
 * knows how each one is squeezed into the block. That means an out-of-range
 * value is caught by the encoder with a message naming the field, rather than
 * silently wrapping.
 */

export type DigitalInterface =
  | 'undefined'
  | 'dvi'
  | 'hdmi-a'
  | 'hdmi-b'
  | 'mddi'
  | 'displayport'

export type BitDepth = 'undefined' | 6 | 8 | 10 | 12 | 14 | 16

export interface DigitalInput {
  kind: 'digital'
  bitDepth: BitDepth
  interface: DigitalInterface
}

export interface AnalogInput {
  kind: 'analog'
  /** Signal level standard, 0-3 as EDID numbers them. */
  levels: 0 | 1 | 2 | 3
  blankToBlackSetup: boolean
  separateSyncSupported: boolean
  compositeSyncSupported: boolean
  syncOnGreenSupported: boolean
  vsyncSerrated: boolean
}

export type VideoInput = DigitalInput | AnalogInput

/** How the display's colour encodings are advertised in the base block. */
export type ColorEncoding =
  | 'rgb444'
  | 'rgb444-ycrcb444'
  | 'rgb444-ycrcb422'
  | 'rgb444-ycrcb444-ycrcb422'

export interface Features {
  standby: boolean
  suspend: boolean
  activeOff: boolean
  colorEncoding: ColorEncoding
  srgbDefault: boolean
  /** Descriptor 1 is the preferred timing AND the native pixel format.
   *  Mandatory for EDID 1.4 — a 1.4 EDID with this clear is malformed. */
  preferredTimingIsNative: boolean
  /** The display accepts any rate inside the range descriptor, not just the
   *  listed modes. This is the bit that makes a processor's custom-format
   *  output legal. */
  continuousFrequency: boolean
}

export interface Chromaticity {
  redX: number
  redY: number
  greenX: number
  greenY: number
  blueX: number
  blueY: number
  whiteX: number
  whiteY: number
}

export interface EstablishedTimings {
  /** Keyed by the EDID bit name, e.g. '800x600@60'. Only true entries are set. */
  [mode: string]: boolean
}

export type StdAspect = '16:10' | '4:3' | '5:4' | '16:9'

export interface StandardTiming {
  hActive: number
  aspect: StdAspect
  refreshHz: number
}

export interface DetailedTimingDescriptor {
  kind: 'dtd'
  timing: Timing
  /** Image size in mm. Zero means "not stated", which is legal and common on
   *  a processor-facing EDID where there is no physical panel. */
  hSizeMm: number
  vSizeMm: number
  hBorder: number
  vBorder: number
  /** Analog composite / bipolar / digital composite / digital separate. Every
   *  modern EDID uses digital separate; the others exist for CRT era kit. */
  syncType: 'analog-composite' | 'bipolar-analog' | 'digital-composite' | 'digital-separate'
  stereo: 'none' | 'field-right' | 'field-left' | 'interleaved-right' | 'interleaved-left' | 'interleaved-4way' | 'side-by-side'
}

export interface DisplayNameDescriptor {
  kind: 'name'
  text: string
}

export interface SerialDescriptor {
  kind: 'serial'
  text: string
}

export interface TextDescriptor {
  kind: 'text'
  text: string
}

export type TimingSupportFlag =
  | 'default-gtf'
  | 'range-limits-only'
  | 'secondary-gtf'
  | 'cvt'

export interface RangeLimitsDescriptor {
  kind: 'range'
  minVerticalHz: number
  maxVerticalHz: number
  minHorizontalKHz: number
  maxHorizontalKHz: number
  /** In MHz. Encoded in 10 MHz steps, so it is rounded UP at encode time —
   *  rounding down would advertise less than the display can take. */
  maxPixelClockMHz: number
  support: TimingSupportFlag
  /** Only meaningful when support === 'cvt'. */
  cvt?: {
    version: number
    maxActivePixelsPerLine: number
    supportedAspects: StdAspect[]
    preferredAspect: StdAspect
    reducedBlanking: boolean
    standardBlanking: boolean
    scalingHorizontalShrink: boolean
    scalingHorizontalStretch: boolean
    scalingVerticalShrink: boolean
    scalingVerticalStretch: boolean
    preferredRefreshHz: number
  }
}

export interface EstablishedTimingsIIIDescriptor {
  kind: 'established-iii'
  /**
   * Mode labels from ESTABLISHED_III_MODES, in that module's order.
   *
   * Deliberately labels and not DMT codes: this descriptor is a POSITIONAL
   * bitmap, and several of its slots (848x480@60, 1360x768@60) have no DMT ID
   * at all. Storing codes would need a lossy mapping in both directions.
   */
  modes: string[]
}

export interface DummyDescriptor {
  kind: 'dummy'
}

export interface RawDescriptor {
  kind: 'raw'
  bytes: number[]
}

export type Descriptor =
  | DetailedTimingDescriptor
  | DisplayNameDescriptor
  | SerialDescriptor
  | TextDescriptor
  | RangeLimitsDescriptor
  | EstablishedTimingsIIIDescriptor
  | DummyDescriptor
  | RawDescriptor

// ---------------------------------------------------------------- extensions

export interface AudioDescriptor {
  /** CTA short audio descriptor format code. 1 = LPCM. */
  format: number
  channels: number
  /** Sample rates in kHz that are set. */
  rates: number[]
  /** LPCM bit depths, or the max bitrate for compressed formats. */
  lpcmDepths?: number[]
  maxBitrateKbps?: number
}

export interface HdmiVsdb {
  /** Source physical address, A.B.C.D. */
  physicalAddress: [number, number, number, number]
  supportsAi: boolean
  deepColor30: boolean
  deepColor36: boolean
  deepColor48: boolean
  deepColorY444: boolean
  dviDual: boolean
  /** In MHz. 0 means not stated, which caps a sink at 165 MHz in practice. */
  maxTmdsClockMHz: number
}

export interface HdmiForumVsdb {
  version: number
  /** Max TMDS character rate in MHz — the HDMI 2.0 field, above 340. */
  maxTmdsCharacterRateMHz: number
  scdcPresent: boolean
  /** Read request capable. */
  rrCapable: boolean
  lte340ScrambleSupported: boolean
  deepColor420_30: boolean
  deepColor420_36: boolean
  deepColor420_48: boolean
  /** HDMI 2.1 fixed rate link lanes/rate. 0 = TMDS only. */
  maxFrlRate: number
  /** Display Stream Compression. */
  dscCapable: boolean
  dsc10bpc: boolean
  dsc12bpc: boolean
  dscNative420: boolean
  dscAllBpp: boolean
  dscMaxFrlRate: number
  dscMaxSlices: number
  dscTotalChunkKBytes: number
  /** Variable refresh rate window, in Hz. Zero/zero means not supported. */
  vrrMin: number
  vrrMax: number
  /** Quick Media Switching — VRR's companion, removes the blank on rate change. */
  qmsSupported: boolean
  qmsTfrMin: boolean
  qmsTfrMax: boolean
  allmSupported: boolean
  fvaSupported: boolean
  cnmVrr: boolean
  cinemaVrr: boolean
  mDelta: boolean
}

export interface HdrStaticMetadata {
  /** Electro-optical transfer functions: traditional SDR, traditional HDR,
   *  SMPTE ST 2084 (PQ), Hybrid Log-Gamma. */
  eotfSdr: boolean
  eotfHdr: boolean
  eotfSmpte2084: boolean
  eotfHlg: boolean
  staticMetadataType1: boolean
  /** Coded values, as the block stores them; undefined = field absent. */
  maxLuminance?: number
  maxFrameAverageLuminance?: number
  minLuminance?: number
}

export interface Colorimetry {
  xvYCC601: boolean
  xvYCC709: boolean
  sYCC601: boolean
  opYCC601: boolean
  opRGB: boolean
  bt2020cYCC: boolean
  bt2020YCC: boolean
  bt2020RGB: boolean
  dciP3: boolean
  /** Metadata profiles MD0-MD3. */
  md: [boolean, boolean, boolean, boolean]
}

export interface VideoCapability {
  /** Quantization range selectable, RGB and YCC. */
  qySelectableYcc: boolean
  qsSelectableRgb: boolean
  /** Overscan/underscan behaviour for PT / IT / CE video. */
  ptScan: 0 | 1 | 2 | 3
  itScan: 0 | 1 | 2 | 3
  ceScan: 0 | 1 | 2 | 3
}

export interface CtaExtension {
  kind: 'cta'
  revision: number
  underscanIt: boolean
  basicAudio: boolean
  ycbcr444: boolean
  ycbcr422: boolean
  /** Short video descriptors: VIC, plus the native flag. */
  videoDescriptors: { vic: number; native: boolean }[]
  audioDescriptors: AudioDescriptor[]
  /** Speaker allocation bitmap, byte 0 of the SAB. */
  speakerAllocation?: number
  hdmiVsdb?: HdmiVsdb
  hdmiForumVsdb?: HdmiForumVsdb
  hdrStaticMetadata?: HdrStaticMetadata
  colorimetry?: Colorimetry
  videoCapability?: VideoCapability
  /** VICs the sink can take only as 4:2:0. */
  ycbcr420OnlyVics: number[]
  /** Indices into videoDescriptors that ALSO work as 4:2:0. */
  ycbcr420AlsoVics: number[]
  detailedTimings: DetailedTimingDescriptor[]
  /** Anything parsed but not modelled, kept byte-exact so a decode/encode
   *  round-trip of a real device's EDID cannot lose data. */
  unknownBlocks: number[][]
  /** How the block looked when it was decoded. Absent on anything built here. */
  source?: CtaSource
}

/** Which model field a CTA data block feeds. */
export type CtaBlockKey =
  | 'video'
  | 'audio'
  | 'speaker'
  | 'hdmi'
  | 'hdmiForum'
  | 'videoCapability'
  | 'colorimetry'
  | 'hdr'
  | 'ycbcr420Only'
  | 'ycbcr420Also'
  | 'unknown'

/**
 * The layout of a decoded CTA block, so an import that is not edited saves
 * back byte for byte. The encoder has its own block order and writes only the
 * fields it models; a real device's EDID is under no obligation to match
 * either. Each `model` is a canonical serialisation of the fields the block
 * decoded into: while those still serialise the same, the original bytes go
 * back out in their original place, reserved bits and all. Once a field is
 * edited, that block alone is re-encoded, in the same place.
 */
export interface CtaSource {
  /** The 127 bytes before the checksum, as read. */
  bytes: number[]
  /** The whole extension (less this field), serialised the same way. */
  model: string
  blocks: { key: CtaBlockKey; bytes: number[]; model: string }[]
  /** Header byte 3's native-DTD count, which a sink need not set to "all". */
  nativeDtds: number
}

export interface DisplayIdTiming {
  timing: Timing
  preferred: boolean
  /** DisplayID's own aspect ratio enum, kept because it is not derivable —
   *  a 1920x1080 timing can legally be tagged 64:27 for anamorphic use. */
  aspect: string
  /** 1000/1001 variant of the stated rate. */
  fractional: boolean
}

/**
 * Tiled Display Topology — the block that tells a source several connectors
 * are one display. A host groups connectors by `topologyId` and places each by
 * its location; every tile of one display must carry the same id, grid and
 * tile size, and a different location.
 */
export interface TiledTopology {
  /** Byte 0 verbatim. Bit 7 = all tiles in one physical enclosure; the rest
   *  describe behaviour when only some tiles are driven. Kept whole because
   *  the Mac-bonding reference sets 0x0A and nothing proves which bits matter. */
  capabilities: number
  /** Grid, as counts (1-based). */
  hTiles: number
  vTiles: number
  /** This tile's place in the grid, 0-based from the top left. */
  hLocation: number
  vLocation: number
  /** One tile's active area, in pixels. */
  tileWidth: number
  tileHeight: number
  /** Bytes 8-12 verbatim: pixel multiplier, then top/bottom/right/left bezel. */
  bezel: number[]
  /** Bytes 13-21 verbatim: 3 ASCII vendor letters, 2 product bytes, 4 serial
   *  bytes. Compared as bytes by hosts, so kept as bytes here. */
  topologyId: number[]
}

export interface DisplayIdExtension {
  kind: 'displayid'
  /** 0x20 = DisplayID 2.0; 0x12 = DisplayID 1.3. The version decides which
   *  tag numbers the data blocks use. */
  version: number
  primaryUseCase: number
  /** Further DisplayID sections beyond this one. Almost always 0. */
  extensionCount: number
  /** Type VII timings — the 20-byte detailed descriptors (DisplayID 2.0). */
  type7Timings: DisplayIdTiming[]
  /** Type I timings — DisplayID 1.3's 20-byte descriptor, clock in 10 kHz. */
  type1Timings?: DisplayIdTiming[]
  tiled?: TiledTopology
  /** The section length byte as read. A section may declare more bytes than
   *  its blocks use (zero-padded to fill the extension); re-encoding to the
   *  shorter length would change bytes a real host has accepted. */
  sectionLength?: number
  /** Display Interface Features data block. */
  interfaceFeatures?: {
    /** Bits per colour supported over the native interface. */
    bpc: number[]
    /** DSC pass-through. */
    dscPassthrough: boolean
    /** Minimum pixel rate at which the sink can accept audio, in MHz. */
    minPixelRateAudioMHz: number
  }
  unknownBlocks: number[][]
}

export interface RawExtension {
  kind: 'raw'
  tag: number
  bytes: number[]
}

export type Extension = CtaExtension | DisplayIdExtension | RawExtension

// --------------------------------------------------------------------- root

export interface Edid {
  manufacturerId: string
  productCode: number
  serialNumber: number
  /** 0-54. 0xFF means byte 17 is a MODEL year, not a manufacture year. */
  week: number
  /** Full year, e.g. 2026. Encoded as year-1990, so 1990..2245 is the range. */
  year: number
  isModelYear: boolean
  version: number
  revision: number
  input: VideoInput
  /** Centimetres. Both zero = size undefined. */
  screenWidthCm: number
  screenHeightCm: number
  /** 1.00 to 3.54, or null for "defined in an extension" (EDID 1.4 only). */
  gamma: number | null
  features: Features
  chromaticity: Chromaticity
  established: EstablishedTimings
  standardTimings: (StandardTiming | null)[]
  descriptors: Descriptor[]
  extensions: Extension[]
}
