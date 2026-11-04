/**
 * Pixel Peeker — wall geometry and derived physical figures.
 *
 * Wall space is millimetres, origin top-left, +x right, +y down.
 * Pixel space is derived from millimetre space by dividing by pitch. For a
 * single-pitch wall that is exact. For a mixed-pitch wall it is not, and cannot
 * be — see `pixelOriginOf` for how we handle it and what we warn about.
 */

import type { CabinetInstance, CabinetSpec, Project } from './types';
import { cabinetPixels } from './types';

export interface Rect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SpecLookup = (specId: string) => CabinetSpec | undefined;

export function cabinetRect(inst: CabinetInstance, spec: CabinetSpec): Rect {
  return {
    xMm: inst.xMm,
    yMm: inst.yMm,
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  const EPS = 0.5; // half a millimetre — cabinets that touch are not overlapping
  return (
    a.xMm + a.widthMm - EPS > b.xMm &&
    b.xMm + b.widthMm - EPS > a.xMm &&
    a.yMm + a.heightMm - EPS > b.yMm &&
    b.yMm + b.heightMm - EPS > a.yMm
  );
}

/** Millimetre bounding box of every placed cabinet. */
export function wallBoundsMm(project: Project, lookup: SpecLookup): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (!spec) continue;
    minX = Math.min(minX, inst.xMm);
    minY = Math.min(minY, inst.yMm);
    maxX = Math.max(maxX, inst.xMm + spec.widthMm);
    maxY = Math.max(maxY, inst.yMm + spec.heightMm);
  }
  if (!Number.isFinite(minX)) return null;
  return { xMm: minX, yMm: minY, widthMm: maxX - minX, heightMm: maxY - minY };
}

/** The pitches actually in use. More than one means the pixel map is approximate. */
export function pitchesInUse(project: Project, lookup: SpecLookup): number[] {
  const set = new Set<number>();
  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (spec) set.add(spec.pixelPitchMm);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The pitch a cabinet ACTUALLY tiles at: its width divided by its pixel count.
 *
 * `pixelPitchMm` is the figure on the datasheet, and datasheets round — Absen call
 * 500/168 "2.97" and Gloshine call 500/128 "3.91". Rounding is fine for a label but not
 * for dividing millimetres into pixels: at 2.97 the second PL2.9 cabinet across lands on
 * pixel 337 instead of 336, and every cabinet after it is a pixel out. The pixel map
 * therefore derives its reference pitch from this, never from the printed figure.
 */
export function truePitchMm(spec: CabinetSpec): number {
  return spec.widthMm / spec.pixelsX;
}

/** The finest true pitch on the wall — the reference the pixel map is divided at. */
export function referencePitchMm(project: Project, lookup: SpecLookup): number {
  let finest = Infinity;
  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (spec) finest = Math.min(finest, truePitchMm(spec));
  }
  return Number.isFinite(finest) ? finest : 2.6;
}

/**
 * Pixel-space rectangle of one cabinet.
 *
 * Pixel origin is derived by dividing the cabinet's millimetre offset (relative to
 * the wall bounding box) by the reference pitch, then rounding. On a single-pitch
 * wall this is exact and cabinets tile with no gaps. On a mixed-pitch wall the
 * result is the nearest sensible integer map and callers should surface the
 * `mixedPitch` warning from `validateWall`.
 */
export function pixelRectOf(
  inst: CabinetInstance,
  spec: CabinetSpec,
  origin: { xMm: number; yMm: number },
  referencePitchMm: number,
): PixelRect {
  return {
    x: Math.round((inst.xMm - origin.xMm) / referencePitchMm),
    y: Math.round((inst.yMm - origin.yMm) / referencePitchMm),
    width: spec.pixelsX,
    height: spec.pixelsY,
  };
}

export interface WallStats {
  cabinetCount: number;
  /** Cabinet count broken down by spec id. */
  byModel: { specId: string; spec: CabinetSpec; count: number }[];
  totalPixels: number;
  boundsMm: Rect | null;
  boundingPixels: PixelRect | null;
  /** Fill ratio of the bounding box — <1 means an irregular (non-rectangular) wall. */
  fillRatio: number;
  totalWeightKg: number;
  powerMaxW: number;
  powerAvgW: number;
  /**
   * Peak current at 230 V and 110 V, SINGLE PHASE, from the all-white peak power.
   * Divide by 3 for a balanced three-phase supply, which is what a wall of any size
   * will actually be fed from. These are steady-state figures and take no account of
   * inrush, power factor or the derating your local regs require.
   */
  peakAmps230: number;
  peakAmps110: number;
  areaSqm: number;
  referencePitchMm: number;
}

export function wallStats(project: Project, lookup: SpecLookup): WallStats {
  const bounds = wallBoundsMm(project, lookup);
  const referencePitch = referencePitchMm(project, lookup);

  const counts = new Map<string, number>();
  let totalPixels = 0;
  let totalWeightKg = 0;
  let powerMaxW = 0;
  let powerAvgW = 0;
  let areaSqmm = 0;

  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (!spec) continue;
    counts.set(inst.specId, (counts.get(inst.specId) ?? 0) + 1);
    totalPixels += cabinetPixels(spec);
    totalWeightKg += spec.weightKg;
    powerMaxW += spec.powerMaxW;
    powerAvgW += spec.powerAvgW;
    areaSqmm += spec.widthMm * spec.heightMm;
  }

  const byModel = [...counts.entries()]
    .map(([specId, count]) => ({ specId, spec: lookup(specId)!, count }))
    .filter((r) => r.spec)
    .sort((a, b) => b.count - a.count);

  const boundingPixels = bounds
    ? {
        x: 0,
        y: 0,
        width: Math.round(bounds.widthMm / referencePitch),
        height: Math.round(bounds.heightMm / referencePitch),
      }
    : null;

  const boundingArea = bounds ? bounds.widthMm * bounds.heightMm : 0;

  return {
    cabinetCount: project.cabinets.length,
    byModel,
    totalPixels,
    boundsMm: bounds,
    boundingPixels,
    fillRatio: boundingArea > 0 ? areaSqmm / boundingArea : 0,
    totalWeightKg,
    powerMaxW,
    powerAvgW,
    peakAmps230: powerMaxW / 230,
    peakAmps110: powerMaxW / 110,
    areaSqm: areaSqmm / 1e6,
    referencePitchMm: referencePitch,
  };
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Build a rectangular block of cabinets, top-left anchored at (xMm, yMm). */
export function buildGrid(
  spec: CabinetSpec,
  cols: number,
  rows: number,
  xMm: number,
  yMm: number,
  idFactory: () => string,
): CabinetInstance[] {
  const out: CabinetInstance[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        id: idFactory(),
        specId: spec.id,
        xMm: xMm + c * spec.widthMm,
        yMm: yMm + r * spec.heightMm,
        rotation: 0,
      });
    }
  }
  return out;
}

/** How many cabinets fit in a canvas, and the leftover. */
export function fitToCanvas(
  spec: CabinetSpec,
  widthMm: number,
  heightMm: number,
): { cols: number; rows: number; remainderXMm: number; remainderYMm: number } {
  const cols = Math.floor(widthMm / spec.widthMm);
  const rows = Math.floor(heightMm / spec.heightMm);
  return {
    cols,
    rows,
    remainderXMm: widthMm - cols * spec.widthMm,
    remainderYMm: heightMm - rows * spec.heightMm,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Ids of the objects involved, for click-to-select in the UI. */
  refs?: string[];
}

export function validateWall(project: Project, lookup: SpecLookup): Issue[] {
  const issues: Issue[] = [];

  const missing = project.cabinets.filter((c) => !lookup(c.specId));
  if (missing.length) {
    issues.push({
      severity: 'error',
      code: 'unknown-spec',
      message: `${missing.length} cabinet(s) reference a spec that is not in the library.`,
      refs: missing.map((c) => c.id),
    });
  }

  // Overlap check, O(n^2) but n is a few hundred at most.
  const placed = project.cabinets
    .map((inst) => ({ inst, spec: lookup(inst.specId) }))
    .filter((r): r is { inst: CabinetInstance; spec: CabinetSpec } => !!r.spec);

  const overlapping = new Set<string>();
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (
        rectsOverlap(
          cabinetRect(placed[i].inst, placed[i].spec),
          cabinetRect(placed[j].inst, placed[j].spec),
        )
      ) {
        overlapping.add(placed[i].inst.id);
        overlapping.add(placed[j].inst.id);
      }
    }
  }
  if (overlapping.size) {
    issues.push({
      severity: 'error',
      code: 'overlap',
      message: `${overlapping.size} cabinet(s) physically overlap.`,
      refs: [...overlapping],
    });
  }

  const pitches = pitchesInUse(project, lookup);
  if (pitches.length > 1) {
    issues.push({
      severity: 'warning',
      code: 'mixed-pitch',
      message: `Wall mixes ${pitches.length} pitches (${pitches.join(', ')} mm). The pixel map is approximate — it is built on the ${pitches[0]} mm reference and cabinets of other pitches will not land on exact pixel boundaries.`,
    });
  }

  const bounds = wallBoundsMm(project, lookup);
  if (bounds) {
    if (
      bounds.widthMm > project.canvas.widthMm + 0.5 ||
      bounds.heightMm > project.canvas.heightMm + 0.5
    ) {
      issues.push({
        severity: 'warning',
        code: 'outside-canvas',
        message: `Cabinets extend past the canvas: wall is ${Math.round(bounds.widthMm)} x ${Math.round(bounds.heightMm)} mm, canvas is ${project.canvas.widthMm} x ${project.canvas.heightMm} mm.`,
      });
    }
  }

  return issues;
}
