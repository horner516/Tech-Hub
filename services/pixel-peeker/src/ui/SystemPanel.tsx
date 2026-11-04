/**
 * Right sidebar — processors, wiring, port loading, power circuits, design checks and
 * exports.
 */

import { useMemo, useState } from 'react';
import { useProcessorSpecs, useStore } from '../state/store';
import { chainColour, DEFAULT_AUTOWIRE, type WirePattern } from '../domain/wiring';
import { buildPixelMap } from '../domain/pixelmap';
import { buildResolumeXml, buildSliceCsv } from '../export/resolume';
import { driveCheck } from '../domain/capacity';
import { breakerFor, resolvePowerPlan, SUPPLIES, wallCircuits } from '../domain/power-line';
import { NOVASTAR_EXPORTS } from '../config/features';

export function SystemPanel() {
  return (
    <div className="side right">
      <ProcessorsSection />
      <WiringSection />
      <PortLoadingSection />
      <PowerSection />
      <ChecksSection />
      <ExportSection />
    </div>
  );
}

function ProcessorsSection() {
  const specs = useProcessorSpecs();
  const project = useStore((s) => s.project);
  const addProcessor = useStore((s) => s.addProcessor);
  const removeProcessor = useStore((s) => s.removeProcessor);
  const renameProcessor = useStore((s) => s.renameProcessor);
  const loads = useStore((s) => s.derived.loads);
  const [pick, setPick] = useState(specs[0]?.id ?? '');

  return (
    <div className="section">
      <h2>
        Processing <span className="count">{project.processors.length}</span>
      </h2>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {specs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.manufacturer} {s.model}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => addProcessor(pick)}>
          Add
        </button>
      </div>

      {loads.map((load) => (
        <div key={load.processor.id} style={{ marginTop: 10 }}>
          <div className="row">
            <input
              value={load.processor.name}
              onChange={(e) => renameProcessor(load.processor.id, e.target.value)}
            />
            <button className="danger" onClick={() => removeProcessor(load.processor.id)}>
              ✕
            </button>
          </div>
          <div className="figs" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {load.usedPx.toLocaleString()} / {load.capacityPx.toLocaleString()} px ·{' '}
            {load.ports.filter((p) => p.usedPx > 0).length}/{load.ports.length} ports used
          </div>
          <div
            className={`meter ${load.utilisation > 1 ? 'over' : load.utilisation > 0.9 ? 'tight' : ''}`}
          >
            <div style={{ width: `${Math.min(100, load.utilisation * 100)}%` }} />
          </div>
        </div>
      ))}

      {!project.processors.length && (
        <div className="empty">
          No processors yet. Add one, then use auto-wire to patch the wall.
        </div>
      )}
    </div>
  );
}

function WiringSection() {
  const runAutoWire = useStore((s) => s.runAutoWire);
  const clearWiring = useStore((s) => s.clearWiring);
  const hasProcessors = useStore((s) => s.project.processors.length > 0);
  const [pattern, setPattern] = useState<WirePattern>(DEFAULT_AUTOWIRE.pattern);
  const [fillTo, setFillTo] = useState(DEFAULT_AUTOWIRE.fillTo);
  const [notes, setNotes] = useState<string[]>([]);

  return (
    <div className="section">
      <h2>Wiring</h2>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Pattern</label>
          <select value={pattern} onChange={(e) => setPattern(e.target.value as WirePattern)}>
            <option value="serpentine-v">Serpentine ↓↑</option>
            <option value="serpentine-h">Serpentine →←</option>
            <option value="column">Columns ↓↓</option>
            <option value="row">Rows →→</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Fill to (%)</label>
        <input
          type="number"
          min={10}
          max={100}
          value={Math.round(fillTo * 100)}
          onChange={(e) => setFillTo(Number(e.target.value) / 100)}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          style={{ flex: 1 }}
          disabled={!hasProcessors}
          onClick={() =>
            setNotes(runAutoWire({ pattern, fillTo, skipPatched: false }))
          }
        >
          Auto-wire
        </button>
        <button onClick={() => { clearWiring(); setNotes([]); }}>Clear</button>
      </div>
      <div className="note">
        Ports are filled in order to {Math.round(fillTo * 100)}% of capacity, leaving{' '}
        {100 - Math.round(fillTo * 100)}% headroom for a frame-rate or bit-depth change.
      </div>
      {notes.map((n, i) => (
        <div key={i} className="note warn">
          {n}
        </div>
      ))}
    </div>
  );
}

function PortLoadingSection() {
  const loads = useStore((s) => s.derived.loads);
  const chains = useStore((s) => s.project.chains);

  const colourOf = new Map<string, string>();
  chains.forEach((c, i) => colourOf.set(c.id, c.colour ?? chainColour(i)));

  const used = loads.flatMap((l) => l.ports.filter((p) => p.usedPx > 0));
  if (!used.length) return null;

  return (
    <div className="section">
      <h2>
        Port loading <span className="count">{used.length}</span>
      </h2>
      <table className="ports">
        <thead>
          <tr>
            <th>Port</th>
            <th style={{ textAlign: 'right' }}>Cabs</th>
            <th style={{ textAlign: 'right' }}>Pixels</th>
            <th style={{ textAlign: 'right' }}>Used</th>
          </tr>
        </thead>
        <tbody>
          {loads.map((load) =>
            load.ports
              .filter((p) => p.usedPx > 0)
              .map((p) => {
                const pct = Math.round(p.utilisation * 100);
                return (
                  <tr
                    key={`${load.processor.id}-${p.port.id}`}
                    className={pct > 100 ? 'over' : pct > 90 ? 'tight' : ''}
                    title={`${p.usedPx.toLocaleString()} of ${p.capacityPx.toLocaleString()} px — max ${
                      Number.isFinite(p.maxFrameRateHz) ? p.maxFrameRateHz.toFixed(1) : '∞'
                    } Hz at this load`}
                  >
                    <td>
                      <span
                        className="swatch"
                        style={{ background: p.chain ? colourOf.get(p.chain.id) : 'transparent' }}
                      />
                      {p.port.label}
                    </td>
                    <td style={{ textAlign: 'right' }}>{p.cabinets.length}</td>
                    <td style={{ textAlign: 'right' }}>{p.usedPx.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{pct}%</td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Circuits per cabinet model, from `domain/power-line.ts` — the per-circuit model the
 * Line calc view brought with it. Always on peak power: this is what sizes a distro.
 */
function PowerSection() {
  const plan = useStore((s) => s.project.power);
  const byModel = useStore((s) => s.derived.stats.byModel);
  const setPower = useStore((s) => s.setPower);
  const c = useMemo(() => wallCircuits(byModel, resolvePowerPlan(plan)), [byModel, plan]);
  const { supply, breakerAmps, derate } = c.input;

  return (
    <div className="section">
      <h2>
        Power{' '}
        {c.circuits > 0 && (
          <span className="count">
            {c.circuits} circuit{c.circuits === 1 ? '' : 's'}
          </span>
        )}
      </h2>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>Supply</label>
          <select
            value={supply.id}
            onChange={(e) => {
              const next = SUPPLIES.find((x) => x.id === e.target.value) ?? SUPPLIES[0];
              setPower({ supplyId: next.id, breakerAmps: breakerFor(next, breakerAmps) });
            }}
          >
            {SUPPLIES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label} ({x.region})
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Breaker</label>
          <select value={breakerAmps} onChange={(e) => setPower({ breakerAmps: Number(e.target.value) })}>
            {supply.breakers.map((b) => (
              <option key={b} value={b}>
                {b} A
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={derate < 1}
          onChange={(e) => setPower({ derated: e.target.checked })}
        />
        Derate to 80% for a continuous load
      </label>

      {c.rows.length > 0 ? (
        <>
          <table className="circuits">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Cabs</th>
                <th className="num">Per circuit</th>
                <th className="num">Circuits</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.spec.id} className={r.panelsPerCircuit === 0 ? 'over' : ''}>
                  <td>{r.spec.model}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{r.panelsPerCircuit || '—'}</td>
                  <td className="num">{r.circuits || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            {c.peakKw.toFixed(1)} kW peak, {c.peakAmpsPerLeg.toFixed(1)} A
            {supply.phases === 3 ? ` per leg across three phases (${c.supplies} three-phase supplies)` : ` at ${supply.volts} V`}.
            Each model is counted on runs of its own.
          </div>
          {c.unpowerable.map((r) => (
            <div key={r.spec.id} className="note warn">
              One {r.spec.model} draws more than a {breakerAmps} A circuit on {supply.label} allows.
            </div>
          ))}
        </>
      ) : (
        <div className="empty">No cabinets yet.</div>
      )}
      <div className="note">
        Peak power, steady state. Inrush at switch-on is not modelled, and sizing a circuit is a
        job for whoever signs off the distro.
      </div>
    </div>
  );
}

function ChecksSection() {
  const issues = useStore((s) => s.derived.issues);
  const project = useStore((s) => s.project);
  const cabinetSpec = useStore((s) => s.cabinetSpec);
  const receiverSpec = useStore((s) => s.receiverSpec);
  const select = useStore((s) => s.select);

  // Refresh-rate feasibility, per distinct cabinet model in use.
  const refreshIssues = [...new Set(project.cabinets.map((c) => c.specId))]
    .map((id) => cabinetSpec(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((spec) => ({
      spec,
      check: driveCheck(
        spec,
        spec.receivingCardId ? receiverSpec(spec.receivingCardId) : undefined,
        project.signal,
      ),
    }))
    .filter((r) => !r.check.ok);

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="section">
      <h2>
        Design checks{' '}
        <span className="count">
          {errors ? `${errors} error${errors > 1 ? 's' : ''}` : ''}
          {errors && warnings ? ', ' : ''}
          {warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : ''}
          {!errors && !warnings ? 'clear' : ''}
        </span>
      </h2>

      {refreshIssues.map(({ spec, check }) => (
        <div key={spec.id} className="issue warning">
          <div className="dot" />
          <div>
            {spec.model} tops out at {check.achievableRefreshHz.toLocaleString()} Hz but
            the design calls for {project.signal.ledRefreshHz.toLocaleString()} Hz.{' '}
            {check.detail}
          </div>
        </div>
      ))}

      {issues.map((issue, i) => (
        <div
          key={i}
          className={`issue ${issue.severity}`}
          onClick={() => issue.refs?.length && select(issue.refs)}
          style={{ cursor: issue.refs?.length ? 'pointer' : 'default' }}
        >
          <div className="dot" />
          <div>{issue.message}</div>
        </div>
      ))}

      {!issues.length && !refreshIssues.length && (
        <div className="empty">Nothing to flag.</div>
      )}
    </div>
  );
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportSection() {
  const project = useStore((s) => s.project);
  const { stats, loads, issues } = useStore((s) => s.derived);
  const cabinetSpec = useStore((s) => s.cabinetSpec);
  const loadProject = useStore((s) => s.loadProject);

  const map = buildPixelMap(project, cabinetSpec, loads);
  const slug = project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'wall';
  const empty = !project.cabinets.length;
  const [building, setBuilding] = useState(false);

  // jsPDF pulls in html2canvas and DOMPurify, which nothing else here needs.
  // Loading it on demand keeps them out of the initial bundle.
  async function makePdf() {
    setBuilding(true);
    try {
      const { buildReport } = await import('../export/pdf');
      buildReport({ project, stats, map, loads, issues, cabinetSpec }).save(
        `${slug}-report.pdf`,
      );
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="section">
      <h2>Export</h2>

      <div className="row">
        <button
          className="primary"
          style={{ flex: 1 }}
          disabled={empty || building}
          onClick={makePdf}
        >
          {building ? 'Building…' : 'PDF report'}
        </button>
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button
          style={{ flex: 1 }}
          disabled={empty}
          onClick={() =>
            download(`${slug}-screensetup.xml`, buildResolumeXml(project, map), 'application/xml')
          }
        >
          Resolume XML
        </button>
        <button
          disabled={empty}
          onClick={() => download(`${slug}-slices.csv`, buildSliceCsv(map), 'text/csv')}
          title="Same slice geometry as the XML, as a table you can build by hand"
        >
          CSV
        </button>
      </div>
      <div className="note">
        Arena 7.27 preset format, one screen per processor and one slice per port.
        Drop it in <code>Presets/Advanced Output/</code>. Screens load as Virtual
        output devices — assign each to a physical output once open. The slice CSV
        is the same geometry as a plain table.
      </div>

      {NOVASTAR_EXPORTS && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              style={{ flex: 1 }}
              disabled={empty}
              onClick={async () => {
                const { buildCabinetScheduleCsv } = await import('../export/novastar');
                download(
                  `${slug}-cabinet-schedule.csv`,
                  buildCabinetScheduleCsv(map),
                  'text/csv',
                );
              }}
            >
              Cabinet schedule
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              style={{ flex: 1 }}
              disabled={empty}
              onClick={async () => {
                const { buildLctBrief } = await import('../export/novastar');
                download(
                  `${slug}-config-brief.txt`,
                  buildLctBrief(project, map, loads),
                  'text/plain',
                );
              }}
            >
              LCT / VMP brief
            </button>
            <button
              disabled={empty}
              onClick={async () => {
                const { buildInterchange } = await import('../export/novastar');
                download(
                  `${slug}-interchange.json`,
                  JSON.stringify(buildInterchange(project, map, loads), null, 2),
                  'application/json',
                );
              }}
            >
              JSON
            </button>
          </div>
          <div className="note">
            LCT <code>.scr</code> and VMP project files are proprietary, so Pixel Peeker
            does not fabricate them. These carry the same information in a form you can
            type in or script against.
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          style={{ flex: 1 }}
          onClick={() =>
            download(`${slug}.pixelpeeker.json`, JSON.stringify(project, null, 2), 'application/json')
          }
        >
          Save project
        </button>
        <label className="button-like">
          <button onClick={() => document.getElementById('open-file')?.click()}>Open</button>
        </label>
        <input
          id="open-file"
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const parsed = JSON.parse(await file.text());
              if (parsed?.schema !== 'pixel-peeker/1') {
                alert('That does not look like a Pixel Peeker project file.');
                return;
              }
              loadProject(parsed);
            } catch {
              alert('Could not read that file.');
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
