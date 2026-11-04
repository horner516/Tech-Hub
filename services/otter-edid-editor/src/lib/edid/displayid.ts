import type { DisplayIdExtension, DisplayIdTiming, TiledTopology } from './types.ts'
import { checksum } from './encode.ts'

/**
 * DisplayID 2.0 carried as an EDID extension block (tag 0x70).
 *
 * The reason it exists here: a DTD's pixel clock field tops out at 655.35 MHz,
 * so 3840x2160p120 (1188 MHz) and anything above simply CANNOT be stated in a
 * base block or a CTA extension. A DisplayID Type VII descriptor states the
 * clock in kHz across 24 bits, which reaches 16.7 GHz.
 *
 * Layout, verified byte-for-byte against the Linux kernel's parser
 * (drivers/gpu/drm/drm_edid.c drm_mode_displayid_detailed and
 * drm_displayid_internal.h) rather than written from the spec text:
 *
 *   ext[0]    0x70
 *   ext[1]    version/revision — 0x20 for DisplayID 2.0
 *   ext[2]    number of payload bytes (data blocks only; header and checksum excluded)
 *   ext[3]    primary use case
 *   ext[4]    extension count
 *   ext[5..]  data blocks, each: tag, revision, payload length, payload
 *   then      DisplayID checksum — bytes [1 .. n] sum to 0 mod 256
 *   then      pad to 126, EDID checksum at 127
 *
 * Type VII descriptor, 20 bytes, EVERY count stored as value-minus-one:
 *   0-2   pixel clock in kHz, minus 1, little-endian 24-bit
 *   3     bit 7 preferred, bits 6-4 aspect ratio, rest kept verbatim
 *   4-5   hActive-1        6-7   hBlank-1
 *   8-9   hFront-1, bit 15 = hsync positive
 *   10-11 hSyncWidth-1
 *   12-13 vActive-1       14-15  vBlank-1
 *   16-17 vFront-1, bit 15 = vsync positive
 *   18-19 vSyncWidth-1
 *
 * The minus-one is the trap: a naive encoder is off by one pixel on every
 * field, which shifts the image and changes the clock by a few kHz — enough to
 * look like a bad cable rather than a bad EDID.
 */

export const TAG_TYPE_7_TIMING = 0x22
export const TAG_DISPLAY_INTERFACE_FEATURES = 0x26
export const TAG_TILED_TOPOLOGY = 0x28

/**
 * DisplayID 1.3 numbers its blocks differently (drm_displayid_internal.h,
 * DATA_BLOCK_*): Type I timing is 0x03 and Tiled Display is 0x12. A section's
 * version byte decides which table applies — 0x03 in a 2.0 section is not a
 * timing. The tiled payload itself is the same 22 bytes in both versions; the
 * kernel parses 0x12 and 0x28 with one function.
 */
export const TAG_V1_TYPE_1_TIMING = 0x03
export const TAG_V1_TILED_DISPLAY = 0x12

export const isDisplayIdV2 = (version: number) => version >= 0x20

/** DisplayID's aspect ratio enum, bits 6-4 of the flags byte. */
export const DISPLAYID_ASPECTS = ['1:1', '5:4', '4:3', '15:9', '16:9', '16:10', '64:27', '256:135'] as const

/** Type I keeps the aspect in bits 3-0 and has a ninth code, 8 = undefined —
 *  which is what the Mac-bonding reference tiles carry. */
export const DISPLAYID_V1_ASPECTS = [...DISPLAYID_ASPECTS, 'undefined'] as const

const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]

/**
 * Type I (DisplayID 1.3) and Type VII (2.0) share the 20-byte layout above and
 * differ in two places only: the clock unit (10 kHz vs 1 kHz) and where the
 * flags byte keeps the aspect code (bits 3-0 vs bits 6-4).
 */
type DescriptorKind = 'type1' | 'type7'

function encodeDetailedTiming(t: DisplayIdTiming, kind: DescriptorKind): number[] {
  const m = t.timing
  const unit = kind === 'type1' ? 10_000 : 1000
  const clockUnits = Math.round(m.pixelClockHz / unit)
  if (clockUnits < 1 || clockUnits > 0x1000000) {
    throw new Error(`DisplayID pixel clock ${m.pixelClockHz / 1000} kHz is out of range`)
  }
  const c = clockUnits - 1

  const hBlank = m.hFront + m.hSync + m.hBack
  const vBlank = m.vFront + m.vSync + m.vBack
  const aspects: readonly string[] = kind === 'type1' ? DISPLAYID_V1_ASPECTS : DISPLAYID_ASPECTS
  const aspectIdx = Math.max(0, aspects.indexOf(t.aspect))
  const aspectBits = kind === 'type1' ? aspectIdx & 0x0f : aspectIdx << 4

  return [
    c & 0xff,
    (c >> 8) & 0xff,
    (c >> 16) & 0xff,
    (t.preferred ? 0x80 : 0) | aspectBits,
    ...le16(m.hActive - 1),
    ...le16(hBlank - 1),
    ...le16((m.hFront - 1) | (m.hSyncPositive ? 0x8000 : 0)),
    ...le16(m.hSync - 1),
    ...le16(m.vActive - 1),
    ...le16(vBlank - 1),
    ...le16((m.vFront - 1) | (m.vSyncPositive ? 0x8000 : 0)),
    ...le16(m.vSync - 1),
  ]
}

export const encodeType7Timing = (t: DisplayIdTiming) => encodeDetailedTiming(t, 'type7')
export const encodeType1Timing = (t: DisplayIdTiming) => encodeDetailedTiming(t, 'type1')

function decodeDetailedTiming(b: number[], kind: DescriptorKind): DisplayIdTiming {
  const clockHz = ((b[0] | (b[1] << 8) | (b[2] << 16)) + 1) * (kind === 'type1' ? 10_000 : 1000)
  const rd = (i: number) => b[i] | (b[i + 1] << 8)

  const hActive = rd(4) + 1
  const hBlank = rd(6) + 1
  const hFront = (rd(8) & 0x7fff) + 1
  const hSync = rd(10) + 1
  const vActive = rd(12) + 1
  const vBlank = rd(14) + 1
  const vFront = (rd(16) & 0x7fff) + 1
  const vSync = rd(18) + 1

  return {
    preferred: !!(b[3] & 0x80),
    aspect:
      kind === 'type1'
        ? (DISPLAYID_V1_ASPECTS[b[3] & 0x0f] ?? 'undefined')
        : DISPLAYID_ASPECTS[(b[3] >> 4) & 0x07],
    fractional: false,
    timing: {
      hActive,
      hFront,
      hSync,
      hBack: hBlank - hFront - hSync,
      vActive,
      vFront,
      vSync,
      vBack: vBlank - vFront - vSync,
      pixelClockHz: clockHz,
      interlaced: false,
      hSyncPositive: !!(rd(8) & 0x8000),
      vSyncPositive: !!(rd(16) & 0x8000),
    },
  }
}

export const decodeType7Timing = (b: number[]) => decodeDetailedTiming(b, 'type7')
export const decodeType1Timing = (b: number[]) => decodeDetailedTiming(b, 'type1')

/**
 * Tiled Display Topology payload, 22 bytes. Layout from drm_parse_tiled_block
 * (drm_edid.c) and struct displayid_tiled_block, read 2026-09-23:
 *
 *   0      capabilities; bit 7 = single physical enclosure
 *   1      bits 7-4 hTiles-1 (low 4), bits 3-0 vTiles-1 (low 4)
 *   2      bits 7-4 hLocation (low 4), bits 3-0 vLocation (low 4)
 *   3      the high bits: 7-6 hTiles-1, 5-4 vTiles-1, 3-2 hLocation, 1-0 vLocation
 *   4-5    tileWidth-1, LE     6-7   tileHeight-1, LE
 *   8-12   bezel               13-21 topology id
 *
 * Counts and sizes minus one, locations not — the same trap as Type VII.
 */
export function encodeTiledTopology(t: TiledTopology): number[] {
  const h = t.hTiles - 1
  const v = t.vTiles - 1
  for (const [what, n] of [['horizontal tiles', t.hTiles], ['vertical tiles', t.vTiles]] as const) {
    if (!(n >= 1 && n <= 64)) throw new Error(`tiled topology: ${what} must be 1-64, got ${n}`)
  }
  if (!(t.hLocation >= 0 && t.hLocation < t.hTiles && t.vLocation >= 0 && t.vLocation < t.vTiles)) {
    throw new Error(`tiled topology: location (${t.hLocation},${t.vLocation}) is outside a ${t.hTiles}x${t.vTiles} grid`)
  }
  if (!(t.tileWidth >= 1 && t.tileWidth <= 65536 && t.tileHeight >= 1 && t.tileHeight <= 65536)) {
    throw new Error(`tiled topology: tile ${t.tileWidth}x${t.tileHeight} is out of range`)
  }
  if (t.bezel.length !== 5 || t.topologyId.length !== 9) {
    throw new Error('tiled topology: bezel is 5 bytes and the topology id 9')
  }
  return [
    t.capabilities & 0xff,
    ((h & 0x0f) << 4) | (v & 0x0f),
    ((t.hLocation & 0x0f) << 4) | (t.vLocation & 0x0f),
    (((h >> 4) & 0x03) << 6) | (((v >> 4) & 0x03) << 4) | (((t.hLocation >> 4) & 0x03) << 2) | ((t.vLocation >> 4) & 0x03),
    ...le16(t.tileWidth - 1),
    ...le16(t.tileHeight - 1),
    ...t.bezel,
    ...t.topologyId,
  ]
}

export function decodeTiledTopology(p: number[]): TiledTopology | null {
  if (p.length < 22) return null
  const hi = p[3]
  return {
    capabilities: p[0],
    hTiles: ((p[1] >> 4) | (((hi >> 6) & 0x03) << 4)) + 1,
    vTiles: ((p[1] & 0x0f) | (((hi >> 4) & 0x03) << 4)) + 1,
    hLocation: (p[2] >> 4) | (((hi >> 2) & 0x03) << 4),
    vLocation: (p[2] & 0x0f) | ((hi & 0x03) << 4),
    tileWidth: (p[4] | (p[5] << 8)) + 1,
    tileHeight: (p[6] | (p[7] << 8)) + 1,
    bezel: p.slice(8, 13),
    topologyId: p.slice(13, 22),
  }
}

export function encodeDisplayId(ext: DisplayIdExtension): number[] {
  const blocks: number[] = []
  const v2 = isDisplayIdV2(ext.version)

  if (ext.type1Timings?.length) {
    const payload = ext.type1Timings.flatMap(encodeType1Timing)
    if (payload.length > 255) {
      throw new Error(`${ext.type1Timings.length} DisplayID timings exceed one data block; split them across extensions`)
    }
    blocks.push(TAG_V1_TYPE_1_TIMING, 0x01, payload.length, ...payload)
  }

  if (ext.tiled && !v2) {
    const payload = encodeTiledTopology(ext.tiled)
    blocks.push(TAG_V1_TILED_DISPLAY, 0x00, payload.length, ...payload)
  }

  if (ext.type7Timings.length) {
    const payload = ext.type7Timings.flatMap(encodeType7Timing)
    if (payload.length > 255) {
      throw new Error(`${ext.type7Timings.length} DisplayID timings exceed one data block; split them across extensions`)
    }
    // Revision 1 with the payload-descriptor-size field left at zero (20 bytes).
    blocks.push(TAG_TYPE_7_TIMING, 0x01, payload.length, ...payload)
  }

  if (ext.interfaceFeatures) {
    const f = ext.interfaceFeatures
    const bpcMask = (set: number[]) =>
      (set.includes(6) ? 0x01 : 0) |
      (set.includes(8) ? 0x02 : 0) |
      (set.includes(10) ? 0x04 : 0) |
      (set.includes(12) ? 0x08 : 0) |
      (set.includes(14) ? 0x10 : 0) |
      (set.includes(16) ? 0x20 : 0)
    const payload = [
      Math.round(f.minPixelRateAudioMHz),
      bpcMask(f.bpc), // RGB
      bpcMask(f.bpc), // YCbCr 4:4:4
      bpcMask(f.bpc), // YCbCr 4:2:2
      bpcMask(f.bpc), // YCbCr 4:2:0
      0,
      0,
      f.dscPassthrough ? 0x01 : 0,
    ]
    blocks.push(TAG_DISPLAY_INTERFACE_FEATURES, 0x00, payload.length, ...payload)
  }

  if (ext.tiled && v2) {
    const payload = encodeTiledTopology(ext.tiled)
    blocks.push(TAG_TILED_TOPOLOGY, 0x00, payload.length, ...payload)
  }

  for (const u of ext.unknownBlocks) blocks.push(...u)

  // 121 = 128 minus the 0x70 tag, the four header bytes, the section checksum
  // and the EDID checksum.
  if (blocks.length > 121) {
    throw new Error(`DisplayID section is ${blocks.length} bytes; one extension block holds at most 121`)
  }
  // A declared length longer than the blocks is kept, zero-padded: see
  // DisplayIdExtension.sectionLength.
  const declared = Math.min(121, Math.max(blocks.length, ext.sectionLength ?? 0))
  while (blocks.length < declared) blocks.push(0)

  // The section: header, blocks, then a checksum over exactly those bytes.
  const section = [ext.version, blocks.length, ext.primaryUseCase, ext.extensionCount ?? 0, ...blocks]
  const sum = section.reduce((a, b) => a + b, 0)
  section.push((256 - (sum % 256)) % 256)

  const out = [0x70, ...section]
  while (out.length < 127) out.push(0)
  out.push(checksum(out))
  return out
}

export function decodeDisplayId(bytes: number[]): DisplayIdExtension {
  const ext: DisplayIdExtension = {
    kind: 'displayid',
    version: bytes[1],
    primaryUseCase: bytes[3],
    extensionCount: bytes[4],
    type7Timings: [],
    unknownBlocks: [],
  }
  const v2 = isDisplayIdV2(ext.version)

  const payloadBytes = bytes[2]
  let i = 5
  const end = Math.min(5 + payloadBytes, 127)

  while (i + 3 <= end) {
    const tag = bytes[i]
    const len = bytes[i + 2]
    if (tag === 0 && len === 0) break
    const payload = bytes.slice(i + 3, i + 3 + len)

    const tiled = v2 ? tag === TAG_TILED_TOPOLOGY : tag === TAG_V1_TILED_DISPLAY
    if (!v2 && tag === TAG_V1_TYPE_1_TIMING) {
      ext.type1Timings ??= []
      for (let k = 0; k + 20 <= payload.length; k += 20) {
        ext.type1Timings.push(decodeType1Timing(payload.slice(k, k + 20)))
      }
    } else if (tiled && !ext.tiled && decodeTiledTopology(payload)) {
      ext.tiled = decodeTiledTopology(payload)!
    } else if (tag === TAG_TYPE_7_TIMING) {
      for (let k = 0; k + 20 <= payload.length; k += 20) {
        ext.type7Timings.push(decodeType7Timing(payload.slice(k, k + 20)))
      }
    } else if (tag === TAG_DISPLAY_INTERFACE_FEATURES) {
      const bpc: number[] = []
      const m = payload[1] ?? 0
      ;[6, 8, 10, 12, 14, 16].forEach((d, bit) => {
        if (m & (1 << bit)) bpc.push(d)
      })
      ext.interfaceFeatures = {
        bpc,
        dscPassthrough: !!(payload[7] & 0x01),
        minPixelRateAudioMHz: payload[0] ?? 0,
      }
    } else {
      ext.unknownBlocks.push(bytes.slice(i, i + 3 + len))
    }
    i += 3 + len
  }

  // Only worth recording when it says something the blocks do not.
  if (payloadBytes > i - 5) ext.sectionLength = payloadBytes

  return ext
}
