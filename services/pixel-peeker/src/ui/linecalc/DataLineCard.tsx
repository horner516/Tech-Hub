import type { DataLineResult } from '../../domain/data-line';
import type { BitDepth, CabinetSpec, ProcessorSpec } from '../../domain/types';
import { Stat, Bar } from './controls';
import { int, px, pct } from './format';

const LIMIT_TEXT: Record<string, string> = {
  'port-bandwidth': 'the port runs out of bandwidth',
  'receiving-card': 'the receiving card cannot drive this panel',
  'device-cap': 'the processor runs out before its ports do',
};

export function DataLineCard({
  cabinet,
  proc,
  result,
  bitDepth,
  frameRateHz,
}: {
  cabinet: CabinetSpec;
  proc: ProcessorSpec;
  result: DataLineResult;
  bitDepth: BitDepth;
  frameRateHz: number;
}) {
  const bits = result.bitsPerPixel;
  const naive = 3 * bitDepth;
  const { port } = result;

  return (
    <section className="lc-card lc-card--data">
      <header>
        <h2>Data line</h2>
        <p>One port of a {proc.manufacturer} {proc.model}</p>
      </header>

      <Stat
        label="Panels on one port"
        value={result.panelsPerPort || '—'}
        note={LIMIT_TEXT[result.portLimitedBy]}
        tone="data"
        big
      />

      <Bar fraction={result.utilisation} tone="data" />
      <p className="lc-barnote">
        {px(result.usedPx)} of {px(result.portCapacityPx)} used — {pct(result.utilisation)} of the port.
        {result.panelsPerPort > 0 && (
          <> One more panel would need {px((result.panelsPerPort + 1) * result.panelPixels)}.</>
        )}
      </p>

      <dl className="lc-detail">
        <div>
          <dt>Port capacity</dt>
          <dd>{px(result.portCapacityPx)} at {bitDepth}-bit / {frameRateHz} Hz</dd>
        </div>
        <div>
          <dt>Cost per pixel</dt>
          <dd>
            {bits} bits
            {bits > naive && (
              <em> — not {naive}. Power-of-two containers, which is the {pct(bits / naive - 1)} most spreadsheets miss.</em>
            )}
          </dd>
        </div>
        <div>
          <dt>Link</dt>
          <dd>
            {port.linkSpeedGbps} Gb/s {port.medium} × {result.portCount}, {(result.efficiency * 100).toFixed(1)}% efficient
            {port.subLinks ? <em> — each one a trunk of {port.subLinks} links</em> : null}
          </dd>
        </div>
        <div>
          <dt>Panel</dt>
          <dd>{cabinet.pixelsX} × {cabinet.pixelsY} = {int(result.panelPixels)} px</dd>
        </div>
        <div>
          <dt>Whole processor</dt>
          <dd>
            {int(result.panelsPerProcessor)} panels
            {result.processorLimitedBy === 'device-cap' ? (
              <em>
                {' '}— capped at {px(result.deviceCapacityPx)}, so it fills only {result.portsFilled} of
                its {result.portCount} ports
              </em>
            ) : (
              <em> — {result.portCount} ports × {result.panelsPerPort}</em>
            )}
          </dd>
        </div>
        <div>
          <dt>Headroom</dt>
          <dd>
            {Number.isFinite(result.maxFrameRateHz)
              ? `${Math.floor(result.maxFrameRateHz)} Hz max at this load`
              : '—'}
          </dd>
        </div>
      </dl>

      {result.cardLimit && (
        <p className="lc-flag lc-flag--bad">
          {result.cardLimit.detail} The panel cannot be driven by its own card — check the
          datasheet before trusting either figure.
        </p>
      )}

      <p className="lc-src">{proc.source}</p>
    </section>
  );
}
