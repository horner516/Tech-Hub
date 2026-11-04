import type { PowerLineResult, SupplySpec, PowerBasis } from '../../domain/power-line';
import type { PublishedChain, PublishedChainMargin } from '../../domain/published-chains';
import { PUBLISHED_CHAIN_LIMIT_A, PUBLISHED_CHAIN_SOURCE } from '../../domain/published-chains';
import type { CabinetSpec } from '../../domain/types';
import { Stat, Bar } from './controls';
import { amps, watts, pct } from './format';

export function PowerLineCard({
  cabinet,
  result,
  supply,
  breaker,
  derated,
  basis,
  published,
  margin,
}: {
  cabinet: CabinetSpec;
  result: PowerLineResult;
  supply: SupplySpec;
  breaker: number;
  derated: boolean;
  basis: PowerBasis;
  published: PublishedChain | undefined;
  margin: PublishedChainMargin | null;
}) {
  return (
    <section className="lc-card lc-card--power">
      <header>
        <h2>Power line</h2>
        <p>
          One {breaker} A circuit on {supply.label}
          {derated && <> at 80%</>}
        </p>
      </header>

      <Stat
        label="Panels on one circuit"
        value={result.panelsPerCircuit || '—'}
        note={
          result.panelsPerCircuit === 0
            ? 'one panel already exceeds this breaker'
            : `${amps(result.drawAmps)} of ${amps(result.usableAmps)} usable`
        }
        tone="power"
        big
      />

      <Bar fraction={result.utilisation} tone="power" />
      <p className="lc-barnote">
        {pct(result.utilisation)} of the derated limit. {amps(result.spareAmps)} spare — the next
        panel needs {amps(result.ampsPerPanel)}.
      </p>

      <dl className="lc-detail">
        <div>
          <dt>Per panel</dt>
          <dd>
            {result.wattsPerPanel} W ÷ {supply.volts} V = {amps(result.ampsPerPanel)}
            <em> — {basis === 'peak' ? 'peak, all-white' : 'average programme'} draw</em>
          </dd>
        </div>
        <div>
          <dt>Usable current</dt>
          <dd>
            {amps(result.usableAmps)}
            <em> — {derated ? `80% of a ${breaker} A breaker, the continuous-load rule` : `the full ${breaker} A rating, which is a trip point rather than a budget`}</em>
          </dd>
        </div>
        <div>
          <dt>Circuit load</dt>
          <dd>{watts(result.totalWatts)} across {result.panelsPerCircuit} panels</dd>
        </div>
        {supply.phases === 3 && (
          <div>
            <dt>All three legs</dt>
            <dd>{result.panelsPerSupply} panels — the wall spread evenly across the phases</dd>
          </div>
        )}
      </dl>

      {published && margin ? (
        <div className="lc-published">
          <h3>What {cabinet.manufacturer} publish</h3>
          <p>
            <strong>{published.at220V} cabinets</strong> at AC220 V, <strong>{published.at110V}</strong> at
            AC110 V, on one 3×2.5 mm² cable — for the {published.publishedAs}, {published.environment.toLowerCase()},{' '}
            {published.cabinetMm} mm.
          </p>
          <p>
            That works out at <strong>{amps(margin.impliedAmps)}</strong> on a 220 V supply, so they have
            kept it inside a {PUBLISHED_CHAIN_LIMIT_A} A cable limit with {amps(margin.spareAmps)} to spare.
            {margin.panelsOverPublished > 0 && (
              <> This calculator's {result.panelsPerCircuit} is {margin.panelsOverPublished} more than they
              recommend, because it works to your breaker rather than to their cable.</>
            )}
          </p>
          <p className="lc-src">{PUBLISHED_CHAIN_SOURCE}</p>
        </div>
      ) : (
        <p className="lc-flag">
          {cabinet.manufacturer === 'Custom'
            ? 'There is no published panels-per-circuit figure for a panel described by hand'
            : `${cabinet.manufacturer} do not publish a panels-per-circuit figure`}{' '}
          — almost nobody does. Where a brochure prints "max hanging" or "max stacking", that is a
          mechanical limit about what the top panel's frame can carry, not a power one.
        </p>
      )}

      <p className="lc-flag lc-flag--warn">
        Steady state only. LED panel supplies draw a large, brief surge at switch-on, which is why
        a wall is powered up in sections and why a breaker that holds all day can still trip on
        power-up. Sizing a circuit is a job for whoever signs off the distro.
      </p>

      <p className="lc-src">{cabinet.source}</p>
    </section>
  );
}
