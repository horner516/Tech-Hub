/**
 * Pixel Peeker — the one published panels-per-power-cable table found for the library.
 *
 * Researched for Line Calc on 2026-09-21 and moved here with it; the research notes
 * (where else was looked, and what ROE, Unilumin, Gloshine and Aluvision do not
 * publish) are in docs/NOTES.md.
 *
 * Absen, PL V2 Series User Manual, section 4.2, page 19: "Under different cabinet sizes
 * and different input voltages, there are differences in the number of cabinets that
 * wires are able to carry." The table is for ONE 3x2.5mm2 power cable, which is what
 * Absen specify between the distribution box and the cabinet.
 *
 * WHAT THE TABLE TURNS OUT TO BE. The AC110V column is the AC220V column halved and
 * rounded UP — `ceil(at220V / 2)` in all eighteen rows. That is the signature of a
 * CURRENT limit: hold the panel's wattage constant and halve the voltage and you double
 * the current, so you halve the panels. It is not a power limit and not a cable-length
 * limit.
 *
 * Fifteen rows halve exactly. The three that do not are the odd-numbered 7-panel rows
 * (the outdoor 500x1000 Pro cabinets), where 3.5 is rounded up to 4 — and rounding UP is
 * the less conservative direction, so those three 110 V figures sit about 14% higher in
 * current than their own 220 V row does. It is the one place the table argues with
 * itself, and it is worth knowing before leaning on the 110 V column.
 *
 * Divide back out — panels x watts / 220 — and every row lands between about 9.7 A and
 * 15.3 A, i.e. under 16 A, which is what 2.5mm2 flex on a 16 A breaker gives you. So the
 * published figures are a conservative, rounded engineering recommendation that sits
 * inside a 16 A limit, not a computed maximum: Absen have quantised to 7/10/12 panels at
 * 110 V and doubled it. `power-line.test.ts` asserts exactly that, which is what makes
 * the table worth carrying — it lets the Line calc view show a user how much margin the
 * manufacturer left, rather than just repeating a number at them.
 *
 * Nobody else in the library publishes one. ROE print "Max. Hanging" and "Max. Stacking"
 * instead, which are mechanical and get misread as power limits constantly.
 */

export interface PublishedChain {
  /** Cabinet ids in `CABINET_LIBRARY` that this row covers. */
  panelIds: string[];
  /** The model name exactly as the manual prints it. */
  publishedAs: string;
  environment: 'Indoor' | 'Outdoor';
  cabinetMm: string;
  at220V: number;
  at110V: number;
}

export const PUBLISHED_CHAIN_SOURCE =
  'Absen PL V2 Series User Manual, section 4.2 p.19 — one 3x2.5mm2 power cable';

export const PUBLISHED_CHAINS: PublishedChain[] = [
  /* Outdoor, 500x500 */
  { panelIds: ['absen-pl29-pro-v2'], publishedAs: 'PL2.9 Pro V2', environment: 'Outdoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl39-pro-v2'], publishedAs: 'PL3.9 Pro V2', environment: 'Outdoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl39w-plus-v2'], publishedAs: 'PL3.9W Plus V2', environment: 'Outdoor', cabinetMm: '500x500', at220V: 20, at110V: 10 },
  { panelIds: ['absen-pl48-pro-v2'], publishedAs: 'PL4.8 Pro V2', environment: 'Outdoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl48w-plus-v2'], publishedAs: 'PL4.8W Plus V2', environment: 'Outdoor', cabinetMm: '500x500', at220V: 20, at110V: 10 },
  /* Outdoor, 500x1000 — the same panels in a double-height cabinet, so half the count. */
  { panelIds: [], publishedAs: 'PL2.9 Pro V2', environment: 'Outdoor', cabinetMm: '500x1000', at220V: 7, at110V: 4 },
  { panelIds: [], publishedAs: 'PL3.9 Pro V2', environment: 'Outdoor', cabinetMm: '500x1000', at220V: 7, at110V: 4 },
  { panelIds: [], publishedAs: 'PL3.9W Plus V2', environment: 'Outdoor', cabinetMm: '500x1000', at220V: 10, at110V: 5 },
  { panelIds: [], publishedAs: 'PL4.8 Pro V2', environment: 'Outdoor', cabinetMm: '500x1000', at220V: 7, at110V: 4 },
  { panelIds: [], publishedAs: 'PL4.8W Plus V2', environment: 'Outdoor', cabinetMm: '500x1000', at220V: 10, at110V: 5 },
  /* Indoor, 500x500 */
  { panelIds: ['absen-pl19-plus-v2'], publishedAs: 'PL1.9 Plus V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl25-xr-v2-brompton'], publishedAs: 'PL2.5 XR V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl25-pro-v2-brompton', 'absen-pl25-pro-v2-novastar'], publishedAs: 'PL2.5 Pro V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 14, at110V: 7 },
  { panelIds: ['absen-pl25-plus-v2'], publishedAs: 'PL2.5 Plus V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 20, at110V: 10 },
  { panelIds: ['absen-pl29-plus-v2'], publishedAs: 'PL2.9 Plus V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 24, at110V: 12 },
  { panelIds: ['absen-pl39-plus-v2'], publishedAs: 'PL3.9 Plus V2', environment: 'Indoor', cabinetMm: '500x500', at220V: 24, at110V: 12 },
  /* Indoor, 500x1000 */
  { panelIds: [], publishedAs: 'PL2.9 Plus V2', environment: 'Indoor', cabinetMm: '500x1000', at220V: 12, at110V: 6 },
  { panelIds: [], publishedAs: 'PL3.9 Plus V2', environment: 'Indoor', cabinetMm: '500x1000', at220V: 12, at110V: 6 },
];

/** The published row for a panel, if there is one. */
export function publishedChainFor(panelId: string): PublishedChain | undefined {
  return PUBLISHED_CHAINS.find((c) => c.panelIds.includes(panelId));
}

/** The current a published row implies, given the panel's peak watts. */
export function impliedAmps(chain: PublishedChain, powerMaxW: number): number {
  return (chain.at220V * powerMaxW) / 220;
}

/** The cable limit every row of the table sits inside: 2.5mm2 flex on a 16 A breaker. */
export const PUBLISHED_CHAIN_LIMIT_A = 16;

export interface PublishedChainMargin {
  impliedAmps: number;
  /** Current the manufacturer left unused inside `PUBLISHED_CHAIN_LIMIT_A`. */
  spareAmps: number;
  /**
   * How many more panels this calculator allows than the manufacturer recommends — it
   * works to the user's breaker rather than to the manufacturer's cable. Can be negative
   * on a small breaker.
   */
  panelsOverPublished: number;
}

/** What a published row says once it is checked against the panel's own peak watts. */
export function publishedChainMargin(
  chain: PublishedChain,
  powerMaxW: number,
  computedPanelsPerCircuit: number,
): PublishedChainMargin {
  const amps = impliedAmps(chain, powerMaxW);
  return {
    impliedAmps: amps,
    spareAmps: PUBLISHED_CHAIN_LIMIT_A - amps,
    panelsOverPublished: computedPanelsPerCircuit - chain.at220V,
  };
}
