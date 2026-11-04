/**
 * Pixel Peeker — placement snapping, drag constraint and adjacent-slot search.
 *
 * Pure geometry. Given a rectangle you are about to place, or have just dragged, and
 * the rectangles already on the wall, work out where it should actually land.
 *
 * Two things a wall designer needs that an absolute millimetre grid does not give:
 *
 *  - **Alignment.** Cabinets tile flush. A new cabinet almost always wants to share an
 *    edge line with something already hung, and a grid only helps if the wall happens
 *    to start on a grid multiple. Snapping to the *other cabinets* is what keeps a wall
 *    coherent after it has been dragged about.
 *  - **Abutting.** The commonest intent of all is "next to that one, touching". That is
 *    an alignment of my left edge against their right edge, so it falls out of the same
 *    candidate set rather than needing a mechanism of its own.
 *
 * `toleranceMm` is a millimetre figure, but the caller should derive it from the current
 * zoom so the snap feels like a constant distance on screen at any scale. That
 * conversion is a view concern and deliberately lives in the canvas, not here.
 */

import type { Rect } from './wall';
import { rectsOverlap, snap } from './wall';

export type Axis = 'x' | 'y';

/** An alignment line worth drawing, once a snap has actually taken. */
export interface Guide {
  axis: Axis;
  /** Wall-millimetre position of the line: an x for `axis: 'x'`, a y for `axis: 'y'`. */
  posMm: number;
  /** Extent of the line along the *other* axis, so the UI can draw it tight. */
  fromMm: number;
  toMm: number;
}

export interface SnapResult {
  xMm: number;
  yMm: number;
  guides: Guide[];
}

export interface SnapOptions {
  /** How close an alignment has to be, in wall millimetres, to take. */
  toleranceMm: number;
  /** Fallback grid for an axis that found no alignment. 0 or undefined disables it. */
  gridMm?: number;
  /**
   * Restrict snapping to these axes. An axis left out is returned exactly as given —
   * no alignment and no grid. Used by a constrained drag, where snapping across the
   * constraint would silently break it. Omit for the usual free case.
   */
  axes?: readonly Axis[];
}

/** A position the moving rect could take on one axis, and the line it would share. */
interface Candidate {
  posMm: number;
  lineMm: number;
}

const LINE_EPS_MM = 0.01;

/**
 * Candidate x positions for `m` derived from static rect `o`.
 *
 * Order is the tie-break: abutting beats edge alignment beats centre alignment, because
 * that is the order of how often it is what was meant.
 */
function candidatesX(m: Rect, o: Rect): Candidate[] {
  const w = m.widthMm;
  const left = o.xMm;
  const right = o.xMm + o.widthMm;
  return [
    { posMm: right, lineMm: right },                          // my left edge abuts their right
    { posMm: left - w, lineMm: left },                         // my right edge abuts their left
    { posMm: left, lineMm: left },                             // left edges align
    { posMm: right - w, lineMm: right },                       // right edges align
    { posMm: (left + right - w) / 2, lineMm: (left + right) / 2 }, // centres align
  ];
}

function candidatesY(m: Rect, o: Rect): Candidate[] {
  const h = m.heightMm;
  const top = o.yMm;
  const bottom = o.yMm + o.heightMm;
  return [
    { posMm: bottom, lineMm: bottom },
    { posMm: top - h, lineMm: top },
    { posMm: top, lineMm: top },
    { posMm: bottom - h, lineMm: bottom },
    { posMm: (top + bottom - h) / 2, lineMm: (top + bottom) / 2 },
  ];
}

function bestCandidate(
  axis: Axis,
  m: Rect,
  others: readonly Rect[],
  toleranceMm: number,
): Candidate | null {
  const current = axis === 'x' ? m.xMm : m.yMm;
  const gen = axis === 'x' ? candidatesX : candidatesY;
  let best: Candidate | null = null;
  let bestDist = Infinity;
  for (const o of others) {
    for (const c of gen(m, o)) {
      const dist = Math.abs(c.posMm - current);
      // Strictly closer, so the candidate order above decides ties.
      if (dist <= toleranceMm && dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
  }
  return best;
}

/** Every static rect that touches this alignment line, so the guide spans them all. */
function contributors(axis: Axis, lineMm: number, others: readonly Rect[]): Rect[] {
  return others.filter((o) => {
    const near = axis === 'x'
      ? [o.xMm, o.xMm + o.widthMm, o.xMm + o.widthMm / 2]
      : [o.yMm, o.yMm + o.heightMm, o.yMm + o.heightMm / 2];
    return near.some((v) => Math.abs(v - lineMm) < LINE_EPS_MM);
  });
}

function guideFor(axis: Axis, lineMm: number, moving: Rect, others: readonly Rect[]): Guide {
  const involved = [moving, ...contributors(axis, lineMm, others)];
  const from = involved.map((r) => (axis === 'x' ? r.yMm : r.xMm));
  const to = involved.map((r) =>
    axis === 'x' ? r.yMm + r.heightMm : r.xMm + r.widthMm,
  );
  return { axis, posMm: lineMm, fromMm: Math.min(...from), toMm: Math.max(...to) };
}

/**
 * Resolve where `moving` should sit, given everything else already on the wall.
 *
 * Each axis is resolved independently: alignment with another cabinet first, and only
 * if nothing is in range, the absolute grid. Returns the position plus the alignment
 * lines that took, for the caller to draw.
 */
export function snapRect(
  moving: Rect,
  others: readonly Rect[],
  options: SnapOptions,
): SnapResult {
  const { toleranceMm, gridMm = 0, axes } = options;
  const enabled = (axis: Axis) => !axes || axes.includes(axis);

  let xMm = moving.xMm;
  let yMm = moving.yMm;
  let xLine: number | null = null;
  let yLine: number | null = null;

  if (enabled('x')) {
    const c = bestCandidate('x', moving, others, toleranceMm);
    if (c) {
      xMm = c.posMm;
      xLine = c.lineMm;
    } else {
      xMm = snap(xMm, gridMm);
    }
  }
  if (enabled('y')) {
    const c = bestCandidate('y', moving, others, toleranceMm);
    if (c) {
      yMm = c.posMm;
      yLine = c.lineMm;
    } else {
      yMm = snap(yMm, gridMm);
    }
  }

  const settled: Rect = { ...moving, xMm, yMm };
  const guides: Guide[] = [];
  if (xLine !== null) guides.push(guideFor('x', xLine, settled, others));
  if (yLine !== null) guides.push(guideFor('y', yLine, settled, others));

  return { xMm, yMm, guides };
}

// ---------------------------------------------------------------------------
// Drag constraint
// ---------------------------------------------------------------------------

export interface ConstrainedDelta {
  dxMm: number;
  dyMm: number;
  /**
   * The axis the movement is free on, or null for a diagonal. The caller uses this to
   * stop snapping from pulling the drag off the constraint it just applied.
   */
  axis: Axis | null;
}

/** Unit-ish direction per octant of the 45° rose, starting at +x and going clockwise. */
const OCTANTS: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * Constrain a drag to the nearest 45° multiple.
 *
 * The distance travelled is the *projection* of the raw drag onto the locked
 * direction, not the raw length: dragging away at a shallow angle should not gain you
 * distance you did not travel along the direction you are locked to. It is never
 * negative, because the chosen direction is by construction within 22.5° of the raw one.
 *
 * `gridMm` quantises that distance rather than the two components separately, and this
 * is the whole trick. Rounding x and y independently would pull a diagonal off 45° by
 * up to half a grid step on each axis; rounding the distance along the lock keeps both
 * components equal, so the drag stays exactly diagonal *and* lands on whole grid units.
 * Without it, a diagonal drag is the one path in the app that leaves a cabinet on a
 * fractional millimetre, because alignment snapping is deliberately off there.
 *
 * The components are built from an integer direction rather than `cos`/`sin`, so a
 * horizontal drag gets an exactly zero `dyMm` instead of 6e-17.
 */
export function constrainTo45(dxMm: number, dyMm: number, gridMm = 0): ConstrainedDelta {
  const octant = ((Math.round(Math.atan2(dyMm, dxMm) / (Math.PI / 4)) % 8) + 8) % 8;
  const [sx, sy] = OCTANTS[octant];
  // Divided by the squared length, so this is the size of each component, not the
  // hypotenuse — which is exactly what wants quantising.
  const projection = (dxMm * sx + dyMm * sy) / (sx * sx + sy * sy);
  const along = snap(Math.max(0, projection), gridMm);
  return {
    dxMm: along * sx,
    dyMm: along * sy,
    axis: sx !== 0 && sy !== 0 ? null : sy === 0 ? 'x' : 'y',
  };
}

// ---------------------------------------------------------------------------
// Adjacent placement
// ---------------------------------------------------------------------------

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Where the next cabinet goes if you press an arrow key with `anchor` selected.
 *
 * The first candidate sits flush against the anchor. If something is already there the
 * search steps on by the new cabinet's own size (not the anchor's — they need not be
 * the same model) until it finds clear space, so an arrow always extends the run rather
 * than stacking a duplicate on top of an existing cabinet.
 *
 * Returns null if nothing is clear within `maxSteps`, which on a real wall means the
 * user is holding the key down against a wall that is already solid in that direction.
 */
export function nextFreeSlot(
  anchor: Rect,
  direction: Direction,
  size: { widthMm: number; heightMm: number },
  occupied: readonly Rect[],
  maxSteps = 200,
): { xMm: number; yMm: number } | null {
  const { widthMm, heightMm } = size;
  const start =
    direction === 'right' ? { xMm: anchor.xMm + anchor.widthMm, yMm: anchor.yMm } :
    direction === 'left' ? { xMm: anchor.xMm - widthMm, yMm: anchor.yMm } :
    direction === 'down' ? { xMm: anchor.xMm, yMm: anchor.yMm + anchor.heightMm } :
    { xMm: anchor.xMm, yMm: anchor.yMm - heightMm };

  const stepX = direction === 'right' ? widthMm : direction === 'left' ? -widthMm : 0;
  const stepY = direction === 'down' ? heightMm : direction === 'up' ? -heightMm : 0;

  for (let i = 0; i < maxSteps; i++) {
    const candidate: Rect = {
      xMm: start.xMm + stepX * i,
      yMm: start.yMm + stepY * i,
      widthMm,
      heightMm,
    };
    if (!occupied.some((o) => rectsOverlap(candidate, o))) {
      return { xMm: candidate.xMm, yMm: candidate.yMm };
    }
  }
  return null;
}
