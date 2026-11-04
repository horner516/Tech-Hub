/**
 * Pixel Peeker — the pixel map.
 *
 * Every export (Resolume, VMP, LCT, the PDF) needs the same thing: where each cabinet
 * and each port's chain lands in pixel space. Compute it once, here, so the exports
 * cannot disagree with each other or with what the canvas draws.
 */

import type { CabinetInstance, CabinetSpec, Project } from './types';
import { cabinetPixels } from './types';
import {
  pixelRectOf,
  referencePitchMm as wallReferencePitchMm,
  wallBoundsMm,
  type PixelRect,
  type SpecLookup,
} from './wall';
import type { ProcessorLoad } from './wiring';

export interface MappedCabinet {
  inst: CabinetInstance;
  spec: CabinetSpec;
  rect: PixelRect;
  /** Position in the chain, 1-based. 0 when unpatched. */
  chainPosition: number;
  chainId?: string;
  processorName?: string;
  portLabel?: string;
}

export interface MappedChain {
  chainId: string;
  processorId: string;
  processorName: string;
  portId: string;
  portLabel: string;
  /** Bounding box of everything on this port, in pixel space. */
  bounds: PixelRect;
  cabinets: MappedCabinet[];
  pixels: number;
  capacityPx: number;
  utilisation: number;
}

export interface PixelMap {
  /** Pixel size of the whole wall's bounding box. */
  width: number;
  height: number;
  referencePitchMm: number;
  cabinets: MappedCabinet[];
  chains: MappedChain[];
  /** True when the wall mixes pitches, so the map is approximate. */
  approximate: boolean;
}

export function buildPixelMap(
  project: Project,
  lookup: SpecLookup,
  loads: ProcessorLoad[],
): PixelMap {
  const bounds = wallBoundsMm(project, lookup);
  const origin = bounds ? { xMm: bounds.xMm, yMm: bounds.yMm } : { xMm: 0, yMm: 0 };

  // Mixed-pitch detection goes by the datasheet figure; the division itself goes by the
  // true pitch (width / pixels), because the datasheet figure is rounded. See `truePitchMm`.
  const pitches = new Set<number>();
  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (spec) pitches.add(spec.pixelPitchMm);
  }
  const referencePitchMm = wallReferencePitchMm(project, lookup);

  // Where each cabinet sits in its chain.
  const positionOf = new Map<string, { chainId: string; index: number }>();
  for (const chain of project.chains) {
    chain.cabinetIds.forEach((id, i) =>
      positionOf.set(id, { chainId: chain.id, index: i + 1 }),
    );
  }

  const portMeta = new Map<string, { processorName: string; portLabel: string }>();
  for (const load of loads) {
    for (const port of load.ports) {
      if (port.chain) {
        portMeta.set(port.chain.id, {
          processorName: load.processor.name,
          portLabel: port.port.label,
        });
      }
    }
  }

  const cabinets: MappedCabinet[] = [];
  for (const inst of project.cabinets) {
    const spec = lookup(inst.specId);
    if (!spec) continue;
    const pos = positionOf.get(inst.id);
    const meta = pos ? portMeta.get(pos.chainId) : undefined;
    cabinets.push({
      inst,
      spec,
      rect: pixelRectOf(inst, spec, origin, referencePitchMm),
      chainPosition: pos?.index ?? 0,
      chainId: pos?.chainId,
      processorName: meta?.processorName,
      portLabel: meta?.portLabel,
    });
  }

  const byId = new Map(cabinets.map((c) => [c.inst.id, c]));
  const chains: MappedChain[] = [];
  for (const load of loads) {
    for (const port of load.ports) {
      if (!port.chain || !port.chain.cabinetIds.length) continue;
      const members = port.chain.cabinetIds
        .map((id) => byId.get(id))
        .filter((c): c is MappedCabinet => !!c);
      if (!members.length) continue;

      const minX = Math.min(...members.map((m) => m.rect.x));
      const minY = Math.min(...members.map((m) => m.rect.y));
      const maxX = Math.max(...members.map((m) => m.rect.x + m.rect.width));
      const maxY = Math.max(...members.map((m) => m.rect.y + m.rect.height));

      chains.push({
        chainId: port.chain.id,
        processorId: load.processor.id,
        processorName: load.processor.name,
        portId: port.port.id,
        portLabel: port.port.label,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        cabinets: members,
        pixels: members.reduce((n, m) => n + cabinetPixels(m.spec), 0),
        capacityPx: port.capacityPx,
        utilisation: port.utilisation,
      });
    }
  }

  return {
    width: bounds ? Math.round(bounds.widthMm / referencePitchMm) : 0,
    height: bounds ? Math.round(bounds.heightMm / referencePitchMm) : 0,
    referencePitchMm,
    cabinets,
    chains,
    approximate: pitches.size > 1,
  };
}
