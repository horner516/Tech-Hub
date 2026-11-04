/**
 * Pixel Peeker — Resolume Arena "Advanced Output" export.
 *
 * SCHEMA PROVENANCE
 * =================
 * The element names, attribute names, nesting and number formatting here were read
 * off two REAL files written by Resolume Arena 7.27.0 (rev 14395):
 *
 *   ~/Documents/Resolume Arena/Preferences/AdvancedOutput.xml
 *   ~/Documents/Resolume Arena/Presets/Advanced Output/output_map_1.xml
 *
 * They are NOT guessed from documentation. The schema was reverse-engineered for the
 * sibling project `blend-calc` (see its docs/resolume-export.md for the annotated
 * source files); this module reuses that verified structure with an LED-specific
 * layout. An earlier version of this file was written from Resolume's public docs and
 * was substantially wrong — it had no vertex lists, no Warper, no OutputDevice and no
 * uniqueIds. Do not "simplify" back towards that.
 *
 * STILL WORTH CHECKING: the schema is verified, but this particular arrangement
 * (many slices inside one screen, one screen per processor) has not itself been
 * loaded into a running Arena. The slice CSV alongside carries no format risk.
 *
 * WHAT THIS WRITES
 * ================
 * One `<Screen>` per processor — a processor is fed by one physical video output from
 * the media server, so it is the natural unit of "screen".
 *
 * One `<Slice>` per output port, inside that screen. That makes each port's block of
 * pixels independently positionable, which is the unit an operator actually moves when
 * a port gets re-patched.
 *
 *   InputRect     the port's region of the composition, in composition pixels
 *   OutputRect    where that region sits within the processor's raster, 0-based
 *   Warper        identity 4x4 Bezier grid + identity homography, so every control
 *                 point starts exactly on the output rect
 *   OutputDevice  a Virtual device sized to the processor's raster. A real display's
 *                 deviceId and idHash are properties of the machine Resolume runs on
 *                 and cannot be synthesised — assign each screen to a physical output
 *                 once loaded.
 */

import type { MappedChain, PixelMap } from '../domain/pixelmap';
import type { Project } from '../domain/types';

const ARENA_VERSION = {
  name: 'Resolume Arena',
  majorVersion: 7,
  minorVersion: 27,
  microVersion: 0,
  revision: 14395,
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Resolume writes plain decimals, and integers without a decimal point. */
function n(v: number): string {
  const r = Math.abs(v) < 1e-9 ? 0 : v;
  return Number.isInteger(r) ? String(r) : String(Number(r.toFixed(6)));
}

/** Clockwise from top-left, matching how Arena writes InputRect/OutputRect. */
function rect(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function vertsXml(pts: { x: number; y: number }[], indent: string): string {
  return pts.map((p) => `${indent}<v x="${n(p.x)}" y="${n(p.y)}"/>`).join('\n');
}

/**
 * A 4x4 identity Bezier control grid over the output rect, written row-major with y
 * increasing — the ordering Arena uses for an unrotated slice.
 */
function bezierGrid(x0: number, y0: number, x1: number, y1: number) {
  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      pts.push({
        x: x0 + ((x1 - x0) * c) / 3,
        y: y0 + ((y1 - y0) * r) / 3,
      });
    }
  }
  return pts;
}

function sliceXml(
  chain: MappedChain,
  origin: { x: number; y: number },
  sliceId: number,
  ind: string,
): string {
  const i = (k: number) => ind + '\t'.repeat(k);
  const b = chain.bounds;
  const inputPts = rect(b.x, b.y, b.x + b.width, b.y + b.height);
  // Output is the same region, relative to this processor's own raster.
  const ox = b.x - origin.x;
  const oy = b.y - origin.y;
  const outputPts = rect(ox, oy, ox + b.width, oy + b.height);
  const bezier = bezierGrid(ox, oy, ox + b.width, oy + b.height);
  const name = `${chain.processorName} ${chain.portLabel}`;

  return `${i(0)}<Slice uniqueId="${sliceId}">
${i(1)}<Params name="Common">
${i(2)}<Param name="Name" T="STRING" default="Layer" value="${esc(name)}"/>
${i(2)}<Param name="Enabled" T="BOOL" default="1" value="1"/>
${i(1)}</Params>
${i(1)}<Params name="Input">
${i(2)}<ParamChoice name="Input Source" default="0:1" value="0:1" storeChoices="0"/>
${i(1)}</Params>
${i(1)}<Params name="Output">
${i(2)}<Param name="Flip" T="UINT8" default="0" value="0"/>
${i(1)}</Params>
${i(1)}<InputRect orientation="0">
${vertsXml(inputPts, i(2))}
${i(1)}</InputRect>
${i(1)}<OutputRect orientation="0">
${vertsXml(outputPts, i(2))}
${i(1)}</OutputRect>
${i(1)}<Warper>
${i(2)}<Params name="Warper">
${i(3)}<ParamChoice name="Point Mode" default="PM_LINEAR" value="PM_LINEAR" storeChoices="0"/>
${i(3)}<Param name="Flip" T="UINT8" default="0" value="0"/>
${i(2)}</Params>
${i(2)}<BezierWarper controlWidth="4" controlHeight="4">
${i(3)}<vertices>
${vertsXml(bezier, i(4))}
${i(3)}</vertices>
${i(2)}</BezierWarper>
${i(2)}<Homography>
${i(3)}<src>
${vertsXml(outputPts, i(4))}
${i(3)}</src>
${i(3)}<dst>
${vertsXml(outputPts, i(4))}
${i(3)}</dst>
${i(2)}</Homography>
${i(1)}</Warper>
${i(0)}</Slice>`;
}

function screenXml(
  screenName: string,
  chains: MappedChain[],
  screenId: number,
  nextId: () => number,
  ind: string,
): string {
  const i = (k: number) => ind + '\t'.repeat(k);

  // The processor's raster is the bounding box of everything it drives.
  const x0 = Math.min(...chains.map((c) => c.bounds.x));
  const y0 = Math.min(...chains.map((c) => c.bounds.y));
  const x1 = Math.max(...chains.map((c) => c.bounds.x + c.bounds.width));
  const y1 = Math.max(...chains.map((c) => c.bounds.y + c.bounds.height));
  const width = x1 - x0;
  const height = y1 - y0;

  const slices = chains
    .map((c) => sliceXml(c, { x: x0, y: y0 }, nextId(), ind + '\t\t'))
    .join('\n');

  return `${i(0)}<Screen name="${esc(screenName)}" uniqueId="${screenId}">
${i(1)}<Params name="Params">
${i(2)}<Param name="Name" T="STRING" default="" value="${esc(screenName)}"/>
${i(2)}<Param name="Enabled" T="BOOL" default="1" value="1"/>
${i(2)}<Param name="Hidden" T="BOOL" default="0" value="0"/>
${i(1)}</Params>
${i(1)}<guides>
${i(2)}<ScreenGuide name="ScreenGuide" type="0"/>
${i(2)}<ScreenGuide name="ScreenGuide" type="1"/>
${i(1)}</guides>
${i(1)}<layers>
${slices}
${i(1)}</layers>
${i(1)}<OutputDevice>
${i(2)}<OutputDeviceVirtual name="${esc(screenName)}" deviceId="Virtual${esc(
    screenName,
  )}" width="${width}" height="${height}"/>
${i(1)}</OutputDevice>
${i(0)}</Screen>`;
}

export interface ResolumeOptions {
  /**
   * `preset`      -> a file for Presets/Advanced Output/ (root <XmlState>)
   * `preferences` -> a drop-in AdvancedOutput.xml (root <ScreenSetup>)
   */
  target?: 'preset' | 'preferences';
  /** Base for the generated uniqueIds. Injectable so tests are deterministic. */
  idBase?: number;
}

export function buildResolumeXml(
  project: Project,
  map: PixelMap,
  options: ResolumeOptions = {},
): string {
  const target = options.target ?? 'preset';
  const projectName = project.name.trim() || 'Pixel Peeker';

  // Group the chains by processor — one screen each.
  const groups = new Map<string, MappedChain[]>();
  for (const chain of map.chains) {
    if (!groups.has(chain.processorId)) groups.set(chain.processorId, []);
    groups.get(chain.processorId)!.push(chain);
  }

  // Ids only have to be unique within the file. Real Arena files use epoch-ish
  // millisecond values; a fixed base keeps the export reproducible.
  const base = options.idBase ?? 1800000000000;
  let seq = 0;
  const nextId = () => base + seq++;

  const v = ARENA_VERSION;
  const versionInfo =
    `<versionInfo name="${v.name}" majorVersion="${v.majorVersion}" ` +
    `minorVersion="${v.minorVersion}" microVersion="${v.microVersion}" revision="${v.revision}"/>`;

  const indent = target === 'preset' ? '\t\t\t' : '\t\t';
  const screens = [...groups.entries()]
    .map(([, chains]) =>
      screenXml(chains[0].processorName, chains, nextId(), nextId, indent),
    )
    .join('\n');

  if (target === 'preset') {
    return `<?xml version="1.0" encoding="utf-8"?>
<XmlState name="${esc(projectName)}">
\t${versionInfo}
\t<ScreenSetup name="ScreenSetup">
\t\t<Params name="ScreenSetupParams"/>
\t\t<CurrentCompositionTextureSize width="${map.width}" height="${map.height}"/>
\t\t<screens>
${screens}
\t\t</screens>
\t</ScreenSetup>
</XmlState>
`;
  }

  // Arena writes the SoftEdging block only in the preferences file.
  const softEdging = [
    `<SoftEdging>`,
    `\t<Params name="Soft Edge">`,
    `\t\t<ParamRange name="Power" T="DOUBLE" default="2" value="2">`,
    `\t\t\t<PhaseSourceStatic name="PhaseSourceStatic"/>`,
    `\t\t</ParamRange>`,
    `\t</Params>`,
    `</SoftEdging>`,
  ];

  return `<?xml version="1.0" encoding="utf-8"?>
<ScreenSetup name="ScreenSetup">
\t${versionInfo}
\t<CurrentCompositionTextureSize width="${map.width}" height="${map.height}"/>
\t<screens>
${screens}
\t</screens>
\t${softEdging.join('\n\t')}
</ScreenSetup>
`;
}

/**
 * A plain slice list, in the same geometry as the XML.
 *
 * This one carries no format risk: if the XML does not import, an operator can build
 * the same mapping by hand in a couple of minutes from this table.
 */
export function buildSliceCsv(map: PixelMap): string {
  const rows = [
    ['slice_name', 'processor', 'port', 'x', 'y', 'width', 'height', 'pixels', 'port_utilisation_pct'],
    ...map.chains.map((c) => [
      `${c.processorName} ${c.portLabel}`,
      c.processorName,
      c.portLabel,
      c.bounds.x,
      c.bounds.y,
      c.bounds.width,
      c.bounds.height,
      c.pixels,
      Math.round(c.utilisation * 100),
    ]),
  ];
  return rows.map((r) => r.join(',')).join('\n') + '\n';
}
