/**
 * Left sidebar — the cabinet library, block-build tools, and the custom panel builder.
 */

import { useMemo, useState } from 'react';
import { useCabinetSpecs, useReceiverSpecs, useStore } from '../state/store';
import { cabinetPixels, type CabinetSpec } from '../domain/types';
import { fitToCanvas } from '../domain/wall';
import { nextId } from '../state/store';

export function LibraryPanel() {
  const specs = useCabinetSpecs();
  const activeSpecId = useStore((s) => s.activeSpecId);
  const setActiveSpec = useStore((s) => s.setActiveSpec);
  const addGrid = useStore((s) => s.addGrid);
  const fillCanvas = useStore((s) => s.fillCanvas);
  const project = useStore((s) => s.project);
  const setCanvas = useStore((s) => s.setCanvas);

  const [query, setQuery] = useState('');
  const [cols, setCols] = useState(8);
  const [rows, setRows] = useState(5);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return specs;
    return specs.filter((s) =>
      `${s.manufacturer} ${s.series} ${s.model} ${s.pixelPitchMm}`.toLowerCase().includes(q),
    );
  }, [specs, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, CabinetSpec[]>();
    for (const s of filtered) {
      if (!m.has(s.manufacturer)) m.set(s.manufacturer, []);
      m.get(s.manufacturer)!.push(s);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const active = specs.find((s) => s.id === activeSpecId);
  const fit = active
    ? fitToCanvas(active, project.canvas.widthMm, project.canvas.heightMm)
    : null;

  return (
    <div className="side">
      <div className="section">
        <h2>Canvas</h2>
        <div className="grid2">
          <div className="field">
            <label>W mm</label>
            <input
              type="number"
              value={project.canvas.widthMm}
              onChange={(e) => setCanvas({ widthMm: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>H mm</label>
            <input
              type="number"
              value={project.canvas.heightMm}
              onChange={(e) => setCanvas({ heightMm: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Snap mm</label>
            <input
              type="number"
              value={project.canvas.snapMm}
              onChange={(e) => setCanvas({ snapMm: Number(e.target.value) })}
            />
          </div>
        </div>
        {fit && (
          <div className="note">
            {active!.model} fits {fit.cols} × {fit.rows} in this canvas
            {fit.remainderXMm > 0.5 || fit.remainderYMm > 0.5
              ? ` — ${Math.round(fit.remainderXMm)} × ${Math.round(fit.remainderYMm)} mm left over.`
              : ' exactly.'}
          </div>
        )}
      </div>

      <div className="section">
        <h2>
          Cabinet library <span className="count">{filtered.length}</span>
        </h2>
        <input
          className="lib-filter"
          placeholder="Filter by maker, model or pitch…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {grouped.map(([maker, list]) => (
          <div key={maker} style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--muted)',
                margin: '6px 0 3px',
              }}
            >
              {maker}
            </div>
            {list.map((s) => (
              <button
                key={s.id}
                className={`lib-item ${s.id === activeSpecId ? 'active' : ''}`}
                onClick={() => setActiveSpec(s.id)}
              >
                <div className="model">
                  {s.model}{' '}
                  {!s.verified && <span className="badge unverified">unverified</span>}
                </div>
                <div className="figs">
                  {s.pixelPitchMm} mm · {s.pixelsX}×{s.pixelsY} px ·{' '}
                  {cabinetPixels(s).toLocaleString()} px
                </div>
                <div className="figs">
                  {s.widthMm}×{s.heightMm} mm · {s.weightKg} kg · {s.powerMaxW} W peak
                </div>
              </button>
            ))}
          </div>
        ))}
        {!filtered.length && <div className="empty">Nothing matches that filter.</div>}
      </div>

      <div className="section">
        <h2>Build a block</h2>
        <div className="grid3">
          <div className="field">
            <label>Cols</label>
            <input type="number" min={1} value={cols} onChange={(e) => setCols(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Rows</label>
            <input type="number" min={1} value={rows} onChange={(e) => setRows(Number(e.target.value))} />
          </div>
          <button
            className="primary"
            disabled={!activeSpecId}
            onClick={() => activeSpecId && addGrid(activeSpecId, cols, rows)}
          >
            Add
          </button>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            style={{ flex: 1 }}
            disabled={!activeSpecId}
            onClick={() => activeSpecId && fillCanvas(activeSpecId)}
            title="Replace the wall with as many whole cabinets as fit the canvas"
          >
            Fill canvas with {active?.model ?? '…'}
          </button>
        </div>
        {active && (
          <div className="note">
            {cols * rows} cabinets ={' '}
            {(cabinetPixels(active) * cols * rows).toLocaleString()} px,{' '}
            {(active.weightKg * cols * rows).toFixed(0)} kg,{' '}
            {((active.powerMaxW * cols * rows) / 1000).toFixed(1)} kW peak.
          </div>
        )}
      </div>

      <CustomPanelBuilder />
    </div>
  );
}

/**
 * Custom panel builder.
 *
 * Deliberately asks for resolution and receiving card rather than trying to infer
 * them: the whole reason someone builds a custom panel is that it is not in the
 * library, so guessing its internals would defeat the point. Anything created here
 * is stored in the project, not the shared library, and is always marked unverified.
 */
function CustomPanelBuilder() {
  const addCustomCabinet = useStore((s) => s.addCustomCabinet);
  const setActiveSpec = useStore((s) => s.setActiveSpec);
  const receivers = useReceiverSpecs();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    model: 'Custom panel',
    pixelPitchMm: 2.6,
    pixelsX: 192,
    pixelsY: 192,
    widthMm: 500,
    heightMm: 500,
    depthMm: 80,
    weightKg: 9,
    powerMaxW: 150,
    powerAvgW: 50,
    receivingCardId: '',
  });

  const set = (k: keyof typeof form, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  /** Derive the pitch implied by the entered size and resolution — a good sanity check. */
  const impliedPitch = form.pixelsX > 0 ? form.widthMm / form.pixelsX : 0;
  const pitchMismatch = Math.abs(impliedPitch - form.pixelPitchMm) > 0.15;

  function create() {
    const spec: CabinetSpec = {
      id: nextId('custom'),
      manufacturer: 'Custom',
      series: 'Custom',
      model: form.model || 'Custom panel',
      pixelPitchMm: form.pixelPitchMm,
      widthMm: form.widthMm,
      heightMm: form.heightMm,
      depthMm: form.depthMm,
      pixelsX: form.pixelsX,
      pixelsY: form.pixelsY,
      weightKg: form.weightKg,
      powerMaxW: form.powerMaxW,
      powerAvgW: form.powerAvgW,
      receivingCardId: form.receivingCardId || undefined,
      verified: false,
      source: 'Created in this project by the user.',
    };
    addCustomCabinet(spec);
    setActiveSpec(spec.id);
    setOpen(false);
  }

  return (
    <div className="section">
      <h2>Custom panel</h2>
      {!open ? (
        <button style={{ width: '100%' }} onClick={() => setOpen(true)}>
          Create a custom panel…
        </button>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 6 }}>
            <input value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="Model name" />
          </div>
          <div className="grid2">
            <div className="field">
              <label>px X</label>
              <input type="number" value={form.pixelsX} onChange={(e) => set('pixelsX', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>px Y</label>
              <input type="number" value={form.pixelsY} onChange={(e) => set('pixelsY', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>W mm</label>
              <input type="number" value={form.widthMm} onChange={(e) => set('widthMm', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>H mm</label>
              <input type="number" value={form.heightMm} onChange={(e) => set('heightMm', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Pitch</label>
              <input type="number" step="0.01" value={form.pixelPitchMm} onChange={(e) => set('pixelPitchMm', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>kg</label>
              <input type="number" step="0.1" value={form.weightKg} onChange={(e) => set('weightKg', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>W max</label>
              <input type="number" value={form.powerMaxW} onChange={(e) => set('powerMaxW', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>W avg</label>
              <input type="number" value={form.powerAvgW} onChange={(e) => set('powerAvgW', Number(e.target.value))} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 6 }}>
            <label>Card</label>
            <select
              value={form.receivingCardId}
              onChange={(e) => set('receivingCardId', e.target.value)}
            >
              <option value="">None specified</option>
              {receivers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.manufacturer} {r.model} ({r.maxPixels.toLocaleString()} px)
                </option>
              ))}
            </select>
          </div>
          {pitchMismatch && (
            <div className="note warn">
              {form.widthMm} mm across {form.pixelsX} px implies a{' '}
              {impliedPitch.toFixed(2)} mm pitch, not {form.pixelPitchMm} mm. Check the
              figures — one of them is wrong.
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" style={{ flex: 1 }} onClick={create}>
              Create
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
