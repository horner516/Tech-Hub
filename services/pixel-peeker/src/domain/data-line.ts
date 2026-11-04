/**
 * Pixel Peeker — how many cabinets one processor port carries, for the Line calc view.
 *
 * NOT A SECOND CAPACITY MODEL. Line Calc, the standalone tool this view replaced
 * (2026-10-11), carried its own copy of the maths in its own data shapes, fed from a
 * dated snapshot of this repo's library. Two copies of a calibrated model is how one of
 * them ends up quietly wrong, so this file only rearranges `portCapacity`,
 * `processorCapacity` and `receiverCheck` into the question a rental desk asks — "how
 * many of these fit on a line?" — and the wall designer and the line calculator cannot
 * disagree. The calibration pins live in capacity.test.ts and nowhere else.
 *
 * What the wrapper adds is rounding to whole cabinets, which is where the answers stop
 * being the same as the pixel figures:
 *
 *   - a cabinet cannot straddle two ports, so each port's cabinets are rounded down on
 *     their own before they are added up;
 *   - the processor's own ceiling (`processorCapacity`, which already takes the smaller
 *     of the port sum, the scaled device cap and any fixed canvas) is then applied in
 *     whole cabinets too.
 *
 * Every processor in the library has identical ports, which is what lets one port stand
 * for the box in "panels per port". data-line.test.ts pins that, so a future controller
 * with mixed ports fails a test rather than being described by its first port.
 */

import {
  maxFrameRateFor,
  portCapacity,
  portEfficiency,
  processorCapacity,
  receiverCheck,
} from './capacity';
import type { CabinetSpec, LinkFormat, PortSpec, ProcessorSpec, ReceivingCardSpec } from './types';

export type PortLimit = 'port-bandwidth' | 'receiving-card';
export type ProcessorLimit = PortLimit | 'device-cap';

export interface DataLineResult {
  /** Cabinets one port carries. */
  panelsPerPort: number;
  /**
   * What bound the PORT. Kept separate from `processorLimitedBy` because they answer
   * different questions and routinely disagree: an MX40 Pro port runs out of bandwidth
   * at 16 of a 200x200 tile, but the box runs out at 225 rather than the 320 its twenty
   * ports could carry. Answering "what is the limit?" with one field forces a choice
   * between two true answers.
   */
  portLimitedBy: PortLimit;
  /** ...and what bound the whole box. */
  processorLimitedBy: ProcessorLimit;
  /** The port the per-port figures describe. */
  port: PortSpec;
  portCount: number;
  portCapacityPx: number;
  /** Wire bits per pixel at this format — 24/32/48 on a container port. */
  bitsPerPixel: number;
  /** Payload fraction of the line rate at this bit depth. */
  efficiency: number;
  panelPixels: number;
  /** Pixels actually used by `panelsPerPort` cabinets, and the share of the port that is. */
  usedPx: number;
  utilisation: number;
  /** Cabinets the whole box carries, once its own ceiling is applied. */
  panelsPerProcessor: number;
  /** `processorCapacity` at this format: never more than the sum of the ports. */
  deviceCapacityPx: number;
  /** Ports the box fills before its own ceiling stops it. */
  portsFilled: number;
  /** Highest frame rate one port sustains with `panelsPerPort` cabinets on it. */
  maxFrameRateHz: number;
  /** Set when the receiving card, not the link, is what stops the cabinet. */
  cardLimit?: { model: string; maxPixels: number; detail: string };
}

export function dataLine(
  cabinet: Pick<CabinetSpec, 'pixelsX' | 'pixelsY'>,
  proc: ProcessorSpec,
  signal: LinkFormat,
  receiver?: ReceivingCardSpec,
): DataLineResult {
  const px = cabinet.pixelsX * cabinet.pixelsY;
  if (!(px > 0)) throw new Error('a cabinet with no pixels has no capacity');
  const port = proc.ports[0];
  if (!port) throw new Error(`${proc.id} has no output ports`);

  const cap = portCapacity(port, signal);

  /* A receiving card caps the pixels behind ONE card, which is one cabinet here, so it
     cannot reduce the cabinets per port — but it can mean the cabinet is undrivable at
     all, which is worth saying rather than silently returning a number. */
  const check = receiver ? receiverCheck(cabinet, receiver) : undefined;
  const cardLimit =
    receiver && check && !check.ok
      ? { model: receiver.model, maxPixels: receiver.maxPixels, detail: check.detail }
      : undefined;

  const panels = cardLimit ? 0 : Math.floor(cap.capacityPx / px);
  const portLimitedBy: PortLimit = cardLimit ? 'receiving-card' : 'port-bandwidth';

  const portsWorth = cardLimit
    ? 0
    : proc.ports.reduce((n, p) => n + Math.floor(portCapacity(p, signal).capacityPx / px), 0);
  const device = processorCapacity(proc, signal);
  const byDevice = Math.floor(device / px);
  const deviceBinds = byDevice < portsWorth;
  const perProcessor = deviceBinds ? byDevice : portsWorth;

  const used = panels * px;

  return {
    panelsPerPort: panels,
    portLimitedBy,
    processorLimitedBy: deviceBinds ? 'device-cap' : portLimitedBy,
    port,
    portCount: proc.ports.length,
    portCapacityPx: cap.capacityPx,
    bitsPerPixel: cap.bitsPerPixel,
    efficiency: portEfficiency(port, signal.bitDepth),
    panelPixels: px,
    usedPx: used,
    utilisation: cap.capacityPx > 0 ? used / cap.capacityPx : 0,
    panelsPerProcessor: perProcessor,
    deviceCapacityPx: device,
    portsFilled: panels > 0 ? Math.ceil(perProcessor / panels) : 0,
    maxFrameRateHz: maxFrameRateFor(port, used, signal.bitDepth),
    ...(cardLimit ? { cardLimit } : {}),
  };
}

export interface WallData {
  /** Ports needed at `panelsPerPort`, rounded up. Zero when nothing fits. */
  ports: number;
  /** Processors needed at `panelsPerProcessor`, rounded up. */
  processors: number;
  /** Processors the port count alone would need, if the boxes had no ceiling of their own. */
  processorsByPorts: number;
  /**
   * More processors are needed than connectors call for: each box's own pixel ceiling
   * stops it before its ports are full, so the extra boxes are there for capacity.
   */
  deviceBound: boolean;
  totalPx: number;
  weightKg: number;
}

/** Ports, processors, pixels and weight for a wall of `panelCount` identical cabinets. */
export function wallData(
  cabinet: Pick<CabinetSpec, 'pixelsX' | 'pixelsY' | 'weightKg'>,
  panelCount: number,
  data: DataLineResult,
): WallData {
  const ports = data.panelsPerPort > 0 ? Math.ceil(panelCount / data.panelsPerPort) : 0;
  const processors = data.panelsPerProcessor > 0 ? Math.ceil(panelCount / data.panelsPerProcessor) : 0;
  const processorsByPorts = data.portCount > 0 ? Math.ceil(ports / data.portCount) : 0;
  return {
    ports,
    processors,
    processorsByPorts,
    deviceBound: processors > processorsByPorts,
    totalPx: panelCount * cabinet.pixelsX * cabinet.pixelsY,
    weightKg: panelCount * cabinet.weightKg,
  };
}
