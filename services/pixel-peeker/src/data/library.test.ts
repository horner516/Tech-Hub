/**
 * Sanity checks over every record in the library.
 *
 * These catch the mistakes a hand-entered datasheet figure actually makes — a pixel
 * count that does not match the pitch, a per-square-metre power figure recorded as a
 * per-panel one, a receiving card that does not exist — rather than checking any one
 * number against a vendor. The vendor checks are in domain/capacity.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { CABINET_LIBRARY, MANUFACTURERS } from './cabinets';
import { PROCESSOR_LIBRARY, RECEIVER_LIBRARY, receiverById } from './processors';
import { truePitchMm } from '../domain/wall';

describe('cabinet library', () => {
  it('has unique ids', () => {
    const ids = CABINET_LIBRARY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the manufacturers the library claims to', () => {
    expect(MANUFACTURERS).toEqual(['Absen', 'Aluvision', 'Gloshine', 'ROE Visual', 'Unilumin']);
    for (const m of MANUFACTURERS) {
      expect(CABINET_LIBRARY.filter((c) => c.manufacturer === m).length).toBeGreaterThan(1);
    }
  });

  it.each(CABINET_LIBRARY.map((c) => [c.id, c] as const))('%s is internally consistent', (_id, c) => {
    expect(c.source).toBeTruthy();
    expect(c.widthMm).toBeGreaterThan(0);
    expect(c.heightMm).toBeGreaterThan(0);
    expect(c.depthMm).toBeGreaterThan(0);
    expect(c.pixelsX).toBeGreaterThan(0);
    expect(c.pixelsY).toBeGreaterThan(0);

    // The datasheet pitch is a rounded label — "2.9" for 2.976, "1.5" for 1.5625 — but
    // it must be the label for THIS tile: width / pixels and height / pixels both within
    // 5% of it. A 500 x 1000 tile whose pixel count was typed for the 500 x 500 fails.
    const pitchX = truePitchMm(c);
    const pitchY = c.heightMm / c.pixelsY;
    expect(Math.abs(pitchX - c.pixelPitchMm) / c.pixelPitchMm).toBeLessThan(0.05);
    expect(Math.abs(pitchY - c.pixelPitchMm) / c.pixelPitchMm).toBeLessThan(0.05);

    // Power: average never above peak, and peak within the range LED tiles actually
    // draw per square metre. Both ends of the range have been hit by real data-entry
    // errors — a W/m2 figure recorded per panel, or a per-panel figure per m2.
    const areaM2 = (c.widthMm * c.heightMm) / 1e6;
    expect(c.powerAvgW).toBeLessThanOrEqual(c.powerMaxW);
    expect(c.powerMaxW / areaM2).toBeGreaterThanOrEqual(150);
    expect(c.powerMaxW / areaM2).toBeLessThanOrEqual(1000);

    // Weight: the one record that legitimately lacks it says so.
    if (c.weightKg === 0) expect(c.notes).toMatch(/WEIGHT NOT STATED/);
    else expect(c.weightKg / areaM2).toBeLessThan(80);

    if (c.receivingCardId) expect(receiverById(c.receivingCardId)).toBeDefined();
    if (c.scanRate) expect(c.scanRate).toBeGreaterThanOrEqual(1);
    if (c.greyscaleBits) expect(c.greyscaleBits).toBeGreaterThanOrEqual(12);
    if (c.maxRefreshHz) expect(c.maxRefreshHz).toBeGreaterThanOrEqual(1920);
  });

  it('flags the one record still waiting on a manufacturer sheet, and no others', () => {
    const unverified = CABINET_LIBRARY.filter((c) => !c.verified).map((c) => c.id);
    expect(unverified).toEqual(['unilumin-upad-iii-26']);
  });
});

describe('processor library', () => {
  it('has unique ids and a source on every record', () => {
    const ids = PROCESSOR_LIBRARY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROCESSOR_LIBRARY) {
      expect(p.verified).toBe(true);
      expect(p.source).toBeTruthy();
      expect(p.ports.length).toBeGreaterThan(0);
      expect(new Set(p.ports.map((x) => x.id)).size).toBe(p.ports.length);
    }
  });

  it('has every receiving card verified against its own datasheet', () => {
    for (const r of RECEIVER_LIBRARY) {
      expect(r.verified).toBe(true);
      expect(r.maxPixels).toBeGreaterThan(0);
    }
  });
});
