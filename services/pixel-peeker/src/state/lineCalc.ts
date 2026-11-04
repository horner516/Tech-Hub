/**
 * Pixel Peeker — the Line calc view's inputs.
 *
 * Separate from the project store on purpose: the line calculator answers "how many of
 * these fit on a line?" for any cabinet in the library, and none of that belongs in the
 * project document, its undo stack or its save file. It is a store rather than
 * component state only so the inputs survive switching to the designer and back — the
 * view unmounts while the designer is showing (see `App`).
 */

import { create } from 'zustand';
import { DEFAULT_POWER_PLAN, type PowerBasis } from '../domain/power-line';
import type { BitDepth, CabinetSpec } from '../domain/types';

export const CUSTOM_CABINET_ID = '__custom__';

/** The starting point for a cabinet described by hand. */
export const CUSTOM_CABINET: CabinetSpec = {
  id: CUSTOM_CABINET_ID,
  manufacturer: 'Custom',
  series: 'Custom',
  model: 'Custom panel',
  pixelPitchMm: 2.5,
  widthMm: 500,
  heightMm: 500,
  // Not asked for: nothing in the line calculator depends on depth.
  depthMm: 0,
  pixelsX: 200,
  pixelsY: 200,
  weightKg: 7.5,
  powerMaxW: 180,
  powerAvgW: 60,
  verified: false,
  source: 'entered by hand',
};

export interface LineCalcInputs {
  cabinetId: string;
  custom: CabinetSpec;
  processorId: string;
  bitDepth: BitDepth;
  frameRateHz: number;
  supplyId: string;
  breakerAmps: number;
  derated: boolean;
  basis: PowerBasis;
  wallPanels: number;
}

interface LineCalcState extends LineCalcInputs {
  set: (patch: Partial<LineCalcInputs>) => void;
}

export const useLineCalc = create<LineCalcState>((set) => ({
  cabinetId: 'absen-pl25-pro-v2-novastar',
  custom: CUSTOM_CABINET,
  processorId: 'novastar-mx40-pro',
  bitDepth: 8,
  frameRateHz: 60,
  supplyId: DEFAULT_POWER_PLAN.supplyId,
  breakerAmps: DEFAULT_POWER_PLAN.breakerAmps,
  derated: DEFAULT_POWER_PLAN.derated,
  basis: 'peak',
  wallPanels: 120,
  set: (patch) => set(patch),
}));
