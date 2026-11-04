/**
 * Snapping, drag constraint and adjacent-slot search.
 *
 * These are cheap to test and expensive to get subtly wrong: a snap that lands a
 * cabinet a millimetre off looks right on screen and produces a pixel map with a seam
 * in it. The cases below are the ones that decide whether the layout tiles.
 */

import { describe, expect, it } from 'vitest';
import { constrainTo45, nextFreeSlot, snapRect } from './snapping';
import type { Rect } from './wall';

const rect = (xMm: number, yMm: number, widthMm = 500, heightMm = 500): Rect => ({
  xMm,
  yMm,
  widthMm,
  heightMm,
});

describe('snapRect', () => {
  const existing = [rect(0, 0)];

  it('abuts a cabinet dropped near the right-hand edge of another', () => {
    const r = snapRect(rect(492, 3), existing, { toleranceMm: 25 });
    expect(r.xMm).toBe(500); // flush against the right edge
    expect(r.yMm).toBe(0); // top edges aligned
  });

  it('abuts on the left, accounting for the moving cabinet width', () => {
    const r = snapRect(rect(-508, -4), existing, { toleranceMm: 25 });
    expect(r.xMm).toBe(-500);
    expect(r.yMm).toBe(0);
  });

  it('aligns edges of a differently sized cabinet without abutting', () => {
    // A 300 mm-wide cabinet 1200 mm below: too far to touch, but its left edge lines up.
    const r = snapRect(rect(6, 1200, 300, 300), existing, { toleranceMm: 25 });
    expect(r.xMm).toBe(0);
    expect(r.yMm).toBe(1200);
  });

  it('aligns right edges when the right edge is the near one', () => {
    const r = snapRect(rect(196, 1200, 300, 300), existing, { toleranceMm: 25 });
    expect(r.xMm).toBe(200); // 200 + 300 = 500, the static right edge
  });

  it('leaves a position alone when nothing is within tolerance', () => {
    const r = snapRect(rect(462, 137), existing, { toleranceMm: 25 });
    expect(r).toMatchObject({ xMm: 462, yMm: 137, guides: [] });
  });

  it('falls back to the absolute grid on an axis that found no alignment', () => {
    const r = snapRect(rect(1462.4, 0), existing, { toleranceMm: 25, gridMm: 10 });
    expect(r.xMm).toBe(1460);
    expect(r.yMm).toBe(0); // this axis aligned, so the grid did not get a look in
  });

  it('reports a guide per axis that snapped, spanning both rectangles', () => {
    const r = snapRect(rect(492, 300), existing, { toleranceMm: 25 });
    const x = r.guides.find((g) => g.axis === 'x');
    expect(x).toMatchObject({ posMm: 500, fromMm: 0, toMm: 800 });
    expect(r.guides.find((g) => g.axis === 'y')).toBeUndefined();
  });

  it('honours an axis restriction, leaving the other axis untouched by grid or alignment', () => {
    const r = snapRect(rect(492, 3), existing, {
      toleranceMm: 25,
      gridMm: 10,
      axes: ['x'],
    });
    expect(r.xMm).toBe(500);
    expect(r.yMm).toBe(3);
  });

  it('snaps nothing at all when no axis is enabled', () => {
    const r = snapRect(rect(492, 3), existing, { toleranceMm: 25, gridMm: 10, axes: [] });
    expect(r).toMatchObject({ xMm: 492, yMm: 3, guides: [] });
  });

  it('prefers the nearer of two competing alignments', () => {
    const r = snapRect(rect(1010, 0), [rect(0, 0), rect(1500, 0)], { toleranceMm: 25 });
    expect(r.xMm).toBe(1000); // abutting the first, not aligning left with the second
  });
});

describe('constrainTo45', () => {
  it('locks a mostly-horizontal drag to the horizontal, with an exact zero', () => {
    const c = constrainTo45(300, 40);
    expect(c).toEqual({ dxMm: 300, dyMm: 0, axis: 'x' });
  });

  it('locks a mostly-vertical drag to the vertical', () => {
    expect(constrainTo45(-40, -300)).toEqual({ dxMm: 0, dyMm: -300, axis: 'y' });
  });

  it('keeps a diagonal diagonal', () => {
    const c = constrainTo45(200, 180);
    expect(c.dxMm).toBeCloseTo(190);
    expect(c.dyMm).toBeCloseTo(190);
    expect(c.axis).toBeNull();
  });

  it('takes the projection, not the raw length', () => {
    // Locked to the +x/+y diagonal, but the raw drag is steeper than that. Only the
    // component along the diagonal survives, so no distance is invented.
    const c = constrainTo45(100, 200);
    expect(c.dxMm).toBeCloseTo(150);
    expect(c.dyMm).toBeCloseTo(150);
    expect(Math.hypot(c.dxMm, c.dyMm)).toBeLessThan(Math.hypot(100, 200));
  });

  it('is stable at the origin', () => {
    expect(constrainTo45(0, 0)).toEqual({ dxMm: 0, dyMm: 0, axis: 'x' });
  });

  it('quantises along the lock, keeping a diagonal exactly diagonal and on-grid', () => {
    // Rounding x and y independently would give 190/190 -> 190/190 here, but a drag of
    // 194/186 would split to 190/190 only by luck; quantising the distance guarantees it.
    const c = constrainTo45(194.3, 186.1, 10);
    expect(c.dxMm).toBe(190);
    expect(c.dyMm).toBe(190);
    expect(c.dxMm).toBe(c.dyMm); // still exactly 45°
  });

  it('quantises an axis-locked drag too, without disturbing the locked axis', () => {
    expect(constrainTo45(302.7, 40, 10)).toEqual({ dxMm: 300, dyMm: 0, axis: 'x' });
  });
});

describe('nextFreeSlot', () => {
  const anchor = rect(0, 0);
  const size = { widthMm: 500, heightMm: 500 };

  it('places flush against the anchor in each direction', () => {
    expect(nextFreeSlot(anchor, 'right', size, [anchor])).toEqual({ xMm: 500, yMm: 0 });
    expect(nextFreeSlot(anchor, 'left', size, [anchor])).toEqual({ xMm: -500, yMm: 0 });
    expect(nextFreeSlot(anchor, 'down', size, [anchor])).toEqual({ xMm: 0, yMm: 500 });
    expect(nextFreeSlot(anchor, 'up', size, [anchor])).toEqual({ xMm: 0, yMm: -500 });
  });

  it('skips over occupied slots rather than stacking a duplicate', () => {
    const occupied = [anchor, rect(500, 0), rect(1000, 0)];
    expect(nextFreeSlot(anchor, 'right', size, occupied)).toEqual({ xMm: 1500, yMm: 0 });
  });

  it('steps by the new cabinet size, not the anchor size', () => {
    const small = { widthMm: 200, heightMm: 200 };
    const occupied = [anchor, rect(500, 0, 200, 200)];
    expect(nextFreeSlot(anchor, 'right', small, occupied)).toEqual({ xMm: 700, yMm: 0 });
  });

  it('treats a touching neighbour as clear, not as an overlap', () => {
    // rect(500,500) only shares a corner with the slot at (500,0).
    expect(nextFreeSlot(anchor, 'right', size, [anchor, rect(500, 500)])).toEqual({
      xMm: 500,
      yMm: 0,
    });
  });

  it('gives up rather than looping forever on a solid run', () => {
    const solid = Array.from({ length: 6 }, (_, i) => rect(500 * i, 0));
    expect(nextFreeSlot(anchor, 'right', size, solid, 4)).toBeNull();
  });
});
