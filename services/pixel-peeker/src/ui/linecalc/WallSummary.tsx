import type { DataLineResult, WallData } from '../../domain/data-line';
import type { PowerLineResult, SupplySpec, WallPower } from '../../domain/power-line';
import type { ProcessorSpec } from '../../domain/types';
import { Stat } from './controls';
import { amps, watts, int } from './format';

/**
 * What the whole wall needs, once the per-line answers are known.
 *
 * The current here is always the PEAK figure whatever the on-screen basis, because it is
 * what the distro has to survive rather than what the wall will average.
 */
export function WallSummary({
  panelCount,
  data,
  power,
  wallD,
  wallP,
  proc,
  supply,
}: {
  panelCount: number;
  data: DataLineResult;
  power: PowerLineResult;
  wallD: WallData;
  wallP: WallPower;
  proc: ProcessorSpec;
  supply: SupplySpec;
}) {
  return (
    <section className="lc-wall">
      <header>
        <h2>A wall of {int(panelCount)} panels</h2>
        <p>
          {int(wallD.totalPx)} px total, {wallD.weightKg.toFixed(0)} kg of panel
        </p>
      </header>

      <div className="lc-wall__stats">
        <Stat label="Ports needed" value={wallD.ports || '—'} note={`at ${data.panelsPerPort} per port`} tone="data" />
        <Stat
          label={`${proc.model} needed`}
          value={wallD.processors || '—'}
          note={`${data.portCount} ports each, ${int(data.panelsPerProcessor)} panels each`}
          tone="data"
        />
        <Stat
          label="Circuits needed"
          value={wallP.circuits || '—'}
          note={`at ${power.panelsPerCircuit} per circuit`}
          tone="power"
        />
        <Stat
          label="Peak draw"
          value={watts(wallP.peakKw * 1000)}
          note={
            supply.phases === 3
              ? `${amps(wallP.peakAmpsTotal)} per leg across three phases`
              : `${amps(wallP.peakAmpsTotal)} at ${supply.volts} V`
          }
          tone="power"
        />
        <Stat
          label="Average draw"
          value={watts(wallP.avgKw * 1000)}
          note={`${amps(wallP.avgAmpsTotal)} — what it will actually pull`}
        />
      </div>

      {wallD.deviceBound && (
        <p className="lc-flag lc-flag--warn">
          {wallD.ports} ports would fit on {wallD.processorsByPorts} × {proc.model}, but each one's own
          pixel ceiling stops it at {int(data.panelsPerProcessor)} panels, so it takes{' '}
          {wallD.processors}. The extra processors are there for capacity, not for connectors.
        </p>
      )}
    </section>
  );
}
