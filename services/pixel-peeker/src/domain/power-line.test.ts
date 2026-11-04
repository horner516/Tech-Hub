import { describe, it, expect } from 'vitest';
import {
  powerLine,
  wallPower,
  wallCircuits,
  resolvePowerPlan,
  breakerFor,
  SUPPLIES,
  CONTINUOUS_LOAD_DERATE,
  DEFAULT_POWER_PLAN,
} from './power-line';
import type { SupplySpec } from './power-line';
import {
  PUBLISHED_CHAINS,
  PUBLISHED_CHAIN_LIMIT_A,
  publishedChainFor,
  publishedChainMargin,
  impliedAmps,
} from './published-chains';
import { CABINET_LIBRARY, cabinetById } from '../data/cabinets';

const supply = (id: string): SupplySpec => {
  const s = SUPPLIES.find((x) => x.id === id);
  if (!s) throw new Error(`no supply ${id}`);
  return s;
};

const uk = supply('uk-230-1p');
const us = supply('us-120-1p');

describe('the arithmetic', () => {
  const panel = { powerMaxW: 200, powerAvgW: 70 };

  it('is amps = watts / volts, and rounds panels DOWN', () => {
    const r = powerLine(panel, { supply: uk, breakerAmps: 16, derate: 1, basis: 'peak' });
    expect(r.ampsPerPanel).toBeCloseTo(200 / 230, 6);
    /* 16 A / 0.8696 A = 18.4 -> 18 panels. The 19th would exceed the breaker. */
    expect(r.panelsPerCircuit).toBe(18);
    expect(r.drawAmps).toBeLessThanOrEqual(16);
  });

  it('applies the 80% continuous-load rule when asked', () => {
    const full = powerLine(panel, { supply: uk, breakerAmps: 16, derate: 1, basis: 'peak' });
    const derated = powerLine(panel, { supply: uk, breakerAmps: 16, derate: CONTINUOUS_LOAD_DERATE, basis: 'peak' });
    expect(derated.usableAmps).toBeCloseTo(12.8, 6);
    expect(derated.panelsPerCircuit).toBe(14);
    expect(derated.panelsPerCircuit).toBeLessThan(full.panelsPerCircuit);
  });

  it('gets roughly half as many panels at 120 V as at 230 V', () => {
    const at230 = powerLine(panel, { supply: uk, breakerAmps: 16, derate: 1, basis: 'peak' });
    const at120 = powerLine(panel, { supply: us, breakerAmps: 16, derate: 1, basis: 'peak' });
    expect(at120.panelsPerCircuit / at230.panelsPerCircuit).toBeCloseTo(120 / 230, 1);
  });

  it('fits more panels on average power than on peak, which is exactly the trap', () => {
    const peak = powerLine(panel, { supply: uk, breakerAmps: 16, derate: 1, basis: 'peak' });
    const avg = powerLine(panel, { supply: uk, breakerAmps: 16, derate: 1, basis: 'average' });
    expect(avg.panelsPerCircuit).toBeGreaterThan(peak.panelsPerCircuit);
    /* ...and a wall built to the average figure is over the breaker on a white frame. */
    expect((avg.panelsPerCircuit * panel.powerMaxW) / 230).toBeGreaterThan(16);
  });

  it('never returns a draw over the derated limit, for any cabinet or breaker', () => {
    for (const p of CABINET_LIBRARY) {
      for (const s of SUPPLIES) {
        for (const b of s.breakers) {
          const r = powerLine(p, { supply: s, breakerAmps: b, derate: CONTINUOUS_LOAD_DERATE, basis: 'peak' });
          expect(r.drawAmps, `${p.id} @ ${s.id}/${b}A`).toBeLessThanOrEqual(r.usableAmps + 1e-9);
          expect(Number.isInteger(r.panelsPerCircuit)).toBe(true);
        }
      }
    }
  });

  it('counts three-phase as three single-phase legs, not line-to-line', () => {
    const threePhase = supply('uk-400-3p');
    const single = powerLine(panel, { supply: uk, breakerAmps: 32, derate: 1, basis: 'peak' });
    const three = powerLine(panel, { supply: threePhase, breakerAmps: 32, derate: 1, basis: 'peak' });
    expect(three.panelsPerCircuit).toBe(single.panelsPerCircuit);
    expect(three.panelsPerSupply).toBe(single.panelsPerCircuit * 3);
  });

  it('refuses a panel that draws nothing rather than claiming infinitely many fit', () => {
    expect(() => powerLine({ powerMaxW: 0, powerAvgW: 0 }, { supply: uk, breakerAmps: 16, derate: 1, basis: 'peak' })).toThrow();
  });
});

describe('a whole wall', () => {
  it('needs the circuits to cover every panel, rounded up', () => {
    const panel = { powerMaxW: 200, powerAvgW: 70 };
    const input = { supply: uk, breakerAmps: 16, derate: CONTINUOUS_LOAD_DERATE, basis: 'peak' as const };
    const per = powerLine(panel, input);
    const w = wallPower(panel, 100, input);
    expect(w.circuits).toBe(Math.ceil(100 / per.panelsPerCircuit));
    expect(w.circuits * per.panelsPerCircuit).toBeGreaterThanOrEqual(100);
    expect(w.peakKw).toBeCloseTo(20, 6);
  });
});

describe('a designed wall, circuit by circuit', () => {
  const a = { id: 'a', powerMaxW: 200, powerAvgW: 70 };
  const b = { id: 'b', powerMaxW: 150, powerAvgW: 50 };

  it('counts each model on runs of its own, so a mixed wall is never under-counted', () => {
    const input = resolvePowerPlan(DEFAULT_POWER_PLAN);
    const c = wallCircuits([{ spec: a, count: 100 }, { spec: b, count: 10 }], input);
    const perA = powerLine(a, input).panelsPerCircuit;
    const perB = powerLine(b, input).panelsPerCircuit;
    expect(c.rows.map((r) => r.circuits)).toEqual([Math.ceil(100 / perA), Math.ceil(10 / perB)]);
    expect(c.circuits).toBe(Math.ceil(100 / perA) + Math.ceil(10 / perB));
    expect(c.supplies).toBe(c.circuits);
    expect(c.peakKw).toBeCloseTo((100 * 200 + 10 * 150) / 1000, 6);
    expect(c.unpowerable).toHaveLength(0);
  });

  it('groups three-phase legs into supplies, and spreads the current across them', () => {
    const input = resolvePowerPlan({ supplyId: 'uk-400-3p', breakerAmps: 32, derated: true });
    const c = wallCircuits([{ spec: a, count: 100 }], input);
    expect(c.supplies).toBe(Math.ceil(c.circuits / 3));
    expect(c.peakAmpsPerLeg).toBeCloseTo((100 * 200) / 230 / 3, 6);
  });

  it('flags a model that one cabinet already overloads, instead of dividing by zero', () => {
    const input = resolvePowerPlan({ supplyId: 'us-120-1p', breakerAmps: 15, derated: true });
    const hog = { id: 'hog', powerMaxW: 2000, powerAvgW: 900 };
    const c = wallCircuits([{ spec: hog, count: 4 }], input);
    expect(c.rows[0].panelsPerCircuit).toBe(0);
    expect(c.unpowerable.map((r) => r.spec.id)).toEqual(['hog']);
    expect(c.circuits).toBe(0);
  });

  it('reads an old project with no plan as 16 A at 230 V, derated, on peak', () => {
    const input = resolvePowerPlan(undefined);
    expect(input.supply.id).toBe('uk-230-1p');
    expect(input.breakerAmps).toBe(16);
    expect(input.derate).toBe(CONTINUOUS_LOAD_DERATE);
    expect(input.basis).toBe('peak');
  });

  it('falls back to a breaker the supply offers rather than costing an impossible one', () => {
    expect(breakerFor(us, 16)).toBe(us.breakers[0]);
    expect(breakerFor(us, 20)).toBe(20);
    expect(resolvePowerPlan({ supplyId: 'us-120-1p', breakerAmps: 16, derated: false }).breakerAmps).toBe(15);
    expect(resolvePowerPlan({ supplyId: 'no-such-supply', breakerAmps: 16, derated: true }).supply.id).toBe('uk-230-1p');
  });
});

/*
 * THE PUBLISHED TABLE. Absen's figures are the only manufacturer statement of this
 * kind the app carries, so what they actually encode is asserted rather than assumed.
 */
describe("Absen's published cabinets-per-power-cable table", () => {
  it('is the 220 V column halved and rounded up — so it is a CURRENT limit', () => {
    for (const c of PUBLISHED_CHAINS) {
      expect(c.at110V, `${c.publishedAs} ${c.cabinetMm}`).toBe(Math.ceil(c.at220V / 2));
    }
  });

  it('halves EXACTLY in 15 of 18 rows; the three that round up are the odd 7-panel rows', () => {
    const exact = PUBLISHED_CHAINS.filter((c) => c.at110V * 2 === c.at220V);
    const roundedUp = PUBLISHED_CHAINS.filter((c) => c.at110V * 2 !== c.at220V);
    expect(exact).toHaveLength(15);
    expect(roundedUp).toHaveLength(3);
    /* Rounding up is the LESS conservative direction: those rows allow about 14% more
       current at 110 V than the same row's 220 V figure does. */
    for (const c of roundedUp) {
      expect(c.at220V % 2).toBe(1);
      expect((c.at110V * 2) / c.at220V).toBeCloseTo(8 / 7, 3);
    }
  });

  it('sits inside a 16 A limit on peak power in every row that names a cabinet we hold', () => {
    const checked: number[] = [];
    for (const c of PUBLISHED_CHAINS) {
      for (const id of c.panelIds) {
        const panel = cabinetById(id);
        expect(panel, `published chain names unknown cabinet ${id}`).toBeDefined();
        const amps = impliedAmps(c, panel!.powerMaxW);
        expect(amps, `${c.publishedAs} implies ${amps.toFixed(1)} A`).toBeLessThanOrEqual(PUBLISHED_CHAIN_LIMIT_A);
        checked.push(amps);
      }
    }
    /* Not a vacuous pass: the table must actually cover a useful number of cabinets. */
    expect(checked.length).toBeGreaterThanOrEqual(12);
    /* And it is a CONSERVATIVE recommendation, not a computed maximum — every row
       leaves headroom, and the spread between rows is wide enough to prove Absen
       quantised rather than calculated. */
    expect(Math.min(...checked)).toBeLessThan(11);
    expect(Math.max(...checked)).toBeGreaterThan(14);
  });

  it('is always at or below what a 16 A breaker would allow outright', () => {
    const at220: SupplySpec = { id: 't', label: '220 V', volts: 220, phases: 1, breakers: [16], region: 'test' };
    for (const c of PUBLISHED_CHAINS) {
      for (const id of c.panelIds) {
        const panel = cabinetById(id)!;
        const computed = powerLine(panel, { supply: at220, breakerAmps: 16, derate: 1, basis: 'peak' });
        expect(c.at220V, `${c.publishedAs}`).toBeLessThanOrEqual(computed.panelsPerCircuit);
        const margin = publishedChainMargin(c, panel.powerMaxW, computed.panelsPerCircuit);
        expect(margin.spareAmps).toBeGreaterThanOrEqual(0);
        expect(margin.panelsOverPublished).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('resolves a cabinet id to its row', () => {
    const c = publishedChainFor('absen-pl29-plus-v2');
    expect(c?.at220V).toBe(24);
    expect(publishedChainFor('roe-cb5')).toBeUndefined();
  });
});
