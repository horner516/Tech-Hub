/**
 * One video mode, stated the way an EDID detailed timing states it: active
 * pixels, the three blanking intervals on each axis, and an exact pixel clock.
 *
 * Everything else a person wants to see (totals, line rate, refresh, bandwidth)
 * is derived from these — never stored alongside them, so the two can't drift.
 */
export interface Timing {
  hActive: number
  hFront: number
  hSync: number
  hBack: number
  vActive: number
  vFront: number
  vSync: number
  vBack: number
  /** Exact, in Hz. EDID can only carry a multiple of 10 kHz; that rounding is
   *  applied at encode time, not here, so the modelled mode stays truthful. */
  pixelClockHz: number
  interlaced: boolean
  hSyncPositive: boolean
  vSyncPositive: boolean
}

export type TimingStandard =
  | 'dmt'
  | 'cta'
  | 'cvt'
  | 'cvt-rb'
  | 'cvt-rb2'
  | 'gtf'
  | 'manual'

export interface NamedTiming extends Timing {
  name: string
  standard: TimingStandard
  /** DMT ID (e.g. 0x45) or CTA VIC, where the mode comes from a table. */
  code?: number
  /** True where the vertical rate is the 1000/1001 variant of a whole number. */
  fractional?: boolean
}

export const hTotal = (t: Timing) => t.hActive + t.hFront + t.hSync + t.hBack
export const vTotal = (t: Timing) => t.vActive + t.vFront + t.vSync + t.vBack

/** Line rate in Hz. */
export const hFreq = (t: Timing) => t.pixelClockHz / hTotal(t)

/**
 * Refresh in Hz.
 *
 * For an interlaced mode this is the FIELD rate, which is what every EDID field,
 * every spec sheet and every operator means by "1080i60". The frame rate is half
 * of it. Getting this backwards silently halves or doubles every bandwidth
 * number downstream, so the two are never conflated.
 */
export const vFreq = (t: Timing) => hFreq(t) / vTotal(t)

/** Frames per second — half the field rate when interlaced. */
export const frameRate = (t: Timing) => (t.interlaced ? vFreq(t) / 2 : vFreq(t))

/** Total pixels shifted per second, blanking included. This, not the active
 *  pixel count, is what a link has to carry. */
export const pixelRate = (t: Timing) => t.pixelClockHz

export function timingEquals(a: Timing, b: Timing): boolean {
  return (
    a.hActive === b.hActive &&
    a.hFront === b.hFront &&
    a.hSync === b.hSync &&
    a.hBack === b.hBack &&
    a.vActive === b.vActive &&
    a.vFront === b.vFront &&
    a.vSync === b.vSync &&
    a.vBack === b.vBack &&
    a.interlaced === b.interlaced &&
    Math.abs(a.pixelClockHz - b.pixelClockHz) < 1
  )
}

/** A short human label: "1920x1080p60" / "1920x1080i59.94". */
export function timingLabel(t: Timing): string {
  const r = vFreq(t)
  const whole = Math.round(r)
  // 59.94 and friends are 1000/1001 of a whole rate; show two decimals only
  // when the mode really is fractional, not because of float noise.
  const text = Math.abs(r - whole) < 0.01 ? String(whole) : r.toFixed(2)
  return `${t.hActive}x${t.vActive}${t.interlaced ? 'i' : 'p'}${text}`
}
