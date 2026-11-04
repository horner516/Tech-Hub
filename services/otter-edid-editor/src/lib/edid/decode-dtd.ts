import type { DetailedTimingDescriptor } from './types.ts'

const SYNC_TYPES = ['analog-composite', 'bipolar-analog', 'digital-composite', 'digital-separate'] as const
const STEREO = ['none', 'field-right', 'field-left', 'interleaved-right', 'interleaved-left', 'interleaved-4way', 'side-by-side'] as const

/**
 * Unpack an 18-byte detailed timing descriptor.
 *
 * Returns null when bytes 0-1 are zero, which marks a DISPLAY descriptor
 * (name, range limits, ...) rather than a timing. That sentinel is why a DTD
 * can never have a zero pixel clock, and why the caller has to dispatch on it
 * before doing anything else.
 *
 * Lives apart from decode.ts so cta861.ts can use it without importing the
 * whole base-block decoder, which imports cta861 in turn.
 */
export function decodeDtd(b: number[]): DetailedTimingDescriptor | null {
  const clock10k = b[0] | (b[1] << 8)
  if (clock10k === 0) return null

  const hActive = b[2] | ((b[4] >> 4) << 8)
  const hBlank = b[3] | ((b[4] & 0x0f) << 8)
  const vActive = b[5] | ((b[7] >> 4) << 8)
  const vBlank = b[6] | ((b[7] & 0x0f) << 8)

  const hFront = b[8] | (((b[11] >> 6) & 0x03) << 8)
  const hSync = b[9] | (((b[11] >> 4) & 0x03) << 8)
  const vFront = ((b[10] >> 4) & 0x0f) | (((b[11] >> 2) & 0x03) << 4)
  const vSync = (b[10] & 0x0f) | ((b[11] & 0x03) << 4)

  const flags = b[17]
  const syncType = SYNC_TYPES[(flags >> 3) & 0x03]
  const stereoIdx = (((flags >> 5) & 0x03) << 1) | (flags & 0x01)

  return {
    kind: 'dtd',
    timing: {
      hActive,
      hFront,
      hSync,
      hBack: hBlank - hFront - hSync,
      vActive,
      vFront,
      vSync,
      vBack: vBlank - vFront - vSync,
      pixelClockHz: clock10k * 10000,
      interlaced: !!(flags & 0x80),
      // Polarity bits are only meaningful for digital separate sync; for the
      // analog sync types those bits mean serration and sync-on-green instead.
      hSyncPositive: syncType === 'digital-separate' ? !!(flags & 0x02) : false,
      vSyncPositive: syncType === 'digital-separate' ? !!(flags & 0x04) : false,
    },
    hSizeMm: b[12] | ((b[14] >> 4) << 8),
    vSizeMm: b[13] | ((b[14] & 0x0f) << 8),
    hBorder: b[15],
    vBorder: b[16],
    syncType,
    stereo: stereoIdx === 0 ? 'none' : (STEREO[stereoIdx - 1] ?? 'none'),
  }
}
