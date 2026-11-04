/**
 * Pixel Peeker — top-level layout.
 *
 * Two views share the top bar: the wall designer, and the Line calc view (how many of
 * one panel fit on a port and on a circuit — formerly the separate Line Calc tool).
 * There is no router. The view is a mode, and `#line` in the URL selects the line
 * calculator, so a link can land straight on it — that is what the old
 * line-calc.stoatworks-labs.com redirects to.
 *
 * The designer UNMOUNTS while the line calculator is showing, rather than being hidden.
 * WallCanvas listens for keys on `window` — Delete, arrows, F, S — and a hidden canvas
 * would still act on them, deleting a selection nobody can see. Nothing is lost: the
 * project lives in the store, and only the canvas pan/zoom resets (to fit) on return.
 *
 * The signal format lives in the top bar rather than a settings dialog on purpose:
 * changing bit depth or frame rate re-costs every port on the wall, and that needs to
 * be one click away with the consequences visible in the same glance.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { LibraryPanel } from './LibraryPanel';
import { SystemPanel } from './SystemPanel';
import { WallCanvas } from './WallCanvas';
import { LineCalcView } from './linecalc/LineCalcView';
import { FRAME_RATES, REFRESH_RATES } from './signal-options';
import { wireBitsPerPixel } from '../domain/capacity';
import type { BitDepth } from '../domain/types';

type Mode = 'design' | 'line';

/** The deep link for the Line calc view. Keep it: old line-calc URLs redirect here. */
const LINE_HASH = '#line';

const modeFromHash = (): Mode => (window.location.hash === LINE_HASH ? 'line' : 'design');

/** The view, kept in step with the URL hash so it can be linked to and reloaded. */
function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>(modeFromHash);
  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const choose = (m: Mode) => {
    setMode(m);
    // replaceState, not a hash assignment: switching views is not a navigation, so it
    // should not stack up Back-button history, and it must not fire `hashchange`.
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', m === 'line' ? `${pathname}${search}${LINE_HASH}` : `${pathname}${search}`);
  };
  return [mode, choose];
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="modes" role="tablist" aria-label="View">
      <button role="tab" aria-selected={mode === 'design'} className={mode === 'design' ? 'on' : ''} onClick={() => onChange('design')}>
        Wall designer
      </button>
      <button role="tab" aria-selected={mode === 'line'} className={mode === 'line' ? 'on' : ''} onClick={() => onChange('line')}>
        Line calc
      </button>
    </div>
  );
}

export function App() {
  const [mode, setMode] = useMode();
  return mode === 'line' ? <LineApp mode={mode} setMode={setMode} /> : <DesignApp mode={mode} setMode={setMode} />;
}

function AboutButton() {
  /* Opens the shared About dialog — see public/about.js, which delegates this
     attribute from the document, so nothing needs importing here. */
  return (
    <button type="button" data-stoatworks-about>
      About
    </button>
  );
}

function LineApp({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          PIXEL<span>PEEKER</span>
        </div>
        <ModeSwitch mode={mode} onChange={setMode} />
        <div className="tagline">
          How many panels fit on one processor port, and how many on one power circuit.
        </div>
        <div className="spacer" />
        <AboutButton />
      </div>
      <LineCalcView />
    </div>
  );
}

function DesignApp({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const project = useStore((s) => s.project);
  const setSignal = useStore((s) => s.setSignal);
  const setMeta = useStore((s) => s.setMeta);
  const stats = useStore((s) => s.derived.stats);
  const loads = useStore((s) => s.derived.loads);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);

  const totalCapacity = loads.reduce((n, l) => n + l.capacityPx, 0);
  const totalUsed = loads.reduce((n, l) => n + l.usedPx, 0);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          PIXEL<span>PEEKER</span>
        </div>

        <ModeSwitch mode={mode} onChange={setMode} />

        <input
          className="name-input"
          value={project.name}
          onChange={(e) => setMeta({ name: e.target.value })}
          aria-label="Project name"
        />

        <div className="field">
          <label>Bit depth</label>
          <select
            value={project.signal.bitDepth}
            onChange={(e) => setSignal({ bitDepth: Number(e.target.value) as BitDepth })}
          >
            <option value={8}>8-bit</option>
            <option value={10}>10-bit</option>
            <option value={12}>12-bit</option>
          </select>
        </div>

        <div className="field">
          <label>Frame rate</label>
          <select
            value={project.signal.frameRateHz}
            onChange={(e) => setSignal({ frameRateHz: Number(e.target.value) })}
          >
            {FRAME_RATES.map((f) => (
              <option key={f} value={f}>
                {f} Hz
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>LED refresh</label>
          <select
            value={project.signal.ledRefreshHz}
            onChange={(e) => setSignal({ ledRefreshHz: Number(e.target.value) })}
          >
            {REFRESH_RATES.map((f) => (
              <option key={f} value={f}>
                {f.toLocaleString()} Hz
              </option>
            ))}
          </select>
        </div>

        <div
          className="field"
          title="Bits each pixel occupies on the wire. Vendors pack colour components into power-of-two containers, so 10-bit costs 32 bits, not 30."
        >
          <label>Wire cost</label>
          <span style={{ fontFamily: 'var(--mono)' }}>
            {wireBitsPerPixel(project.signal.bitDepth)} bpp
          </span>
        </div>

        <div className="spacer" />

        <div className="stats">
          <div className="stat">
            <div className="k">Cabinets</div>
            <div className="v">{stats.cabinetCount}</div>
          </div>
          <div className="stat">
            <div className="k">Resolution</div>
            <div className="v">
              {stats.boundingPixels
                ? `${stats.boundingPixels.width}×${stats.boundingPixels.height}`
                : '—'}
            </div>
          </div>
          <div className="stat">
            <div className="k">Pixels</div>
            <div className="v">{stats.totalPixels.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="k">Size</div>
            <div className="v">
              {stats.boundsMm
                ? `${(stats.boundsMm.widthMm / 1000).toFixed(2)}×${(stats.boundsMm.heightMm / 1000).toFixed(2)} m`
                : '—'}
            </div>
          </div>
          <div className="stat">
            <div className="k">Weight</div>
            <div className="v">{stats.totalWeightKg.toFixed(0)} kg</div>
          </div>
          <div className="stat">
            <div className="k">Peak power</div>
            <div className="v">{(stats.powerMaxW / 1000).toFixed(1)} kW</div>
          </div>
          <div className="stat" title="Pixels patched versus total processing capacity">
            <div className="k">System load</div>
            <div className="v">
              {totalCapacity
                ? `${Math.round((totalUsed / totalCapacity) * 100)}%`
                : '—'}
            </div>
          </div>
        </div>

        <div className="row">
          <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
            ↷
          </button>
          <AboutButton />
        </div>
      </div>

      <div className="main">
        <LibraryPanel />
        <WallCanvas />
        <SystemPanel />
      </div>
    </div>
  );
}
