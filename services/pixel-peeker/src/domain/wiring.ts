/**
 * Pixel Peeker — port loading and auto-wiring.
 *
 * A chain is the physical cable run out of one output port. Order is the sending
 * order, and it is what LCT/VMP will ask you to draw by hand. Getting it right
 * here is the point of the whole app.
 */

import { portCapacity, processorCapacity } from './capacity';
import type {
  CabinetInstance,
  CabinetSpec,
  Chain,
  PortSpec,
  ProcessorInstance,
  ProcessorSpec,
  Project,
  SignalFormat,
} from './types';
import { cabinetPixels } from './types';
import type { Issue, SpecLookup } from './wall';

export interface PortLoad {
  processor: ProcessorInstance;
  processorSpec: ProcessorSpec;
  port: PortSpec;
  chain?: Chain;
  cabinets: { inst: CabinetInstance; spec: CabinetSpec }[];
  usedPx: number;
  capacityPx: number;
  utilisation: number;
  headroomPx: number;
  /** Highest frame rate this load could run at, at the project bit depth. */
  maxFrameRateHz: number;
}

export interface ProcessorLoad {
  processor: ProcessorInstance;
  spec: ProcessorSpec;
  ports: PortLoad[];
  usedPx: number;
  capacityPx: number;
  utilisation: number;
}

export function computeLoads(
  project: Project,
  cabinetSpec: SpecLookup,
  processorSpec: (id: string) => ProcessorSpec | undefined,
): ProcessorLoad[] {
  const cabinetById = new Map(project.cabinets.map((c) => [c.id, c]));
  const out: ProcessorLoad[] = [];

  for (const proc of project.processors) {
    const spec = processorSpec(proc.specId);
    if (!spec) continue;

    const ports: PortLoad[] = spec.ports.map((port) => {
      const chain = project.chains.find(
        (c) => c.processorId === proc.id && c.portId === port.id,
      );
      const cabinets = (chain?.cabinetIds ?? [])
        .map((id) => {
          const inst = cabinetById.get(id);
          const cs = inst ? cabinetSpec(inst.specId) : undefined;
          return inst && cs ? { inst, spec: cs } : undefined;
        })
        .filter((r): r is { inst: CabinetInstance; spec: CabinetSpec } => !!r);

      const usedPx = cabinets.reduce((n, c) => n + cabinetPixels(c.spec), 0);
      const cap = portCapacity(port, project.signal);
      return {
        processor: proc,
        processorSpec: spec,
        port,
        chain,
        cabinets,
        usedPx,
        capacityPx: cap.capacityPx,
        utilisation: cap.capacityPx > 0 ? usedPx / cap.capacityPx : 0,
        headroomPx: cap.capacityPx - usedPx,
        maxFrameRateHz:
          usedPx > 0
            ? (cap.payloadBps / cap.bitsPerPixel / usedPx)
            : Infinity,
      };
    });

    const usedPx = ports.reduce((n, p) => n + p.usedPx, 0);
    const capacityPx = processorCapacity(spec, project.signal);
    out.push({
      processor: proc,
      spec,
      ports,
      usedPx,
      capacityPx,
      utilisation: capacityPx > 0 ? usedPx / capacityPx : 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateWiring(
  project: Project,
  loads: ProcessorLoad[],
  cabinetSpec: SpecLookup,
): Issue[] {
  const issues: Issue[] = [];

  // Every cabinet on at most one port, and ideally on one.
  const seen = new Map<string, string[]>();
  for (const chain of project.chains) {
    for (const id of chain.cabinetIds) {
      const list = seen.get(id) ?? [];
      list.push(chain.id);
      seen.set(id, list);
    }
  }

  const doubled = [...seen.entries()].filter(([, chains]) => chains.length > 1);
  if (doubled.length) {
    issues.push({
      severity: 'error',
      code: 'double-patched',
      message: `${doubled.length} cabinet(s) are patched to more than one port.`,
      refs: doubled.map(([id]) => id),
    });
  }

  const unpatched = project.cabinets.filter((c) => !seen.has(c.id));
  if (unpatched.length) {
    issues.push({
      severity: 'warning',
      code: 'unpatched',
      message: `${unpatched.length} cabinet(s) are not patched to any port — they will be dark.`,
      refs: unpatched.map((c) => c.id),
    });
  }

  const orphaned = [...seen.keys()].filter(
    (id) => !project.cabinets.some((c) => c.id === id),
  );
  if (orphaned.length) {
    issues.push({
      severity: 'error',
      code: 'orphan-patch',
      message: `${orphaned.length} chain entr(ies) point at cabinets that no longer exist.`,
      refs: orphaned,
    });
  }

  for (const load of loads) {
    for (const port of load.ports) {
      if (port.usedPx > port.capacityPx) {
        issues.push({
          severity: 'error',
          code: 'port-over-capacity',
          message: `${load.processor.name} ${port.port.label} is over capacity: ${port.usedPx.toLocaleString()} px on a ${port.capacityPx.toLocaleString()} px port (${Math.round(port.utilisation * 100)}%). Max frame rate at this load is ${port.maxFrameRateHz.toFixed(1)} Hz.`,
          refs: port.chain ? [port.chain.id] : [],
        });
      } else if (port.utilisation > 0.9) {
        issues.push({
          severity: 'warning',
          code: 'port-tight',
          message: `${load.processor.name} ${port.port.label} is at ${Math.round(port.utilisation * 100)}% — under 10% headroom.`,
          refs: port.chain ? [port.chain.id] : [],
        });
      }
    }

    if (load.usedPx > load.capacityPx) {
      issues.push({
        severity: 'error',
        code: 'processor-over-capacity',
        message: `${load.processor.name} (${load.spec.model}) is over its device capacity: ${load.usedPx.toLocaleString()} px of ${load.capacityPx.toLocaleString()} px. The ports have room but the device does not.`,
        refs: [load.processor.id],
      });
    }
  }

  // Input signal has to be able to carry the wall.
  for (const load of loads) {
    const best = load.spec.inputs.reduce<{ w: number; h: number } | null>(
      (acc, i) =>
        !acc || i.maxWidthPx * i.maxHeightPx > acc.w * acc.h
          ? { w: i.maxWidthPx, h: i.maxHeightPx }
          : acc,
      null,
    );
    if (best && load.usedPx > best.w * best.h) {
      issues.push({
        severity: 'warning',
        code: 'input-too-small',
        message: `${load.processor.name} is carrying ${load.usedPx.toLocaleString()} px but its largest input is ${best.w}x${best.h} (${(best.w * best.h).toLocaleString()} px). You will need more than one input, or a lower-resolution feed scaled up.`,
        refs: [load.processor.id],
      });
    }
    const tooFast = load.spec.inputs.every((i) => i.maxFps < project.signal.frameRateHz);
    if (load.spec.inputs.length && tooFast) {
      issues.push({
        severity: 'error',
        code: 'input-fps',
        message: `${load.processor.name} has no input that accepts ${project.signal.frameRateHz} Hz.`,
        refs: [load.processor.id],
      });
    }
  }

  // Chains that jump around the wall cost cable and are usually a mistake.
  const cabinetById = new Map(project.cabinets.map((c) => [c.id, c]));
  for (const chain of project.chains) {
    const jumps = countDiscontinuities(chain, cabinetById, cabinetSpec);
    if (jumps > 0) {
      issues.push({
        severity: 'info',
        code: 'chain-jumps',
        message: `Chain on ${chain.portId} makes ${jumps} non-adjacent jump(s) — check the cable lengths.`,
        refs: [chain.id],
      });
    }
  }

  return issues;
}

/** Count steps in a chain where consecutive cabinets do not touch. */
function countDiscontinuities(
  chain: Chain,
  cabinetById: Map<string, CabinetInstance>,
  cabinetSpec: SpecLookup,
): number {
  let jumps = 0;
  for (let i = 1; i < chain.cabinetIds.length; i++) {
    const a = cabinetById.get(chain.cabinetIds[i - 1]);
    const b = cabinetById.get(chain.cabinetIds[i]);
    if (!a || !b) continue;
    const sa = cabinetSpec(a.specId);
    const sb = cabinetSpec(b.specId);
    if (!sa || !sb) continue;
    const touchesX =
      Math.abs(a.xMm + sa.widthMm - b.xMm) < 1 ||
      Math.abs(b.xMm + sb.widthMm - a.xMm) < 1;
    const touchesY =
      Math.abs(a.yMm + sa.heightMm - b.yMm) < 1 ||
      Math.abs(b.yMm + sb.heightMm - a.yMm) < 1;
    const sameRow = Math.abs(a.yMm - b.yMm) < 1;
    const sameCol = Math.abs(a.xMm - b.xMm) < 1;
    const adjacent = (touchesX && sameRow) || (touchesY && sameCol);
    if (!adjacent) jumps++;
  }
  return jumps;
}

// ---------------------------------------------------------------------------
// Auto-wiring
// ---------------------------------------------------------------------------

export type WirePattern = 'serpentine-v' | 'serpentine-h' | 'column' | 'row';

export interface AutoWireOptions {
  pattern: WirePattern;
  /** Stop filling a port at this utilisation, leaving headroom. 0.85 = 15% spare. */
  fillTo: number;
  /** Only wire cabinets that are not already patched. */
  skipPatched: boolean;
}

export const DEFAULT_AUTOWIRE: AutoWireOptions = {
  pattern: 'serpentine-v',
  fillTo: 0.9,
  skipPatched: false,
};

/**
 * Order cabinets for wiring.
 *
 * `serpentine-v` runs down a column, then up the next — the standard way to hang
 * a wall, because it keeps the cable run short and the loop closes near the start.
 * `serpentine-h` is the same left-right. `column`/`row` reset to the same edge each
 * time, which costs more cable but is easier to fault-find.
 */
export function orderCabinets(
  cabinets: { inst: CabinetInstance; spec: CabinetSpec }[],
  pattern: WirePattern,
): { inst: CabinetInstance; spec: CabinetSpec }[] {
  const TOL = 1;
  const key = (v: number) => Math.round(v / TOL);

  if (pattern === 'serpentine-v' || pattern === 'column') {
    const cols = new Map<number, typeof cabinets>();
    for (const c of cabinets) {
      const k = key(c.inst.xMm);
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k)!.push(c);
    }
    const sortedKeys = [...cols.keys()].sort((a, b) => a - b);
    const out: typeof cabinets = [];
    sortedKeys.forEach((k, i) => {
      const col = cols.get(k)!.sort((a, b) => a.inst.yMm - b.inst.yMm);
      const flip = pattern === 'serpentine-v' && i % 2 === 1;
      out.push(...(flip ? col.reverse() : col));
    });
    return out;
  }

  const rows = new Map<number, typeof cabinets>();
  for (const c of cabinets) {
    const k = key(c.inst.yMm);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(c);
  }
  const sortedKeys = [...rows.keys()].sort((a, b) => a - b);
  const out: typeof cabinets = [];
  sortedKeys.forEach((k, i) => {
    const row = rows.get(k)!.sort((a, b) => a.inst.xMm - b.inst.xMm);
    const flip = pattern === 'serpentine-h' && i % 2 === 1;
    out.push(...(flip ? row.reverse() : row));
  });
  return out;
}

export interface AutoWireResult {
  chains: Chain[];
  /** Cabinets that would not fit on the available ports. */
  unassigned: string[];
  notes: string[];
}

/**
 * Fill the available ports in order, walking the wall in the chosen pattern.
 *
 * Deliberately simple and predictable rather than optimal: a tech has to be able
 * to look at the result and see why each cabinet went where it did. It fills each
 * port to `fillTo` of capacity and moves on. It does not try to balance ports.
 */
export function autoWire(
  project: Project,
  cabinetSpec: SpecLookup,
  processorSpec: (id: string) => ProcessorSpec | undefined,
  options: AutoWireOptions,
  idFactory: () => string,
): AutoWireResult {
  const notes: string[] = [];

  const alreadyPatched = new Set(
    options.skipPatched ? project.chains.flatMap((c) => c.cabinetIds) : [],
  );

  const placed = project.cabinets
    .filter((c) => !alreadyPatched.has(c.id))
    .map((inst) => ({ inst, spec: cabinetSpec(inst.specId) }))
    .filter((r): r is { inst: CabinetInstance; spec: CabinetSpec } => !!r.spec);

  const queue = orderCabinets(placed, options.pattern);

  const slots: { proc: ProcessorInstance; spec: ProcessorSpec; port: PortSpec }[] = [];
  for (const proc of project.processors) {
    const spec = processorSpec(proc.specId);
    if (!spec) continue;
    for (const port of spec.ports) {
      const taken =
        options.skipPatched &&
        project.chains.some((c) => c.processorId === proc.id && c.portId === port.id);
      if (!taken) slots.push({ proc, spec, port });
    }
  }

  if (!slots.length) {
    return {
      chains: [],
      unassigned: queue.map((c) => c.inst.id),
      notes: ['No processor ports available — add a processor first.'],
    };
  }

  const chains: Chain[] = [];
  let cursor = 0;

  for (const slot of slots) {
    if (cursor >= queue.length) break;
    const cap = Math.floor(
      portCapacity(slot.port, project.signal).capacityPx * options.fillTo,
    );
    const ids: string[] = [];
    let used = 0;
    while (cursor < queue.length) {
      const next = queue[cursor];
      const px = cabinetPixels(next.spec);
      if (used + px > cap) break;
      ids.push(next.inst.id);
      used += px;
      cursor++;
    }
    if (ids.length) {
      chains.push({
        id: idFactory(),
        processorId: slot.proc.id,
        portId: slot.port.id,
        cabinetIds: ids,
      });
    } else if (cursor < queue.length) {
      notes.push(
        `${slot.proc.name} ${slot.port.label} was skipped — the next cabinet alone (${cabinetPixels(queue[cursor].spec).toLocaleString()} px) exceeds the ${Math.round(options.fillTo * 100)}% fill limit of ${cap.toLocaleString()} px.`,
      );
    }
  }

  const unassigned = queue.slice(cursor).map((c) => c.inst.id);
  if (unassigned.length) {
    notes.push(
      `${unassigned.length} cabinet(s) did not fit on the available ports. Add another processor, raise the fill limit, or drop the bit depth / frame rate.`,
    );
  }

  return { chains, unassigned, notes };
}

/** Colour for a chain in the wiring view — stable, derived from index. */
export function chainColour(index: number): string {
  const palette = [
    '#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8',
    '#4db6ac', '#fff176', '#f06292', '#9575cd', '#a1887f',
    '#64b5f6', '#ffd54f', '#aed581', '#ff8a65', '#7986cb',
  ];
  return palette[index % palette.length];
}

/** Per-signal-format summary used in the header and the PDF. */
export function systemSummary(loads: ProcessorLoad[], signal: SignalFormat) {
  const usedPx = loads.reduce((n, l) => n + l.usedPx, 0);
  const capacityPx = loads.reduce((n, l) => n + l.capacityPx, 0);
  const portCount = loads.reduce((n, l) => n + l.ports.length, 0);
  const portsUsed = loads.reduce(
    (n, l) => n + l.ports.filter((p) => p.usedPx > 0).length,
    0,
  );
  return {
    usedPx,
    capacityPx,
    utilisation: capacityPx > 0 ? usedPx / capacityPx : 0,
    portCount,
    portsUsed,
    signal,
  };
}
