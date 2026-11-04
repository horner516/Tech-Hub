/**
 * Pixel Peeker — how many cabinets one power circuit carries.
 *
 * Came across from Line Calc, the standalone line calculator that this app's Line calc
 * view replaced (2026-10-11). Before it, the only power figure here was the wall's peak
 * watts divided by 230 (`WallStats.peakAmps230`), which says what the wall draws and
 * nothing about how many circuits it needs.
 *
 * WHY THIS IS COMPUTED RATHER THAN LOOKED UP. Almost no manufacturer publishes a
 * panels-per-circuit figure, and the ones that do publish it for their own cable and
 * their own assumptions. ROE's brochures, for instance, print "Max. Hanging (panels)"
 * and "Max. Stacking (panels)" — 12 and 5 for the Carbon series — which are MECHANICAL
 * limits about what the top panel's frame can hold, and are routinely misread as power
 * limits. They are unrelated numbers that happen to look alike.
 *
 * Absen are the exception and the calibration source: the PL V2 series user manual
 * (p.19) tabulates the quantity of cabinets one 3x2.5mm2 power cable carries, at AC220V
 * and at AC110V, for eighteen models. See `published-chains.ts` for the table and for
 * what checking it against the power figures reveals.
 *
 * THE ARITHMETIC. A panel is a resistive-ish load at unity-ish power factor, so
 *
 *     current per panel = watts / volts
 *     panels per circuit = floor( breaker amps x derating / current per panel )
 *
 * and the only real questions are which watts, which volts, and what derating.
 *
 *   WHICH WATTS. Peak (all-white at full brightness) for anything that sizes a cable or
 *   a breaker; average for estimating what the venue will actually be asked for. A
 *   distro sized on average power trips the first time someone puts up a white holding
 *   slide, which is why `powerMaxW` is the default here, and the only basis the wall
 *   designer's Power section and PDF use.
 *
 *   WHICH VOLTS. 230 V single phase (UK/EU), 120 V (US), 208 V (US three-phase
 *   line-to-line) and 400 V three-phase all appear on real jobs, and the answer roughly
 *   halves between 230 V and 120 V for the same breaker — which is exactly the factor
 *   of two in Absen's two columns.
 *
 *   WHAT DERATING. A breaker is rated for its trip current, not for a load you intend to
 *   leave on all day. The 80% rule (NEC 210.20(A) for a continuous load; BS 7671 reaches
 *   the same place by a different route) is the default here and is the number most
 *   rental power plans assume. Inrush is a separate problem and is flagged, not modelled:
 *   LED panel PSUs draw a large, brief surge at switch-on, which is why a wall is
 *   switched on in sections and why a type-B breaker that holds steady-state can still
 *   trip on power-up.
 *
 * This is steady-state arithmetic, not a design. Sizing a circuit is a job for whoever
 * signs off the distro, and every place this surfaces says so.
 */

import type { CabinetSpec, PowerPlan } from './types';

export type PowerBasis = 'peak' | 'average';

type PowerFigures = Pick<CabinetSpec, 'powerMaxW' | 'powerAvgW'>;

export interface SupplySpec {
  id: string;
  label: string;
  /** PHASE voltage — what one line-to-neutral load sees. `label` is the name people say. */
  volts: number;
  phases: 1 | 3;
  /** Breaker ratings that are actually fitted to distros on this supply. */
  breakers: number[];
  region: string;
}

/*
 * The supplies a wall actually gets plugged into. Voltages are nominal: BS 7671 and
 * IEC 60038 put the UK/EU single-phase nominal at 230 V (the old 240 V UK and 220 V
 * European figures were harmonised onto it with asymmetric tolerances, and distribution
 * in the UK still sits nearer 240 V in practice), and NEC-land at 120/208/240 V.
 */
export const SUPPLIES: SupplySpec[] = [
  { id: 'uk-230-1p', label: '230 V single phase', volts: 230, phases: 1, breakers: [10, 13, 16, 20, 32], region: 'UK / EU' },
  { id: 'uk-400-3p', label: '400 V three phase', volts: 230, phases: 3, breakers: [16, 32, 63, 125], region: 'UK / EU' },
  { id: 'us-120-1p', label: '120 V single phase', volts: 120, phases: 1, breakers: [15, 20, 30], region: 'US' },
  { id: 'us-208-3p', label: '208 V three phase', volts: 120, phases: 3, breakers: [20, 30, 60, 100], region: 'US' },
  { id: 'us-240-1p', label: '240 V single phase', volts: 240, phases: 1, breakers: [20, 30, 50], region: 'US' },
];

/** NEC 210.20(A): a continuous load may use 80% of the overcurrent device's rating. */
export const CONTINUOUS_LOAD_DERATE = 0.8;

export interface PowerLineInput {
  supply: SupplySpec;
  breakerAmps: number;
  /** Fraction of the breaker rating the load may use. 0.8 is the continuous-load rule. */
  derate: number;
  basis: PowerBasis;
}

export interface PowerLineResult {
  /** Panels on one circuit. For three phase this is panels per PHASE. */
  panelsPerCircuit: number;
  /** ...and across all three phases, for a three-phase distro feeding the wall evenly. */
  panelsPerSupply: number;
  wattsPerPanel: number;
  ampsPerPanel: number;
  /** The current the circuit is allowed to carry after derating. */
  usableAmps: number;
  /** What `panelsPerCircuit` panels actually draw, and the share of the derated limit that is. */
  drawAmps: number;
  utilisation: number;
  /** Current left on the circuit before the next panel would exceed the derated limit. */
  spareAmps: number;
  totalWatts: number;
}

export function powerLine(panel: PowerFigures, input: PowerLineInput): PowerLineResult {
  const watts = input.basis === 'peak' ? panel.powerMaxW : panel.powerAvgW;
  if (!(watts > 0)) throw new Error('a panel that draws nothing has no power limit');

  /*
   * Three phase feeds a wall as three independent single-phase circuits, one per leg —
   * the panels are line-to-neutral loads, not line-to-line. So the per-circuit answer
   * uses the PHASE voltage (230 V of a 400 V supply, 120 V of a 208 V supply), which is
   * why `volts` above is the phase voltage and the label is the line-to-line name.
   */
  const ampsPerPanel = watts / input.supply.volts;
  const usableAmps = input.breakerAmps * input.derate;
  const panelsPerCircuit = Math.floor(usableAmps / ampsPerPanel);
  const drawAmps = panelsPerCircuit * ampsPerPanel;

  return {
    panelsPerCircuit,
    panelsPerSupply: panelsPerCircuit * input.supply.phases,
    wattsPerPanel: watts,
    ampsPerPanel,
    usableAmps,
    drawAmps,
    utilisation: usableAmps > 0 ? drawAmps / usableAmps : 0,
    spareAmps: usableAmps - drawAmps,
    totalWatts: panelsPerCircuit * watts,
  };
}

export interface WallPower {
  /** Circuits (single-phase legs) needed to cover every panel, rounded up. */
  circuits: number;
  /** Whole-wall current per leg, the wall spread evenly across the phases. */
  peakAmpsTotal: number;
  avgAmpsTotal: number;
  peakKw: number;
  avgKw: number;
}

/**
 * The circuits, and the total current, a whole wall of `panelCount` panels needs.
 * This is the number to hand a production electrician, and it is the peak figure
 * whatever the on-screen basis, because that is what the distro has to survive.
 */
export function wallPower(panel: PowerFigures, panelCount: number, input: PowerLineInput): WallPower {
  const per = powerLine(panel, input);
  const circuits = per.panelsPerCircuit > 0 ? Math.ceil(panelCount / per.panelsPerCircuit) : 0;
  const peakW = panel.powerMaxW * panelCount;
  const avgW = panel.powerAvgW * panelCount;
  const legs = input.supply.phases;
  return {
    circuits,
    peakAmpsTotal: peakW / input.supply.volts / legs,
    avgAmpsTotal: avgW / input.supply.volts / legs,
    peakKw: peakW / 1000,
    avgKw: avgW / 1000,
  };
}

// ---------------------------------------------------------------------------
// Choosing a supply and breaker
// ---------------------------------------------------------------------------

export function supplyById(id: string): SupplySpec | undefined {
  return SUPPLIES.find((s) => s.id === id);
}

/** A breaker the supply does not offer would silently give a wrong answer: use its first. */
export function breakerFor(supply: SupplySpec, amps: number): number {
  return supply.breakers.includes(amps) ? amps : supply.breakers[0];
}

export const DEFAULT_POWER_PLAN: PowerPlan = {
  supplyId: 'uk-230-1p',
  breakerAmps: 16,
  derated: true,
};

/**
 * A project's power plan as calculator input. Always PEAK: this is what the wall
 * designer sizes circuits with. Old project files have no plan and get the default; a
 * plan naming a supply or breaker that no longer exists falls back rather than throwing.
 */
export function resolvePowerPlan(plan: PowerPlan | undefined): PowerLineInput {
  const p = { ...DEFAULT_POWER_PLAN, ...plan };
  const supply = supplyById(p.supplyId) ?? SUPPLIES[0];
  return {
    supply,
    breakerAmps: breakerFor(supply, p.breakerAmps),
    derate: p.derated ? CONTINUOUS_LOAD_DERATE : 1,
    basis: 'peak',
  };
}

// ---------------------------------------------------------------------------
// A designed wall: circuits per cabinet model
// ---------------------------------------------------------------------------

export interface CircuitRow<S extends PowerFigures> {
  spec: S;
  count: number;
  /** Zero means one cabinet of this model already exceeds the circuit. */
  panelsPerCircuit: number;
  circuits: number;
}

export interface WallCircuits<S extends PowerFigures> {
  input: PowerLineInput;
  rows: CircuitRow<S>[];
  /**
   * Circuits for the whole wall. Each model is counted on runs of its own, so this is
   * the sum of each model's rounded-up count — on a mixed wall it can be one or two
   * more than pooling every cabinet would give, which is the conservative direction.
   */
  circuits: number;
  /** Those circuits as supplies: circuits / 3 rounded up on three phase, else equal. */
  supplies: number;
  /** Whole-wall peak current per leg, spread evenly across the phases. */
  peakAmpsPerLeg: number;
  peakKw: number;
  /** Models a single cabinet of which already exceeds the circuit — nothing fits. */
  unpowerable: CircuitRow<S>[];
}

/** Per-circuit counts for every model on a designed wall (`WallStats.byModel`). */
export function wallCircuits<S extends PowerFigures>(
  byModel: { spec: S; count: number }[],
  input: PowerLineInput,
): WallCircuits<S> {
  const rows = byModel.map(({ spec, count }) => {
    const per = powerLine(spec, input).panelsPerCircuit;
    return { spec, count, panelsPerCircuit: per, circuits: per > 0 ? Math.ceil(count / per) : 0 };
  });
  const circuits = rows.reduce((n, r) => n + r.circuits, 0);
  const peakW = byModel.reduce((n, r) => n + r.spec.powerMaxW * r.count, 0);
  return {
    input,
    rows,
    circuits,
    supplies: Math.ceil(circuits / input.supply.phases),
    peakAmpsPerLeg: peakW / input.supply.volts / input.supply.phases,
    peakKw: peakW / 1000,
    unpowerable: rows.filter((r) => r.panelsPerCircuit === 0),
  };
}
