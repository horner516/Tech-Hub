/**
 * End-to-end export tests.
 *
 * Builds a real 16 x 9 wall on a real MX40 Pro, auto-wires it, and runs every export.
 * Set PP_WRITE_ARTEFACTS=<dir> to also drop the generated files on disk for eyeballing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cabinetById } from '../data/cabinets';
import { buildPixelMap } from '../domain/pixelmap';
import type { Project } from '../domain/types';
import { buildGrid, wallStats } from '../domain/wall';
import { autoWire, computeLoads } from '../domain/wiring';
import { processorById } from '../data/processors';
import { buildResolumeXml, buildSliceCsv } from './resolume';
import { buildCabinetScheduleCsv, buildInterchange, buildLctBrief } from './novastar';

const SPEC_ID = 'absen-pl25-pro-v2-novastar';
const lookup = (id: string) => cabinetById(id);
const procLookup = (id: string) => processorById(id);

function makeProject(): Project {
  const spec = cabinetById(SPEC_ID)!;
  let n = 0;
  const project: Project = {
    schema: 'pixel-peeker/1',
    name: 'Test Wall',
    client: 'Acme',
    canvas: { name: 'Main', widthMm: 8000, heightMm: 4500, snapMm: 1 },
    signal: { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 3840 },
    cabinets: buildGrid(spec, 16, 9, 0, 0, () => `cab-${n++}`),
    processors: [{ id: 'p1', specId: 'novastar-mx40-pro', name: 'MX40 Pro 1' }],
    chains: [],
    customCabinets: [],
    customProcessors: [],
    customReceivers: [],
  };
  let c = 0;
  const wired = autoWire(
    project,
    lookup,
    procLookup,
    { pattern: 'serpentine-v', fillTo: 0.9, skipPatched: false },
    () => `chain-${c++}`,
  );
  project.chains = wired.chains;
  return project;
}

describe('exports', () => {
  const project = makeProject();
  const loads = computeLoads(project, lookup, procLookup);
  const map = buildPixelMap(project, lookup, loads);
  const stats = wallStats(project, lookup);

  it('lays the wall out as expected', () => {
    expect(project.cabinets).toHaveLength(144);
    expect(map.width).toBe(3200);
    expect(map.height).toBe(1800);
    expect(stats.totalPixels).toBe(5_760_000);
    expect(map.approximate).toBe(false);
  });

  it('auto-wires every cabinet exactly once', () => {
    const patched = project.chains.flatMap((c) => c.cabinetIds);
    expect(patched).toHaveLength(144);
    expect(new Set(patched).size).toBe(144);
  });

  it('fills each port to the 90% limit but never over capacity', () => {
    const used = loads[0].ports.filter((p) => p.usedPx > 0);
    expect(used.length).toBe(11);
    for (const p of used) {
      expect(p.usedPx).toBeLessThanOrEqual(p.capacityPx);
    }
    // 14 cabinets x 40,000 px is the most that fits under 90% of 659,722.
    expect(used[0].cabinets).toHaveLength(14);
    expect(used[0].usedPx).toBe(560_000);
  });

  it('produces a serpentine chain that reverses direction each column', () => {
    const first = project.chains[0].cabinetIds
      .map((id) => project.cabinets.find((c) => c.id === id)!)
      .map((c) => ({ x: c.xMm, y: c.yMm }));
    // First nine run down column 0.
    expect(first.slice(0, 9).every((p) => p.x === 0)).toBe(true);
    expect(first[0].y).toBe(0);
    expect(first[8].y).toBe(8 * 500);
    // Then it steps across and climbs back up.
    expect(first[9].x).toBe(500);
    expect(first[9].y).toBe(8 * 500);
    expect(first[13].y).toBe(4 * 500);
  });

  it('generates Resolume XML matching the Arena 7.27 schema', () => {
    const xml = buildResolumeXml(project, map, { idBase: 1000 });

    // Preset files wrap the ScreenSetup in an XmlState named for the project.
    expect(xml).toContain('<XmlState name="Test Wall">');
    expect(xml).toContain('name="Resolume Arena" majorVersion="7" minorVersion="27"');
    expect(xml).toContain(
      `<CurrentCompositionTextureSize width="3200" height="1800"/>`,
    );

    // One screen per processor, one slice per used port.
    expect(xml.match(/<Screen /g)).toHaveLength(1);
    expect(xml.match(/<Slice /g)).toHaveLength(11);

    // The structures that the naive doc-derived version was missing.
    expect(xml.match(/<BezierWarper controlWidth="4" controlHeight="4">/g)).toHaveLength(11);
    expect(xml.match(/<Homography>/g)).toHaveLength(11);
    expect(xml).toContain('<OutputDeviceVirtual');
    // Rects are vertex lists, not x/y/width/height attributes.
    expect(xml).not.toContain('<Rectangle');
    expect(xml).toMatch(/<InputRect orientation="0">\s*<v x=/);

    // uniqueIds must actually be unique within the file.
    const ids = [...xml.matchAll(/uniqueId="(\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(12); // 1 screen + 11 slices
    expect(new Set(ids).size).toBe(ids.length);

    // Every opened tag is closed — a crude but effective well-formedness check.
    for (const tag of ['XmlState', 'ScreenSetup', 'screens', 'Screen', 'layers', 'Slice', 'Warper']) {
      expect(xml.match(new RegExp(`<${tag}[ >]`, 'g'))?.length).toBe(
        xml.match(new RegExp(`</${tag}>`, 'g'))?.length,
      );
    }
  });

  it('maps the first port to its real pixel region, output rect 0-based', () => {
    const xml = buildResolumeXml(project, map, { idBase: 1000 });
    // ETH 1 covers columns 0-1: 400 x 1800 px at the origin, so input and output
    // rects coincide for a single-processor wall anchored at 0,0.
    expect(xml).toContain(
      '<v x="0" y="0"/>\n\t\t\t\t\t\t\t<v x="400" y="0"/>\n\t\t\t\t\t\t\t<v x="400" y="1800"/>\n\t\t\t\t\t\t\t<v x="0" y="1800"/>',
    );
    expect(xml).toContain('width="3200" height="1800"/>'); // virtual output device
  });

  it('writes a cabinet schedule with a row per cabinet plus a header', () => {
    const csv = buildCabinetScheduleCsv(map);
    expect(csv.trim().split('\n')).toHaveLength(145);
    expect(csv).toContain('order_in_chain');
  });

  it('carries the capacity workings into the interchange doc', () => {
    const doc = buildInterchange(project, map, loads);
    expect(doc.format).toBe('pixel-peeker.interchange/1');
    expect(doc.capacityModel.wireBitsPerPixel).toBe(24);
    expect(doc.processors[0].ports.filter((p) => p.usedPx > 0)).toHaveLength(11);
    expect(doc.unpatchedCabinets).toHaveLength(0);
  });

  it('builds the LCT brief', () => {
    const brief = buildLctBrief(project, map, loads);
    expect(brief).toContain('SCREEN CONFIGURATION — Test Wall');
    expect(brief).toContain('3200 x 1800 px');
  });

  it('builds a PDF report', async () => {
    const { buildReport } = await import('./pdf');
    const doc = buildReport({
      project,
      stats,
      map,
      loads,
      issues: [],
      cabinetSpec: lookup,
    });
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(5000);
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe('%PDF-');
    // The power section is on by default, costed at 16 A / 230 V / 80%: 170 W PL2.5 Pro
    // cabinets are 17 to a circuit, so 144 of them need 9. jsPDF writes text uncompressed.
    const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));
    expect(text).toContain('Power circuits');
    expect(text).toContain('9 × 16 A on 230 V single phase');

    const outDir = process.env.PP_WRITE_ARTEFACTS;
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/report.pdf`, Buffer.from(bytes));
      writeFileSync(`${outDir}/screensetup.xml`, buildResolumeXml(project, map));
      writeFileSync(`${outDir}/slices.csv`, buildSliceCsv(map));
      writeFileSync(`${outDir}/cabinet-schedule.csv`, buildCabinetScheduleCsv(map));
      writeFileSync(`${outDir}/brief.txt`, buildLctBrief(project, map, loads));
      writeFileSync(
        `${outDir}/interchange.json`,
        JSON.stringify(buildInterchange(project, map, loads), null, 2),
      );
    }
  });
});
