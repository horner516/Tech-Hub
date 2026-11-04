/*
 * The Line calc view's data half: whole cabinets per port and per processor.
 *
 * The per-port PIXEL figures are calibrated and pinned in capacity.test.ts; this file
 * does not repeat them. What it pins is the rounding to whole cabinets on top, and that
 * the wrapper agrees with the model it wraps — the reason it is a wrapper at all.
 */

import { describe, it, expect } from 'vitest';
import { dataLine, wallData } from './data-line';
import { lineVerdict } from './line-verdict';
import { portCapacity, processorCapacity } from './capacity';
import { PROCESSOR_LIBRARY, RECEIVER_LIBRARY, processorById, receiverById } from '../data/processors';
import { CABINET_LIBRARY } from '../data/cabinets';
import type { ProcessorSpec } from './types';

const byId = (id: string): ProcessorSpec => {
  const p = processorById(id);
  if (!p) throw new Error(`no processor ${id}`);
  return p;
};

const at = (bitDepth: 8 | 10 | 12, frameRateHz = 60) => ({ bitDepth, frameRateHz });

/* A 500x500 200x200px tile — the commonest rental size in the library. */
const tile = { pixelsX: 200, pixelsY: 200 };

describe('cabinets on one port', () => {
  const mx40 = byId('novastar-mx40-pro');

  it('divides the port by the cabinet and rounds DOWN', () => {
    const r = dataLine(tile, mx40, at(8));
    /* 659,722 / 40,000 = 16.49 -> 16 cabinets, not 17. */
    expect(r.portCapacityPx).toBe(portCapacity(mx40.ports[0], at(8)).capacityPx);
    expect(r.panelsPerPort).toBe(16);
    expect(r.portLimitedBy).toBe('port-bandwidth');
  });

  it('reports the device cap when the box runs out before its ports do', () => {
    const r = dataLine(tile, mx40, at(8));
    /* 20 ports x 16 = 320 cabinets = 12.8 Mpx, over the MX40 Pro's 9 Mpx box. */
    expect(r.processorLimitedBy).toBe('device-cap');
    expect(r.panelsPerProcessor).toBe(225);
    expect(r.deviceCapacityPx).toBe(processorCapacity(mx40, at(8)));
    expect(r.portsFilled).toBe(15);
    expect(r.panelsPerProcessor).toBeLessThan(r.panelsPerPort * r.portCount);
  });

  it('carries fewer cabinets at 12-bit than at 8-bit', () => {
    expect(dataLine(tile, mx40, at(12)).panelsPerPort).toBe(8);
  });

  it('halves the cabinets when the frame rate doubles', () => {
    const at60 = dataLine(tile, mx40, at(8, 60));
    const at120 = dataLine(tile, mx40, at(8, 120));
    expect(at120.panelsPerPort).toBe(Math.floor(at60.panelsPerPort / 2));
  });

  it('applies a fixed canvas ceiling as the device limit (MCTRL4K at 8-bit)', () => {
    const mctrl = byId('novastar-mctrl4k');
    const r = dataLine(tile, mctrl, at(8));
    expect(mctrl.maxCanvasPx).toBeDefined();
    expect(r.deviceCapacityPx).toBeLessThanOrEqual(mctrl.maxCanvasPx!);
    expect(r.panelsPerProcessor).toBe(Math.min(r.panelsPerPort * r.portCount, Math.floor(r.deviceCapacityPx / 40_000)));
  });

  it('never claims a fractional cabinet, or more than the box or its ports carry', () => {
    for (const proc of PROCESSOR_LIBRARY) {
      for (const depth of [8, 10, 12] as const) {
        const r = dataLine(tile, proc, at(depth));
        expect(Number.isInteger(r.panelsPerPort)).toBe(true);
        expect(r.usedPx).toBeLessThanOrEqual(r.portCapacityPx);
        expect(r.panelsPerProcessor * r.panelPixels).toBeLessThanOrEqual(processorCapacity(proc, at(depth)));
        expect(r.panelsPerProcessor).toBeLessThanOrEqual(r.panelsPerPort * r.portCount);
      }
    }
  });

  it('stops at the receiving card when the cabinet is bigger than the card can drive', () => {
    const a4s = receiverById('novastar-a4s')!;
    const r = dataLine({ pixelsX: 300, pixelsY: 300 }, byId('novastar-mx40-pro'), at(8), a4s);
    expect(r.panelsPerPort).toBe(0);
    expect(r.panelsPerProcessor).toBe(0);
    expect(r.portLimitedBy).toBe('receiving-card');
    expect(r.cardLimit?.model).toBe(a4s.model);
  });
});

describe('the library, through the line calculator', () => {
  it('has identical ports on every processor, so one port can stand for the box', () => {
    for (const proc of PROCESSOR_LIBRARY) {
      const first = proc.ports[0];
      for (const p of proc.ports) {
        expect(
          [p.linkSpeedGbps, p.medium, p.packing, p.efficiency, JSON.stringify(p.efficiencyByDepth)],
          `${proc.id} ${p.id}`,
        ).toEqual([first.linkSpeedGbps, first.medium, first.packing, first.efficiency, JSON.stringify(first.efficiencyByDepth)]);
      }
    }
  });

  it('fits every cabinet on at least one port of at least one processor at 8-bit/60', () => {
    for (const cab of CABINET_LIBRARY) {
      const card = cab.receivingCardId ? RECEIVER_LIBRARY.find((r) => r.id === cab.receivingCardId) : undefined;
      const best = Math.max(...PROCESSOR_LIBRARY.map((p) => dataLine(cab, p, at(8), card).panelsPerPort));
      expect(best, `${cab.id} does not fit any port`).toBeGreaterThan(0);
    }
  });
});

describe('a whole wall', () => {
  const mx40 = byId('novastar-mx40-pro');

  it('rounds ports and processors up, and says when pixels rather than ports set the box count', () => {
    const r = dataLine(tile, mx40, at(8));
    const w = wallData({ ...tile, weightKg: 7.5 }, 300, r);
    expect(w.ports).toBe(Math.ceil(300 / 16));
    expect(w.processors).toBe(2);
    /* 19 ports fit on one 20-port box; the 9 Mpx ceiling is what makes it two. */
    expect(w.processorsByPorts).toBe(1);
    expect(w.deviceBound).toBe(true);
    expect(w.totalPx).toBe(300 * 40_000);
    expect(w.weightKg).toBeCloseTo(2250, 6);
  });

  it('does not blame the device when the ports run out first', () => {
    const r = dataLine(tile, mx40, at(8));
    expect(wallData({ ...tile, weightKg: 7.5 }, 100, r).deviceBound).toBe(false);
  });
});

describe('which line binds', () => {
  const cab = { widthMm: 500, heightMm: 1000 };

  it('is the smaller of the two, with the other one\'s spare counted', () => {
    expect(lineVerdict(cab, 16, 14)).toMatchObject({ run: 14, binds: 'power', spare: 2, rowMm: 7000, columnMm: 14000 });
    expect(lineVerdict(cab, 12, 20)).toMatchObject({ run: 12, binds: 'data', spare: 8 });
    expect(lineVerdict(cab, 9, 9)).toMatchObject({ run: 9, binds: 'both', spare: 0 });
  });

  it('says nothing fits rather than offering a run of zero', () => {
    expect(lineVerdict(cab, 0, 14).binds).toBe('none');
    expect(lineVerdict(cab, 16, 0).binds).toBe('none');
  });
});
