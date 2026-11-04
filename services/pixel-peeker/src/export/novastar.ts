/**
 * Pixel Peeker — NovaStar LCT / VMP export.
 *
 * ############################################################################
 * # HONEST STATEMENT OF WHAT THIS CAN AND CANNOT DO.                         #
 * #                                                                          #
 * # LCT screen configuration files (.scr) remain proprietary and partly      #
 * # binary, and are not fabricated here.                                      #
 * #                                                                          #
 * # VMP project files (.nprj) turn out to be a ZIP OF PLAIN JSON — see       #
 * # docs/novastar-vmp-format.md, written from a real VMP V1.5.1 export.      #
 * # A writer is realistic and mostly mapped out. One thing still blocks it:  #
 * # the sample used only ONE Ethernet port, so `connectID` cannot be         #
 * # distinguished between "sending order within a port" and "port index",    #
 * # and nothing else in the tree names a port. That doc records the exact    #
 * # experiment that would settle it.                                          #
 * #                                                                          #
 * # Until then: guessing at the port mapping would produce a file that       #
 * # loads and looks right but drives the wrong cabinets, which on site is    #
 * # far more damaging than no file.                                          #
 * #                                                                          #
 * # So this module does NOT fabricate a .scr or a .vmp. It emits the         #
 * # complete screen configuration as data, in the two forms that are         #
 * # actually useful today:                                                   #
 * #                                                                          #
 * #   1. A cabinet schedule CSV — every cabinet with its pixel coordinates,  #
 * #      port, and position in the sending order. This is precisely the      #
 * #      information you otherwise transcribe by hand into the LCT screen    #
 * #      configuration grid, and it is the thing that takes an hour and      #
 * #      goes wrong at 2am.                                                  #
 * #   2. A structured JSON interchange with the same data plus the           #
 * #      capacity workings, versioned so a future .scr/.vmp writer has a     #
 * #      stable input.                                                       #
 * #                                                                          #
 * # TO GO FURTHER: hand this module a real .scr and a real VMP project       #
 * # exported from a known-good configuration and the container can be        #
 * # worked out. That is a genuine reverse-engineering task, not a            #
 * # formatting one.                                                          #
 * ############################################################################
 */

import { portCapacity, wireBitsPerPixel } from '../domain/capacity';
import type { PixelMap } from '../domain/pixelmap';
import type { Project } from '../domain/types';
import type { ProcessorLoad } from '../domain/wiring';

/**
 * Cabinet schedule — one row per cabinet, in sending order within each port.
 *
 * Column order follows the way LCT's screen configuration is filled in: pick the
 * port, then walk the cabinets in order, entering each one's position.
 */
export function buildCabinetScheduleCsv(map: PixelMap): string {
  const header = [
    'processor',
    'port',
    'order_in_chain',
    'cabinet_id',
    'manufacturer',
    'model',
    'pixel_pitch_mm',
    'x_px',
    'y_px',
    'width_px',
    'height_px',
    'pixels',
    'x_mm',
    'y_mm',
    'receiving_card',
  ];

  const sorted = [...map.cabinets].sort((a, b) => {
    const p = (a.processorName ?? '~').localeCompare(b.processorName ?? '~');
    if (p !== 0) return p;
    const q = (a.portLabel ?? '~').localeCompare(b.portLabel ?? '~', undefined, {
      numeric: true,
    });
    if (q !== 0) return q;
    return a.chainPosition - b.chainPosition;
  });

  const rows = sorted.map((c) => [
    c.processorName ?? 'UNPATCHED',
    c.portLabel ?? '',
    c.chainPosition || '',
    c.inst.id,
    c.spec.manufacturer,
    c.spec.model,
    c.spec.pixelPitchMm,
    c.rect.x,
    c.rect.y,
    c.rect.width,
    c.rect.height,
    c.rect.width * c.rect.height,
    Math.round(c.inst.xMm),
    Math.round(c.inst.yMm),
    c.spec.receivingCardId ?? '',
  ]);

  return [header, ...rows]
    .map((r) => r.map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(','))
    .join('\n') + '\n';
}

/** Versioned interchange document — the full design as structured data. */
export interface InterchangeDoc {
  format: 'pixel-peeker.interchange/1';
  generatedBy: string;
  project: {
    name: string;
    client?: string;
    venue?: string;
    designer?: string;
  };
  signal: Project['signal'];
  wall: {
    widthPx: number;
    heightPx: number;
    referencePitchMm: number;
    approximatePixelMap: boolean;
    cabinetCount: number;
    totalPixels: number;
  };
  capacityModel: {
    note: string;
    wireBitsPerPixel: number;
  };
  processors: {
    name: string;
    model: string;
    manufacturer: string;
    deviceCapacityPx: number;
    usedPx: number;
    ports: {
      label: string;
      linkSpeedGbps: number;
      capacityPx: number;
      usedPx: number;
      utilisationPct: number;
      cabinets: {
        order: number;
        id: string;
        model: string;
        xPx: number;
        yPx: number;
        widthPx: number;
        heightPx: number;
      }[];
    }[];
  }[];
  unpatchedCabinets: string[];
}

export function buildInterchange(
  project: Project,
  map: PixelMap,
  loads: ProcessorLoad[],
): InterchangeDoc {
  const byChain = new Map(map.chains.map((c) => [c.chainId, c]));

  return {
    format: 'pixel-peeker.interchange/1',
    generatedBy: 'Pixel Peeker',
    project: {
      name: project.name,
      client: project.client,
      venue: project.venue,
      designer: project.designer,
    },
    signal: project.signal,
    wall: {
      widthPx: map.width,
      heightPx: map.height,
      referencePitchMm: Number(map.referencePitchMm.toFixed(6)),
      approximatePixelMap: map.approximate,
      cabinetCount: map.cabinets.length,
      totalPixels: map.cabinets.reduce((n, c) => n + c.rect.width * c.rect.height, 0),
    },
    capacityModel: {
      note:
        'Port capacity = link rate x efficiency / wire bits per pixel / frame rate. Pixels are packed into power-of-two containers (8-bit=24, 10-bit=32, 12-bit=48 bits), which reproduces NovaStar published per-port figures exactly.',
      wireBitsPerPixel: wireBitsPerPixel(project.signal.bitDepth),
    },
    processors: loads.map((load) => ({
      name: load.processor.name,
      model: load.spec.model,
      manufacturer: load.spec.manufacturer,
      deviceCapacityPx: load.capacityPx,
      usedPx: load.usedPx,
      ports: load.ports.map((port) => {
        const mapped = port.chain ? byChain.get(port.chain.id) : undefined;
        return {
          label: port.port.label,
          linkSpeedGbps: port.port.linkSpeedGbps,
          capacityPx: portCapacity(port.port, project.signal).capacityPx,
          usedPx: port.usedPx,
          utilisationPct: Math.round(port.utilisation * 100),
          cabinets: (mapped?.cabinets ?? []).map((c) => ({
            order: c.chainPosition,
            id: c.inst.id,
            model: c.spec.model,
            xPx: c.rect.x,
            yPx: c.rect.y,
            widthPx: c.rect.width,
            heightPx: c.rect.height,
          })),
        };
      }),
    })),
    unpatchedCabinets: map.cabinets
      .filter((c) => !c.chainId)
      .map((c) => c.inst.id),
  };
}

/**
 * A short human-readable brief for whoever is driving LCT or VMP on site.
 *
 * Deliberately terse and printable — this is the thing that gets read on a truck.
 */
export function buildLctBrief(project: Project, map: PixelMap, loads: ProcessorLoad[]): string {
  const lines: string[] = [];
  lines.push(`SCREEN CONFIGURATION — ${project.name}`);
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Signal:      ${project.signal.bitDepth}-bit, ${project.signal.frameRateHz} Hz frame rate`);
  lines.push(`LED refresh: ${project.signal.ledRefreshHz} Hz`);
  lines.push(`Wall:        ${map.width} x ${map.height} px, ${map.cabinets.length} cabinets`);
  if (map.approximate) {
    lines.push('WARNING:     mixed pitch wall — pixel map is approximate.');
  }
  lines.push('');

  for (const load of loads) {
    lines.push('-'.repeat(60));
    lines.push(`${load.processor.name}  (${load.spec.manufacturer} ${load.spec.model})`);
    lines.push(
      `  Device load: ${load.usedPx.toLocaleString()} / ${load.capacityPx.toLocaleString()} px  (${Math.round(load.utilisation * 100)}%)`,
    );
    lines.push('');
    for (const port of load.ports) {
      if (!port.usedPx) continue;
      const chain = map.chains.find((c) => c.chainId === port.chain?.id);
      lines.push(
        `  ${port.port.label.padEnd(8)} ${String(port.cabinets.length).padStart(3)} cabinets  ` +
          `${port.usedPx.toLocaleString().padStart(9)} / ${port.capacityPx.toLocaleString()} px  ` +
          `(${String(Math.round(port.utilisation * 100)).padStart(3)}%)`,
      );
      if (chain) {
        lines.push(
          `           region ${chain.bounds.width} x ${chain.bounds.height} px at (${chain.bounds.x}, ${chain.bounds.y})`,
        );
        lines.push(
          '           order: ' +
            chain.cabinets
              .map((c) => `${c.chainPosition}:(${c.rect.x},${c.rect.y})`)
              .join(' -> '),
        );
      }
      lines.push('');
    }
  }

  const unpatched = map.cabinets.filter((c) => !c.chainId);
  if (unpatched.length) {
    lines.push('-'.repeat(60));
    lines.push(`UNPATCHED: ${unpatched.length} cabinet(s) are not on any port and will be dark.`);
  }

  lines.push('');
  lines.push('Generated by Pixel Peeker. Port capacities are calculated, not measured —');
  lines.push('verify against the controller before the wall goes live.');
  return lines.join('\n') + '\n';
}
