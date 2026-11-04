import { useMemo, useState } from 'react';
import type { CabinetSpec } from '../../domain/types';
import { CUSTOM_CABINET_ID } from '../../state/lineCalc';
import { Field, Num } from './controls';
import { mm } from './format';

/**
 * Pick a cabinet from the library, or describe one by hand.
 *
 * The same library the designer uses, cabinets authored in the open project included.
 * `verified: false` means the record is good enough to plan a wall with and not good
 * enough to quote a job from, and the badge says so rather than the view quietly
 * treating both kinds the same.
 */
export function PanelPicker({
  cabinets,
  cabinetId,
  onPick,
  custom,
  onCustomChange,
}: {
  cabinets: CabinetSpec[];
  cabinetId: string;
  onPick: (id: string) => void;
  custom: CabinetSpec;
  onCustomChange: (c: CabinetSpec) => void;
}) {
  const [maker, setMaker] = useState('all');
  const [query, setQuery] = useState('');

  const makers = useMemo(() => [...new Set(cabinets.map((c) => c.manufacturer))].sort(), [cabinets]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cabinets
      .filter((c) => maker === 'all' || c.manufacturer === maker)
      .filter((c) => !q || `${c.manufacturer} ${c.series} ${c.model}`.toLowerCase().includes(q))
      .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model));
  }, [cabinets, maker, query]);

  const isCustom = cabinetId === CUSTOM_CABINET_ID;
  const selected = isCustom ? custom : cabinets.find((c) => c.id === cabinetId);

  const set = (k: keyof CabinetSpec, v: number) => onCustomChange({ ...custom, [k]: v });

  return (
    <section className="lc-box">
      <h2>Panel</h2>

      <div className="lc-row2">
        <Field label="Manufacturer">
          <select value={maker} onChange={(e) => setMaker(e.currentTarget.value)}>
            <option value="all">All ({cabinets.length})</option>
            {makers.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input
            type="search"
            value={query}
            placeholder="PL2.5, Carbon, CB5…"
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </Field>
      </div>

      <Field label={`Model — ${shown.length} match${shown.length === 1 ? '' : 'es'}`}>
        <select value={cabinetId} onChange={(e) => onPick(e.currentTarget.value)}>
          <option value={CUSTOM_CABINET_ID}>Custom panel…</option>
          {shown.map((c) => (
            <option key={c.id} value={c.id}>
              {c.manufacturer} {c.model} — {c.pixelsX}×{c.pixelsY}, {c.powerMaxW} W
            </option>
          ))}
        </select>
      </Field>

      {isCustom ? (
        <div>
          <div className="lc-row2">
            <Field label="Width"><Num value={custom.widthMm} min={10} max={5000} onChange={(n) => set('widthMm', n)} suffix="mm" /></Field>
            <Field label="Height"><Num value={custom.heightMm} min={10} max={5000} onChange={(n) => set('heightMm', n)} suffix="mm" /></Field>
          </div>
          <div className="lc-row2">
            <Field label="Pixels across"><Num value={custom.pixelsX} min={1} max={4096} onChange={(n) => set('pixelsX', n)} suffix="px" /></Field>
            <Field label="Pixels down"><Num value={custom.pixelsY} min={1} max={4096} onChange={(n) => set('pixelsY', n)} suffix="px" /></Field>
          </div>
          <div className="lc-row2">
            <Field label="Peak power"><Num value={custom.powerMaxW} min={1} max={5000} onChange={(n) => set('powerMaxW', n)} suffix="W" /></Field>
            <Field label="Average power"><Num value={custom.powerAvgW} min={1} max={5000} onChange={(n) => set('powerAvgW', n)} suffix="W" /></Field>
          </div>
          <Field label="Weight"><Num value={custom.weightKg} min={0} max={500} step={0.1} onChange={(n) => set('weightKg', n)} suffix="kg" /></Field>
          <p className="lc-hint">
            Peak is the all-white, full-brightness figure — the one a distro has to survive.
            A datasheet that quotes W/m² rather than W/panel needs multiplying by the panel
            area first: {mm(custom.widthMm)} × {mm(custom.heightMm)} is{' '}
            {((custom.widthMm / 1000) * (custom.heightMm / 1000)).toFixed(3)} m².
          </p>
        </div>
      ) : selected ? (
        <div>
          <dl className="lc-spec">
            <div><dt>Size</dt><dd>{mm(selected.widthMm)} × {mm(selected.heightMm)}</dd></div>
            <div><dt>Resolution</dt><dd>{selected.pixelsX} × {selected.pixelsY} px</dd></div>
            <div><dt>Pitch</dt><dd>{selected.pixelPitchMm} mm</dd></div>
            <div><dt>Peak / average</dt><dd>{selected.powerMaxW} W / {selected.powerAvgW} W</dd></div>
            <div><dt>Weight</dt><dd>{selected.weightKg} kg</dd></div>
          </dl>
          <p className={`lc-prov ${selected.verified ? '' : 'lc-prov--soft'}`}>
            <span className={`badge ${selected.verified ? 'verified' : 'unverified'}`}>
              {selected.verified ? 'datasheet' : 'unverified'}
            </span>{' '}
            {selected.verified ? '' : 'Plan with it, do not quote from it. '}
            <span>{selected.source}</span>
          </p>
        </div>
      ) : null}

      <p className="lc-hint lc-hint--faint">
        Check the maker's current sheet before anything leaves the building.
      </p>
    </section>
  );
}
