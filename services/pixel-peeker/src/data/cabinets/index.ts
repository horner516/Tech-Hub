/**
 * Pixel Peeker — cabinet library.
 *
 * PROVENANCE POLICY — read before adding anything.
 *
 * `verified: true` means the numbers came from a manufacturer datasheet, and the
 * `source` field says which one. Everything in this file marked verified was parsed
 * out of the PDF named in its `source`, not typed from memory and not taken from a
 * rental house's listing page (those are frequently wrong, and frequently describe a
 * different revision of the same product name).
 *
 * `verified: false` means the record is good enough to lay out a wall with but must
 * not be used to quote a job or size a distro. The UI badges these.
 *
 * DO NOT copy records out of a competitor's curated database. The specs themselves
 * are facts and are fine to take from the manufacturer; a compiled database is a
 * protected work in its own right under UK/EU database right. Primary sources only.
 *
 * Power figures: where a datasheet quotes W/m2, the per-panel figure here is derived
 * from the actual panel area. Where it quotes W/tile, it is used directly.
 */

import type { CabinetSpec } from '../../domain/types';
import { ABSEN_CABINETS } from './absen';
import { ALUVISION_CABINETS } from './aluvision';
import { GLOSHINE_CABINETS } from './gloshine';
import { ROE_CABINETS } from './roe';
import { UNILUMIN_CABINETS } from './unilumin';

/**
 * One module per manufacturer. The records inside each are grouped by series, with the
 * series-wide facts (cabinet construction, IP rating, what the sheet does and does not
 * say) in a comment above the group and only the per-model facts in `notes`.
 *
 * `pixelPitchMm` is the pitch as the datasheet prints it — Absen say 2.97 for 500/168,
 * Gloshine say 3.91 for 500/128. It is a label. The pixel map divides millimetres by
 * `widthMm / pixelsX`, never by this field, so a rounded label cannot put a cabinet a
 * pixel out of place; see `truePitchMm` in domain/wall.ts.
 */
export const CABINET_LIBRARY: CabinetSpec[] = [
  ...ABSEN_CABINETS,
  ...ALUVISION_CABINETS,
  ...GLOSHINE_CABINETS,
  ...ROE_CABINETS,
  ...UNILUMIN_CABINETS,
];

export const MANUFACTURERS = [
  ...new Set(CABINET_LIBRARY.map((c) => c.manufacturer)),
].sort();

export function cabinetById(id: string): CabinetSpec | undefined {
  return CABINET_LIBRARY.find((c) => c.id === id);
}
