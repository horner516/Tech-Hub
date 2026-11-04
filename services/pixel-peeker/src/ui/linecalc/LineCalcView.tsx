/**
 * Pixel Peeker — the Line calc view.
 *
 * One question, asked twice about the same panel: how many fit on a line? The data
 * answer and the power answer come from unrelated physics and almost never agree, so
 * the view shows both side by side and then says which one actually binds — because the
 * run you can build is the smaller of the two, and which one it is changes with the
 * panel, the processor, the bit depth and the country you are in.
 *
 * This was Line Calc, a separate tool, until 2026-10-11. It now runs on this app's own
 * library and capacity model (`domain/data-line.ts` is a wrapper, not a copy), and it
 * answers the rental-desk question without opening the designer.
 *
 * LAYOUT TRAP: the designer is a fixed-height canvas app (`.app` is exactly 100vh), and
 * this view is a scrolling document. It scrolls inside its own container
 * (`.lc-scroll`), so neither the page height nor the support footer below `.app` moves
 * when you switch views.
 */

import { useMemo } from 'react';
import { dataLine, wallData } from '../../domain/data-line';
import { lineVerdict } from '../../domain/line-verdict';
import {
  breakerFor,
  powerLine,
  wallPower,
  SUPPLIES,
  CONTINUOUS_LOAD_DERATE,
  type PowerBasis,
} from '../../domain/power-line';
import { publishedChainFor, publishedChainMargin } from '../../domain/published-chains';
import type { BitDepth } from '../../domain/types';
import { useCabinetSpecs, useProcessorSpecs, useReceiverSpecs } from '../../state/store';
import { CUSTOM_CABINET_ID, useLineCalc } from '../../state/lineCalc';
import { FRAME_RATES } from '../signal-options';
import { PanelPicker } from './PanelPicker';
import { DataLineCard } from './DataLineCard';
import { PowerLineCard } from './PowerLineCard';
import { Verdict } from './Verdict';
import { WallSummary } from './WallSummary';
import { Field, Num } from './controls';

const DEPTHS: BitDepth[] = [8, 10, 12];

export function LineCalcView() {
  const s = useLineCalc();
  const allCabinets = useCabinetSpecs();
  // A cabinet authored in the project can have no pixels or no power figure, and neither
  // has a line to calculate — the domain functions refuse them rather than divide by zero.
  const cabinets = useMemo(
    () => allCabinets.filter((c) => c.pixelsX * c.pixelsY > 0 && c.powerMaxW > 0 && c.powerAvgW > 0),
    [allCabinets],
  );
  const allProcessors = useProcessorSpecs();
  const processors = useMemo(() => allProcessors.filter((p) => p.ports.length > 0), [allProcessors]);
  const receivers = useReceiverSpecs();

  const cabinet =
    s.cabinetId === CUSTOM_CABINET_ID ? s.custom : (cabinets.find((c) => c.id === s.cabinetId) ?? s.custom);
  const proc = processors.find((p) => p.id === s.processorId) ?? processors[0];
  const supply = SUPPLIES.find((x) => x.id === s.supplyId) ?? SUPPLIES[0];
  const breaker = breakerFor(supply, s.breakerAmps);
  const receiver = cabinet.receivingCardId ? receivers.find((r) => r.id === cabinet.receivingCardId) : undefined;

  const powerInput = useMemo(
    () => ({ supply, breakerAmps: breaker, derate: s.derated ? CONTINUOUS_LOAD_DERATE : 1, basis: s.basis }),
    [supply, breaker, s.derated, s.basis],
  );

  const data = useMemo(
    () => dataLine(cabinet, proc, { bitDepth: s.bitDepth, frameRateHz: s.frameRateHz }, receiver),
    [cabinet, proc, s.bitDepth, s.frameRateHz, receiver],
  );
  const power = useMemo(() => powerLine(cabinet, powerInput), [cabinet, powerInput]);
  const wallP = useMemo(() => wallPower(cabinet, s.wallPanels, powerInput), [cabinet, s.wallPanels, powerInput]);
  const wallD = useMemo(() => wallData(cabinet, s.wallPanels, data), [cabinet, s.wallPanels, data]);
  const verdict = lineVerdict(cabinet, data.panelsPerPort, power.panelsPerCircuit);

  const published = publishedChainFor(cabinet.id);
  const margin = published ? publishedChainMargin(published, cabinet.powerMaxW, power.panelsPerCircuit) : null;

  return (
    <div className="lc-scroll">
      <div className="lc-main">
        <aside className="lc-col lc-col--input">
          <PanelPicker
            cabinets={cabinets}
            cabinetId={s.cabinetId}
            onPick={(cabinetId) => s.set({ cabinetId })}
            custom={s.custom}
            onCustomChange={(custom) => s.set({ custom })}
          />

          <section className="lc-box">
            <h2>Signal</h2>
            <Field label="Processor">
              <select value={proc.id} onChange={(e) => s.set({ processorId: e.currentTarget.value })}>
                {processors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.manufacturer} {p.model}
                  </option>
                ))}
              </select>
            </Field>
            <div className="lc-row2">
              <Field label="Bit depth">
                <select
                  value={s.bitDepth}
                  onChange={(e) => s.set({ bitDepth: Number(e.currentTarget.value) as BitDepth })}
                >
                  {DEPTHS.map((d) => (
                    <option key={d} value={d}>{d}-bit</option>
                  ))}
                </select>
              </Field>
              <Field label="Frame rate">
                <select
                  value={s.frameRateHz}
                  onChange={(e) => s.set({ frameRateHz: Number(e.currentTarget.value) })}
                >
                  {FRAME_RATES.map((f) => (
                    <option key={f} value={f}>{f} Hz</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="lc-hint">
              The panel's 3840 Hz or 7680 Hz refresh rate is not in this box on purpose — LED
              refresh costs the panel, not the link. Frame rate is the one that costs bandwidth.
            </p>
          </section>

          <section className="lc-box">
            <h2>Power</h2>
            <Field label="Supply">
              <select
                value={supply.id}
                onChange={(e) => {
                  const next = SUPPLIES.find((x) => x.id === e.currentTarget.value) ?? SUPPLIES[0];
                  s.set({ supplyId: next.id, breakerAmps: breakerFor(next, s.breakerAmps) });
                }}
              >
                {SUPPLIES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label} — {x.region}
                  </option>
                ))}
              </select>
            </Field>
            <div className="lc-row2">
              <Field label="Breaker">
                <select value={breaker} onChange={(e) => s.set({ breakerAmps: Number(e.currentTarget.value) })}>
                  {supply.breakers.map((b) => (
                    <option key={b} value={b}>{b} A</option>
                  ))}
                </select>
              </Field>
              <Field label="Power figure">
                <select value={s.basis} onChange={(e) => s.set({ basis: e.currentTarget.value as PowerBasis })}>
                  <option value="peak">Peak (all white)</option>
                  <option value="average">Average (programme)</option>
                </select>
              </Field>
            </div>
            <label className="lc-check">
              <input type="checkbox" checked={s.derated} onChange={(e) => s.set({ derated: e.currentTarget.checked })} />
              <span>
                Derate to 80% for a continuous load
                <em>NEC 210.20(A). Off = the full breaker rating, which is a trip point, not a budget.</em>
              </span>
            </label>
            {s.basis === 'average' && (
              <p className="lc-hint lc-hint--warn">
                Average power is for estimating what the venue will be asked for. Size a distro on
                it and the wall trips the first time someone puts up a white holding slide.
              </p>
            )}
          </section>

          <section className="lc-box">
            <h2>Whole wall</h2>
            <Field label="Panels in the wall">
              <Num value={s.wallPanels} min={1} max={5000} onChange={(wallPanels) => s.set({ wallPanels })} />
            </Field>
          </section>
        </aside>

        <div className="lc-col">
          <Verdict
            verdict={verdict}
            dataPanels={data.panelsPerPort}
            powerPanels={power.panelsPerCircuit}
            proc={proc}
            supply={supply}
            breaker={breaker}
          />

          <div className="lc-cards">
            <DataLineCard
              cabinet={cabinet}
              proc={proc}
              result={data}
              bitDepth={s.bitDepth}
              frameRateHz={s.frameRateHz}
            />
            <PowerLineCard
              cabinet={cabinet}
              result={power}
              supply={supply}
              breaker={breaker}
              derated={s.derated}
              basis={s.basis}
              published={published}
              margin={margin}
            />
          </div>

          <WallSummary
            panelCount={s.wallPanels}
            data={data}
            power={power}
            wallD={wallD}
            wallP={wallP}
            proc={proc}
            supply={supply}
          />

          <p className="lc-foot">
            All figures are calculated, not measured. The data half uses the same capacity model
            as the designer; the power half is steady-state arithmetic with one published table to
            check it against.
          </p>
        </div>
      </div>
    </div>
  );
}
