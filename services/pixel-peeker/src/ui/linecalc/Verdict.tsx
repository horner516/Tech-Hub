import type { LineVerdict } from '../../domain/line-verdict';
import type { SupplySpec } from '../../domain/power-line';
import type { ProcessorSpec } from '../../domain/types';
import { mm, plural } from './format';

/**
 * The answer to the question actually being asked: of the two lines, which one stops
 * the run. See `domain/line-verdict.ts` for why both are shown and then this.
 */
export function Verdict({
  verdict,
  dataPanels,
  powerPanels,
  proc,
  supply,
  breaker,
}: {
  verdict: LineVerdict;
  dataPanels: number;
  powerPanels: number;
  proc: ProcessorSpec;
  supply: SupplySpec;
  breaker: number;
}) {
  const { run, binds, spare } = verdict;

  if (binds === 'none') {
    return (
      <section className="lc-verdict lc-verdict--bad">
        <h2>Nothing fits</h2>
        <p className="lc-verdict__why">
          {dataPanels <= 0
            ? `A ${proc.model} port cannot carry even one of these panels at this format.`
            : `One panel draws more than a ${breaker} A circuit on ${supply.label} allows.`}
        </p>
      </section>
    );
  }

  return (
    <section className={`lc-verdict lc-verdict--${binds}`}>
      <p className="lc-verdict__eyebrow">A single line of this panel</p>
      <h2>
        <strong>{run}</strong> panels
        <span className="lc-verdict__sub">
          {' '}— {mm(verdict.rowMm)} in a row, or {mm(verdict.columnMm)} in a column
        </span>
      </h2>
      <p className="lc-verdict__why">
        {binds === 'both' ? (
          <>
            Both lines land on {run}: the port and the circuit run out together, which is a
            coincidence of this panel, this processor and this breaker rather than a design.
          </>
        ) : binds === 'data' ? (
          <>
            <b>Data binds.</b> The port stops at {dataPanels} while the {breaker} A circuit would carry{' '}
            {powerPanels}. You have {plural(spare, 'panel')} of spare power on this circuit — worth
            knowing before someone adds a distro that was never the problem.
          </>
        ) : (
          <>
            <b>Power binds.</b> The circuit stops at {powerPanels} while the port would carry{' '}
            {dataPanels}. Another {plural(spare, 'panel')} of link capacity is sitting unused, so the
            fix is another circuit, not another port.
          </>
        )}
      </p>
    </section>
  );
}
