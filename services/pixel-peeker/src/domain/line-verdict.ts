/**
 * Pixel Peeker — which line binds: data or power.
 *
 * A run of cabinets has to satisfy BOTH lines — one processor port and one power
 * circuit — so the run you can build is the smaller of the two, and which one it is
 * flips with the cabinet, the bit depth and the country. Showing the two answers side by
 * side without saying which binds leaves the user to do the one bit of reasoning the
 * Line calc view exists for.
 */

import type { CabinetSpec } from './types';

export type Binding = 'data' | 'power' | 'both' | 'none';

export interface LineVerdict {
  /** Cabinets in one run that both lines can carry. */
  run: number;
  /** `both` when they run out together; `none` when not even one cabinet fits. */
  binds: Binding;
  /** Cabinets the other line could still carry — the capacity that run leaves unused. */
  spare: number;
  /** The run laid out in a row and in a column. */
  rowMm: number;
  columnMm: number;
}

export function lineVerdict(
  cabinet: Pick<CabinetSpec, 'widthMm' | 'heightMm'>,
  dataPanels: number,
  powerPanels: number,
): LineVerdict {
  const run = Math.max(0, Math.min(dataPanels, powerPanels));
  const binds: Binding =
    run <= 0 ? 'none' : dataPanels === powerPanels ? 'both' : dataPanels < powerPanels ? 'data' : 'power';
  return {
    run,
    binds,
    spare: Math.abs(dataPanels - powerPanels),
    rowMm: run * cabinet.widthMm,
    columnMm: run * cabinet.heightMm,
  };
}
