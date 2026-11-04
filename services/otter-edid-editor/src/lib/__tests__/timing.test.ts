import { describe, expect, it } from 'vitest'
import { cvt, cvtRb, cvtRb2 } from '../timing/cvt.ts'
import { gtf } from '../timing/gtf.ts'
import { DMT_TIMINGS, dmtByCode } from '../timing/dmt.ts'
import { CTA_TIMINGS, ctaByVic } from '../timing/cta.ts'
import { hTotal, vFreq, vTotal } from '../timing/types.ts'

/**
 * The CVT tests check our generator against PUBLISHED DMT entries, which were
 * transcribed independently in dmt.ts. If both were derived from this code the
 * test would prove nothing.
 */
describe('CVT standard blanking', () => {
  it('reproduces DMT 0x45 — 1920x1200 @60', () => {
    const t = cvt(1920, 1200, { refreshHz: 60 })
    const ref = dmtByCode(0x45)!
    expect(t.pixelClockHz).toBe(ref.pixelClockHz)
    expect(hTotal(t)).toBe(hTotal(ref))
    expect(vTotal(t)).toBe(vTotal(ref))
  })

  it('reproduces DMT 0x3A — 1680x1050 @60', () => {
    const t = cvt(1680, 1050, { refreshHz: 60 })
    const ref = dmtByCode(0x3a)!
    expect(t.pixelClockHz).toBe(ref.pixelClockHz)
    expect(hTotal(t)).toBe(2240)
    expect(vTotal(t)).toBe(1089)
  })

  it('reproduces DMT 0x2F — 1440x900 @60', () => {
    const t = cvt(1440, 900, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(106_500_000)
    expect(hTotal(t)).toBe(1904)
    expect(vTotal(t)).toBe(934)
  })

  it('uses negative hsync and positive vsync', () => {
    const t = cvt(1920, 1200, { refreshHz: 60 })
    expect(t.hSyncPositive).toBe(false)
    expect(t.vSyncPositive).toBe(true)
  })
})

describe('CVT reduced blanking v1', () => {
  it('reproduces DMT 0x44 — 1920x1200 @60 RB', () => {
    const t = cvtRb(1920, 1200, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(154_000_000)
    expect(hTotal(t)).toBe(2080)
    expect(vTotal(t)).toBe(1235)
  })

  it('reproduces DMT 0x49 — 2560x1600 @60 RB', () => {
    const t = cvtRb(2560, 1600, { refreshHz: 60 })
    expect(t.pixelClockHz).toBe(268_500_000)
    expect(hTotal(t)).toBe(2720)
    expect(vTotal(t)).toBe(1646)
  })

  it('always spends exactly 160 pixels on horizontal blanking', () => {
    for (const w of [1280, 1920, 2560, 3840]) {
      const t = cvtRb(w, 1080, { refreshHz: 60 })
      expect(t.hFront + t.hSync + t.hBack).toBe(160)
    }
  })

  it('inverts both polarities relative to standard CVT — this is how a sink tells them apart', () => {
    const t = cvtRb(1920, 1200, { refreshHz: 60 })
    expect(t.hSyncPositive).toBe(true)
    expect(t.vSyncPositive).toBe(false)
  })
})

describe('CVT reduced blanking v2', () => {
  it('spends 80 pixels on horizontal blanking and 8 lines on vsync', () => {
    const t = cvtRb2(3840, 2160, { refreshHz: 60 })
    expect(t.hFront + t.hSync + t.hBack).toBe(80)
    expect(t.vSync).toBe(8)
  })

  it('lands on the requested rate to better than 0.01 Hz', () => {
    // The point of RBv2's 1 kHz clock step: RBv1 cannot do this.
    for (const rate of [60, 50, 23.976, 29.97, 119.88]) {
      const t = cvtRb2(3840, 2160, { refreshHz: rate })
      expect(Math.abs(vFreq(t) - rate)).toBeLessThan(0.01)
    }
  })

  it('is cheaper than RBv1, which is cheaper than standard CVT', () => {
    const std = cvt(2560, 1440, { refreshHz: 60 }).pixelClockHz
    const rb1 = cvtRb(2560, 1440, { refreshHz: 60 }).pixelClockHz
    const rb2 = cvtRb2(2560, 1440, { refreshHz: 60 }).pixelClockHz
    expect(rb2).toBeLessThan(rb1)
    expect(rb1).toBeLessThan(std)
  })
})

describe('GTF', () => {
  it('produces the classic 1024x768 @60 GTF timing', () => {
    const t = gtf(1024, 768, { refreshHz: 60 })
    expect(hTotal(t)).toBe(1344)
    expect(vTotal(t)).toBe(795)
    expect(t.pixelClockHz / 1e6).toBeCloseTo(64.11, 1)
  })

  it('rounds horizontal blanking to a double cell so the back porch stays cell-aligned', () => {
    const t = gtf(1280, 1024, { refreshHz: 60 })
    const blank = t.hFront + t.hSync + t.hBack
    expect(blank % 16).toBe(0)
    expect(t.hBack % 8).toBe(0)
  })
})

describe('reference tables', () => {
  it('every DMT entry states a self-consistent refresh rate', () => {
    for (const t of DMT_TIMINGS) {
      const rate = vFreq(t)
      // Each entry's name carries its nominal rate; they must agree.
      const nominal = Number(/@(\d+)/.exec(t.name)![1])
      expect(Math.abs(rate - nominal)).toBeLessThan(0.6)
    }
  })

  it('every CTA entry states a self-consistent refresh rate', () => {
    for (const t of CTA_TIMINGS) {
      const rate = vFreq(t)
      expect(rate).toBeGreaterThan(20)
      expect(rate).toBeLessThan(130)
    }
  })

  it('VIC 16 is 1080p60 at 148.5 MHz on a 2200x1125 raster', () => {
    const t = ctaByVic(16)!
    expect(t.pixelClockHz).toBe(148_500_000)
    expect(hTotal(t)).toBe(2200)
    expect(vTotal(t)).toBe(1125)
  })

  it('VIC 97 is 2160p60 at 594 MHz, and VIC 118 is 2160p120 at 1188 MHz', () => {
    expect(ctaByVic(97)!.pixelClockHz).toBe(594_000_000)
    expect(ctaByVic(118)!.pixelClockHz).toBe(1_188_000_000)
  })

  it('interlaced VICs state the FIELD rate, not the frame rate', () => {
    const t = ctaByVic(5)! // 1080i60
    expect(t.interlaced).toBe(true)
    expect(Math.round(vFreq(t))).toBe(60)
  })
})
