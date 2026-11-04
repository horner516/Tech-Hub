/**
 * These tests pin the capacity model to figures the manufacturers publish.
 *
 * If one of these fails, the model has drifted away from what a NovaStar or Brompton
 * engineer would tell you — which makes every number the app prints untrustworthy.
 * Fix the model, do not relax the test.
 */

import { describe, expect, it } from 'vitest';
import { portCapacity, processorCapacity, wireBitsPerPixel } from './capacity';
import { processorById, receiverById } from '../data/processors';
import type { PortSpec, SignalFormat } from './types';

const at60 = (bitDepth: 8 | 10 | 12): SignalFormat => ({
  bitDepth,
  frameRateHz: 60,
  ledRefreshHz: 3840,
});

const novaGig: PortSpec = {
  id: 'eth1',
  label: 'ETH 1',
  linkSpeedGbps: 1,
  medium: 'RJ45',
  efficiency: 0.95,
  packing: 'container',
};

describe('pixel container packing', () => {
  // Vendors word-align each component; 10-bit costs the same wire space as 16-bit.
  it('packs to power-of-two containers, not 3 x bitDepth', () => {
    expect(wireBitsPerPixel(8)).toBe(24);
    expect(wireBitsPerPixel(10)).toBe(32);
    expect(wireBitsPerPixel(12)).toBe(48);
  });

  it('can still do naive packing when asked', () => {
    expect(wireBitsPerPixel(10, 'naive')).toBe(30);
  });
});

describe('NovaStar MX40 Pro published port capacity', () => {
  // Source: MX40 Pro LED Display Controller Specifications V1.4.1, oss.novastar.tech.
  // "8bit@60Hz: 659,722 pixels / 10bit@60Hz: 494,791 pixels / 10bit/12bit@60Hz: 329,861 pixels"
  it.each([
    [8, 659_722],
    [10, 494_791],
    [12, 329_861],
  ] as const)('matches the published figure at %i-bit', (depth, published) => {
    expect(portCapacity(novaGig, at60(depth)).capacityPx).toBe(published);
  });

  it('reproduces the published ratios 1.00 / 0.75 / 0.50', () => {
    const base = portCapacity(novaGig, at60(8)).capacityPx;
    expect(portCapacity(novaGig, at60(10)).capacityPx / base).toBeCloseTo(0.75, 4);
    expect(portCapacity(novaGig, at60(12)).capacityPx / base).toBeCloseTo(0.5, 4);
  });

  it('caps at the 9 Mpx device limit, not the 13.2 Mpx the ports could carry', () => {
    const mx40 = processorById('novastar-mx40-pro')!;
    const portSum = mx40.ports.reduce(
      (n, p) => n + portCapacity(p, at60(8)).capacityPx,
      0,
    );
    expect(portSum).toBeGreaterThan(13_000_000);
    expect(processorCapacity(mx40, at60(8))).toBe(9_000_000);
  });
});

describe('NovaStar COEX published device capacity', () => {
  // Sources: MX30 Specifications V1.4.0 and MX20 Specifications V1.4.1, oss.novastar.tech.
  // Both quote the same per-port figures as the MX40 Pro, so the whole COEX gigabit
  // family is pinned by one calibration.
  it.each([
    ['novastar-mx30', 10, 6_500_000],
    ['novastar-mx20', 6, 3_900_000],
  ] as const)('%s caps at its published headline', (id, ports, headline) => {
    const spec = processorById(id)!;
    expect(spec.ports).toHaveLength(ports);
    expect(processorCapacity(spec, at60(8))).toBe(headline);
  });

  it('shows the COEX headline is the port sum rounded down, not a backplane cap', () => {
    // Unlike the MX40 Pro, where 9 Mpx is well under what the ports could carry.
    const mx30 = processorById('novastar-mx30')!;
    const portSum = mx30.ports.reduce((n, p) => n + portCapacity(p, at60(8)).capacityPx, 0);
    expect(portSum).toBe(6_597_220);
    expect(portSum - 6_500_000).toBeLessThan(100_000);
  });

  it('gives the MX_4x10G_Fiber trunk the load of ten gigabit ports, as published', () => {
    const trunk = processorById('novastar-mx2000-pro')!.ports[0];
    expect(trunk.subLinks).toBe(10);
    // "A single optical port has the same load capacity of 10x 1G Ethernet ports."
    const perSubLink = portCapacity(trunk, at60(8)).capacityPx / 10;
    expect(perSubLink).toBeCloseTo(659_722, -1);
  });

  it.each([
    ['novastar-mx2000-pro', 8, 35_380_000],
    ['novastar-mx6000-pro', 32, 141_000_000],
  ] as const)('%s is capped by the chassis, not the trunks', (id, trunks, cap) => {
    const spec = processorById(id)!;
    expect(spec.ports).toHaveLength(trunks);
    const portSum = spec.ports.reduce((n, p) => n + portCapacity(p, at60(8)).capacityPx, 0);
    expect(portSum).toBeGreaterThan(cap);
    expect(processorCapacity(spec, at60(8))).toBe(cap);
  });
});

describe('NovaStar 5G solution (CX40 Pro; CX_1x40G_Fiber / MX_8x5G_Base-T output cards)', () => {
  // Source: CX40 Pro, MX2000 Pro and MX6000 Pro Specifications V1.5.1 (2026-04-30),
  // "Ethernet Port Load Capacity" for the 5G solution. Containers again, at 0.85 — and
  // 0.88 at 10-bit, the one per-depth constant any vendor prints. The table, not the
  // prose, is what is pinned: see nova5GPort in the processor library for the rounding.
  const port = processorById('novastar-cx40-pro')!.ports[0];
  const trunk = processorById('novastar-mx6000-pro-5g')!.ports[0];

  it.each([
    [8, 2_951_200],
    [10, 2_291_312],
    [12, 1_475_600],
  ] as const)('matches the published per-5G-port figure at %i-bit, 60 Hz', (depth, published) => {
    expect(portCapacity(port, at60(depth)).capacityPx).toBe(published);
  });

  it('reproduces the 24 Hz and 240 Hz rows of all three columns', () => {
    expect(perPort(24, 8)).toBe(7_378_000);
    expect(perPort(24, 10)).toBe(5_728_280);
    expect(perPort(24, 12)).toBe(3_689_000);
    expect(perPort(240, 8)).toBe(737_800);
    expect(perPort(240, 10)).toBe(572_828);
    expect(perPort(240, 12)).toBe(368_900);
  });

  it('runs the 10-bit column on its own constant, as the formula says', () => {
    // 8-bit and 12-bit share 4,249,728,000 bps of payload; 10-bit gets 4,399,319,040.
    expect(portCapacity(port, at60(8)).payloadBps).toBeCloseTo(4_249_728_000, 0);
    expect(portCapacity(port, at60(12)).payloadBps).toBeCloseTo(4_249_728_000, 0);
    expect(portCapacity(port, at60(10)).payloadBps).toBeCloseTo(4_399_319_040, 0);
  });

  it('gives the 40G trunk the load of eight 5G ports, and the published card figure at 12-bit', () => {
    expect(trunk.subLinks).toBe(8);
    expect(portCapacity(trunk, at60(8)).capacityPx).toBe(8 * 2_951_200);
    // "Maximum load of a single output card: 12bit@60Hz: 11,804,800 pixels"
    expect(portCapacity(trunk, at60(12)).capacityPx).toBe(11_804_800);
  });

  it('caps the CX40 Pro at 9 Mpx, the same box limit as the MX40 Pro', () => {
    const cx40 = processorById('novastar-cx40-pro')!;
    expect(cx40.ports).toHaveLength(6);
    expect(processorCapacity(cx40, at60(8))).toBe(9_000_000);
    // The cap is a bandwidth figure quoted at 8-bit, so at 12-bit it derates to 4.5 Mpx —
    // the same convention as the MX40 Pro — under the 8.85 Mpx the six ports carry.
    expect(processorCapacity(cx40, at60(12))).toBe(4_500_000);
  });

  it('caps the KU20 at the 3.9 Mpx headline, like the MX20', () => {
    const ku20 = processorById('novastar-ku20')!;
    expect(ku20.ports).toHaveLength(6);
    expect(processorCapacity(ku20, at60(8))).toBe(3_900_000);
  });

  function perPort(fps: number, bitDepth: 8 | 10 | 12) {
    return portCapacity(port, { bitDepth, frameRateHz: fps, ledRefreshHz: 3840 }).capacityPx;
  }
});

describe('NovaStar MCTRL generation (pre-COEX)', () => {
  // Source: MCTRL660 PRO Independent Controller Specifications V1.4.1 — 650,000 px at
  // 8-bit and 325,000 at 10/12-bit, per gigabit port at 60 Hz. Exactly 2:1, which is
  // 24 vs 48 bits and rules out the 32-bit 10-bit container the COEX boxes have.
  const port = processorById('novastar-mctrl660-pro')!.ports[0];

  it.each([
    [8, 650_000],
    [10, 325_000],
    [12, 325_000],
  ] as const)('matches the published MCTRL660 PRO figure at %i-bit', (depth, published) => {
    expect(portCapacity(port, at60(depth)).capacityPx).toBe(published);
  });

  it('costs 48 bits at 10-bit, where a COEX port costs 32', () => {
    expect(wireBitsPerPixel(10, 'container-legacy')).toBe(48);
    expect(wireBitsPerPixel(8, 'container-legacy')).toBe(24);
    expect(wireBitsPerPixel(10, 'container')).toBe(32);
  });

  it('holds the MCTRL4K canvas ceiling flat while the ports derate', () => {
    // 8.8 Mpx is 4096x2160, a pipeline limit, so it must NOT scale with bit depth.
    // At 8-bit it binds under the 10.4 Mpx the 16 ports carry; at 12-bit the ports bind.
    const mctrl4k = processorById('novastar-mctrl4k')!;
    expect(mctrl4k.maxCanvasPx).toBe(8_800_000);
    expect(processorCapacity(mctrl4k, at60(8))).toBe(8_800_000);
    expect(processorCapacity(mctrl4k, at60(12))).toBe(16 * 325_000);
  });

  it('caps the MCTRL660 at its 1920x1200 canvas, below what its four ports carry', () => {
    const mctrl660 = processorById('novastar-mctrl660')!;
    const portSum = mctrl660.ports.reduce(
      (n, p) => n + portCapacity(p, at60(8)).capacityPx,
      0,
    );
    expect(portSum).toBe(2_600_000);
    expect(processorCapacity(mctrl660, at60(8))).toBe(1920 * 1200);
  });
});

describe('Brompton Tessera published capacity', () => {
  // Source: Brompton "Tessera Processor Output Port Capacity" (dl.bromptontech.com,
  // processor version 3.5.2) — the per-port table and the per-SX40 table — plus the
  // S8 data sheet (Mar 2025), which states the 8-bit port figure independently.
  const sx40 = processorById('brompton-sx40')!;
  const s8 = processorById('brompton-s8')!;
  const sq200 = processorById('brompton-sq200')!;

  it.each([
    [8, 525_000],
    [10, 420_000],
    [12, 350_000],
  ] as const)('matches the published 1G port figure at %i-bit, 60 Hz', (depth, published) => {
    expect(portCapacity(s8.ports[0], at60(depth)).capacityPx).toBe(published);
  });

  it('reproduces the 24 Hz and 120 Hz rows too', () => {
    const at = (fps: number, bitDepth: 8 | 10 | 12) =>
      portCapacity(s8.ports[0], { bitDepth, frameRateHz: fps, ledRefreshHz: 3840 }).capacityPx;
    expect(at(24, 8)).toBe(1_312_500);
    expect(at(24, 12)).toBe(875_000);
    expect(at(120, 8)).toBe(262_500);
    expect(at(120, 10)).toBe(210_000);
  });

  it('packs naively — 24 : 30 : 36 — which is what the table’s ratios are', () => {
    const p = s8.ports[0];
    expect(portCapacity(p, at60(8)).bitsPerPixel).toBe(24);
    expect(portCapacity(p, at60(10)).bitsPerPixel).toBe(30);
    expect(portCapacity(p, at60(12)).bitsPerPixel).toBe(36);
  });

  it('gives a 10G trunk ten 1G links’ worth, as the SX40 data sheet says', () => {
    const trunk = sx40.ports[0];
    expect(trunk.subLinks).toBe(10);
    expect(portCapacity(trunk, at60(12)).capacityPx / 10).toBe(350_000);
  });

  it('holds the SX40 at 9 Mpx at every bit depth up to 60 Hz — the published table', () => {
    expect(processorCapacity(sx40, at60(8))).toBe(9_000_000);
    expect(processorCapacity(sx40, at60(10))).toBe(9_000_000);
    expect(processorCapacity(sx40, at60(12))).toBe(9_000_000);
    expect(processorCapacity(sx40, { bitDepth: 8, frameRateHz: 50, ledRefreshHz: 3840 })).toBe(9_000_000);
  });

  it('derates the SX40 with frame rate above 60 Hz, as published', () => {
    const at = (fps: number) =>
      processorCapacity(sx40, { bitDepth: 8, frameRateHz: fps, ledRefreshHz: 3840 });
    expect(at(72)).toBe(7_500_000);
    expect(at(120)).toBe(4_500_000);
    expect(at(250)).toBe(2_160_000);
  });

  it('lets the S8’s eight ports bind under its 4.5 Mpx cap at 8-bit', () => {
    expect(s8.ports).toHaveLength(8);
    expect(processorCapacity(s8, at60(8))).toBe(8 * 525_000);
    expect(processorCapacity(s8, at60(12))).toBe(8 * 350_000);
  });

  it('sizes the SQ200’s twelve QD-S trunks to its 36 Mpx licence at 12-bit', () => {
    expect(sq200.ports).toHaveLength(12);
    const trunkSum = sq200.ports.reduce((n, p) => n + portCapacity(p, at60(12)).capacityPx, 0);
    expect(trunkSum).toBe(42_000_000);
    expect(processorCapacity(sq200, at60(12))).toBe(36_000_000);
    expect(processorCapacity(sq200, at60(8))).toBe(36_000_000);
  });
});

describe('receiving cards', () => {
  it.each([
    ['novastar-a10s-pro', 512 * 512],
    ['novastar-a8s-pro', 512 * 512],
    ['novastar-a8s', 512 * 384],
    ['novastar-a5s-plus', 512 * 384],
    ['novastar-a4s', 256 * 256],
    ['brompton-r2', 262_144],
  ] as const)('%s carries its published pixel limit, verified', (id, px) => {
    const card = receiverById(id)!;
    expect(card.maxPixels).toBe(px);
    expect(card.verified).toBe(true);
  });
});

describe('frame rate scaling', () => {
  it('halves capacity when frame rate doubles', () => {
    const at60px = portCapacity(novaGig, at60(8)).capacityPx;
    const at120px = portCapacity(novaGig, {
      bitDepth: 8,
      frameRateHz: 120,
      ledRefreshHz: 3840,
    }).capacityPx;
    expect(at120px).toBeCloseTo(at60px / 2, -1);
  });

  it('LED refresh rate does not change link capacity', () => {
    const slow = portCapacity(novaGig, { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 1920 });
    const fast = portCapacity(novaGig, { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 7680 });
    expect(slow.capacityPx).toBe(fast.capacityPx);
  });
});
