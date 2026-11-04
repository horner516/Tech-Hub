/**
 * The pixel map must tile exactly on a single-pitch wall, whatever the datasheet
 * rounded the pitch to.
 */

import { describe, expect, it } from 'vitest';
import { cabinetById } from '../data/cabinets';
import { buildPixelMap } from './pixelmap';
import type { Project } from './types';
import { buildGrid, truePitchMm, wallStats } from './wall';

const lookup = (id: string) => cabinetById(id);

function wallOf(specId: string, cols: number, rows: number): Project {
  const spec = cabinetById(specId)!;
  let n = 0;
  return {
    schema: 'pixel-peeker/1',
    name: 'Pitch test',
    canvas: { name: 'Main', widthMm: 10000, heightMm: 5000, snapMm: 1 },
    signal: { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 3840 },
    cabinets: buildGrid(spec, cols, rows, 0, 0, () => `cab-${n++}`),
    processors: [],
    chains: [],
    customCabinets: [],
    customProcessors: [],
    customReceivers: [],
  };
}

describe('pixel map reference pitch', () => {
  it('divides by width / pixels, not by the datasheet’s rounded pitch', () => {
    // Absen print 2.97 for a 168 px / 500 mm tile (2.976). Dividing 1000 mm by 2.97
    // gives 336.7, which rounds to 337 — one pixel out for the second cabinet across,
    // and every cabinet after it.
    const spec = cabinetById('absen-pl29-pro-v2')!;
    expect(spec.pixelPitchMm).toBe(2.97);
    expect(truePitchMm(spec)).toBeCloseTo(2.976, 3);

    const project = wallOf('absen-pl29-pro-v2', 6, 2);
    const map = buildPixelMap(project, lookup, []);
    const xs = map.cabinets.map((c) => c.rect.x).sort((a, b) => a - b);
    expect(new Set(xs)).toEqual(new Set([0, 168, 336, 504, 672, 840]));
    expect(map.width).toBe(6 * 168);
    expect(map.height).toBe(2 * 168);
    expect(map.approximate).toBe(false);
  });

  it('agrees with the wall stats bounding box', () => {
    // Gloshine print 3.91 for 128 px / 500 mm.
    const project = wallOf('gloshine-cb39-indoor-s', 20, 4);
    const map = buildPixelMap(project, lookup, []);
    const stats = wallStats(project, lookup);
    expect(map.width).toBe(20 * 128);
    expect(stats.boundingPixels).toEqual({ x: 0, y: 0, width: 20 * 128, height: 4 * 128 });
    expect(stats.referencePitchMm).toBeCloseTo(3.90625, 5);
  });

  it('tiles a 1000 mm cabinet next to a 500 mm one of the same series without a gap', () => {
    const big = cabinetById('gloshine-cb39-indoor-v')!; // 500 x 1000, 128 x 256
    const small = cabinetById('gloshine-cb39-indoor-s')!; // 500 x 500, 128 x 128
    const project = wallOf('gloshine-cb39-indoor-s', 1, 1);
    project.cabinets.push({ id: 'big', specId: big.id, xMm: 500, yMm: 0, rotation: 0 });
    project.cabinets.push({ id: 'small2', specId: small.id, xMm: 1000, yMm: 500, rotation: 0 });
    const map = buildPixelMap(project, lookup, []);
    const byId = new Map(map.cabinets.map((c) => [c.inst.id, c.rect]));
    expect(byId.get('big')).toEqual({ x: 128, y: 0, width: 128, height: 256 });
    expect(byId.get('small2')).toEqual({ x: 256, y: 128, width: 128, height: 128 });
    expect(map.approximate).toBe(false);
  });
});
