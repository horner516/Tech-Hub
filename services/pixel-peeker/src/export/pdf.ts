/**
 * Pixel Peeker — PDF report.
 *
 * The report is the deliverable that leaves the office, so it states its own
 * assumptions: the signal format everything was calculated at, which library records
 * are unverified, and that capacities are calculated rather than measured. A report
 * that hides those things is worse than no report.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PixelMap } from '../domain/pixelmap';
import { resolvePowerPlan, wallCircuits } from '../domain/power-line';
import type { CabinetSpec, Project } from '../domain/types';
import type { Issue, WallStats } from '../domain/wall';
import { chainColour } from '../domain/wiring';
import type { ProcessorLoad } from '../domain/wiring';

const INK = '#111827';
const MUTED = '#6b7280';
const ACCENT = '#0b6fb5';

interface ReportInput {
  project: Project;
  stats: WallStats;
  map: PixelMap;
  loads: ProcessorLoad[];
  issues: Issue[];
  cabinetSpec: (id: string) => CabinetSpec | undefined;
}

function header(doc: jsPDF, project: Project, title: string, page: number) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, w, 16, 'F');
  doc.setTextColor('#ffffff');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PIXEL PEEKER', 12, 10.5);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 48, 10.5);
  doc.text(project.name, w - 12, 10.5, { align: 'right' });
  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(
    `Page ${page}`,
    w - 12,
    doc.internal.pageSize.getHeight() - 8,
    { align: 'right' },
  );
  doc.setTextColor(INK);
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text(text, 12, y);
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(0.4);
  doc.line(12, y + 1.5, doc.internal.pageSize.getWidth() - 12, y + 1.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  return y + 8;
}

/** Draw the wall to scale, coloured by port, with chain order numbers. */
function drawWall(
  doc: jsPDF,
  map: PixelMap,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
) {
  if (!map.cabinets.length) return y;

  const wallW = Math.max(...map.cabinets.map((c) => c.rect.x + c.rect.width));
  const wallH = Math.max(...map.cabinets.map((c) => c.rect.y + c.rect.height));
  const scale = Math.min(maxW / wallW, maxH / wallH);

  const colourOf = new Map<string, string>();
  map.chains.forEach((c, i) => colourOf.set(c.chainId, chainColour(i)));

  doc.setLineWidth(0.15);
  for (const cab of map.cabinets) {
    const cx = x + cab.rect.x * scale;
    const cy = y + cab.rect.y * scale;
    const cw = cab.rect.width * scale;
    const ch = cab.rect.height * scale;

    const fill = cab.chainId ? colourOf.get(cab.chainId)! : '#d1d5db';
    doc.setFillColor(fill);
    doc.setDrawColor('#ffffff');
    doc.rect(cx, cy, cw, ch, 'FD');

    if (cab.chainPosition && cw > 5) {
      doc.setTextColor('#1f2937');
      doc.setFontSize(Math.min(7, cw * 0.35));
      doc.text(String(cab.chainPosition), cx + cw / 2, cy + ch / 2 + 1, {
        align: 'center',
      });
    }
  }

  doc.setTextColor(MUTED);
  doc.setFontSize(8);
  doc.text(
    `${wallW} x ${wallH} px — cabinets coloured by output port, numbered in sending order`,
    x,
    y + wallH * scale + 5,
  );
  doc.setTextColor(INK);
  return y + wallH * scale + 10;
}

export function buildReport(input: ReportInput): jsPDF {
  const { project, stats, map, loads, issues, cabinetSpec } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  let page = 1;
  const power = wallCircuits(stats.byModel, resolvePowerPlan(project.power));
  const circuitBasis =
    `${power.input.breakerAmps} A on ${power.input.supply.label}` +
    (power.input.derate < 1 ? ', derated to 80%' : ', full breaker rating');

  // ---------------------------------------------------------------- page 1
  header(doc, project, 'System report', page);
  let y = 28;

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(project.name, 12, y);
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED);
  const meta = [
    project.client && `Client: ${project.client}`,
    project.venue && `Venue: ${project.venue}`,
    project.designer && `Designer: ${project.designer}`,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join('   •   ');
  doc.text(meta, 12, y);
  doc.setTextColor(INK);
  y += 10;

  y = sectionTitle(doc, 'Signal format', y);
  // Measure the wrapped height rather than assuming one line — at some page widths
  // and frame rates this runs to two, and a fixed advance overlaps the next heading.
  const signalText = doc.splitTextToSize(
    `All capacities below are calculated at ${project.signal.bitDepth}-bit colour, ` +
      `${project.signal.frameRateHz} Hz frame rate, ${project.signal.ledRefreshHz} Hz LED refresh. ` +
      `Change any of these and the port loading changes.`,
    pageW - 24,
  ) as string[];
  doc.text(signalText, 12, y);
  y += signalText.length * 4.2 + 6;

  y = sectionTitle(doc, 'Wall', y);
  const summaryRows: [string, string][] = [
    ['Cabinets', String(stats.cabinetCount)],
    [
      'Physical size',
      stats.boundsMm
        ? `${(stats.boundsMm.widthMm / 1000).toFixed(2)} × ${(stats.boundsMm.heightMm / 1000).toFixed(2)} m`
        : '—',
    ],
    [
      'Resolution',
      stats.boundingPixels
        ? `${stats.boundingPixels.width} × ${stats.boundingPixels.height} px`
        : '—',
    ],
    ['Active pixels', stats.totalPixels.toLocaleString()],
    ['Area', `${stats.areaSqm.toFixed(2)} m²`],
    ['Weight', `${stats.totalWeightKg.toFixed(1)} kg`],
    ['Power (peak)', `${(stats.powerMaxW / 1000).toFixed(2)} kW`],
    ['Power (average)', `${(stats.powerAvgW / 1000).toFixed(2)} kW`],
    [
      'Peak current, 1ø',
      `${stats.peakAmps230.toFixed(1)} A @ 230 V  /  ${stats.peakAmps110.toFixed(1)} A @ 110 V`,
    ],
    [
      'Peak current, 3ø',
      `${(stats.peakAmps230 / 3).toFixed(1)} A per phase @ 230 V  /  ` +
        `${(stats.peakAmps110 / 3).toFixed(1)} A per phase @ 110 V`,
    ],
    [
      'Power circuits',
      power.circuits
        ? `${power.circuits} × ${circuitBasis}` +
          (power.input.supply.phases === 3 ? ` (${power.supplies} three-phase supplies)` : '')
        : '—',
    ],
    ['Reference pitch', `${Number(stats.referencePitchMm.toFixed(4))} mm`],
  ];
  if (stats.fillRatio < 0.999) {
    summaryRows.push([
      'Coverage',
      `${Math.round(stats.fillRatio * 100)}% of bounding box (irregular wall)`,
    ]);
  }

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { cellWidth: 45, textColor: MUTED }, 1: { fontStyle: 'bold' } },
    body: summaryRows,
    margin: { left: 12, right: 12 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  y = sectionTitle(doc, 'Layout', y);
  drawWall(doc, map, 12, y, pageW - 24, 110);

  // ---------------------------------------------------------------- page 2
  doc.addPage();
  page++;
  header(doc, project, 'Cabinet schedule', page);
  y = 26;

  y = sectionTitle(doc, 'Cabinets used', y);
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: { fillColor: ACCENT, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.5 },
    head: [['Qty', 'Manufacturer', 'Model', 'Pitch', 'Resolution', 'Size (mm)', 'Weight', 'Peak power', 'Data']],
    body: stats.byModel.map((r) => [
      String(r.count),
      r.spec.manufacturer,
      r.spec.model,
      `${r.spec.pixelPitchMm} mm`,
      `${r.spec.pixelsX}×${r.spec.pixelsY}`,
      `${r.spec.widthMm}×${r.spec.heightMm}×${r.spec.depthMm}`,
      `${(r.spec.weightKg * r.count).toFixed(1)} kg`,
      `${((r.spec.powerMaxW * r.count) / 1000).toFixed(2)} kW`,
      r.spec.verified ? 'datasheet' : 'UNVERIFIED',
    ]),
    margin: { left: 12, right: 12 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 8 && data.cell.raw === 'UNVERIFIED') {
        data.cell.styles.textColor = '#b45309';
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  if (power.rows.length) {
    y = sectionTitle(doc, `Power circuits — ${circuitBasis}, peak`, y);
    autoTable(doc, {
      startY: y,
      theme: 'striped',
      headStyles: { fillColor: ACCENT, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 1.5 },
      head: [['Model', 'Qty', 'Peak per cabinet', 'Cabinets per circuit', 'Circuits']],
      body: power.rows.map((r) => [
        `${r.spec.manufacturer} ${r.spec.model}`,
        String(r.count),
        `${r.spec.powerMaxW} W`,
        r.panelsPerCircuit ? String(r.panelsPerCircuit) : 'NONE FIT',
        r.circuits ? String(r.circuits) : '—',
      ]),
      margin: { left: 12, right: 12 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3 && data.cell.raw === 'NONE FIT') {
          data.cell.styles.textColor = '#b91c1c';
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    const powerNote = doc.splitTextToSize(
      `Cabinets per circuit = breaker × derating ÷ (peak W ÷ ${power.input.supply.volts} V phase voltage), ` +
        'each model counted on runs of its own. Steady state only: inrush at switch-on is not modelled, ' +
        'which is why a wall is powered up in sections. Sizing a circuit is a job for whoever signs off the distro.',
      pageW - 24,
    ) as string[];
    doc.text(powerNote, 12, y);
    doc.setTextColor(INK);
    y += powerNote.length * 3.6 + 6;
  }

  const unverified = stats.byModel.filter((r) => !r.spec.verified);
  if (unverified.length) {
    doc.setFontSize(8);
    doc.setTextColor('#b45309');
    doc.text(
      'UNVERIFIED means at least one figure for that cabinet has not been confirmed against a manufacturer ' +
        'datasheet. Confirm before using this report to size distro or rigging.',
      12,
      y,
      { maxWidth: pageW - 24 },
    );
    doc.setTextColor(INK);
    y += 10;
  }

  // ---------------------------------------------------------------- page 3
  doc.addPage();
  page++;
  header(doc, project, 'Processing and port loading', page);
  y = 26;

  for (const load of loads) {
    y = sectionTitle(doc, `${load.processor.name} — ${load.spec.manufacturer} ${load.spec.model}`, y);
    doc.setFontSize(9);
    doc.text(
      `Device load ${load.usedPx.toLocaleString()} / ${load.capacityPx.toLocaleString()} px ` +
        `(${Math.round(load.utilisation * 100)}%)`,
      12,
      y,
    );
    y += 5;

    autoTable(doc, {
      startY: y,
      theme: 'striped',
      headStyles: { fillColor: ACCENT, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 1.4 },
      head: [['Port', 'Link', 'Cabinets', 'Pixels', 'Capacity', 'Used', 'Headroom', 'Max fps']],
      body: load.ports
        .filter((p) => p.usedPx > 0)
        .map((p) => [
          p.port.label,
          `${p.port.linkSpeedGbps} G`,
          String(p.cabinets.length),
          p.usedPx.toLocaleString(),
          p.capacityPx.toLocaleString(),
          `${Math.round(p.utilisation * 100)}%`,
          p.headroomPx.toLocaleString(),
          Number.isFinite(p.maxFrameRateHz) ? p.maxFrameRateHz.toFixed(0) : '—',
        ]),
      margin: { left: 12, right: 12 },
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 5) return;
        const pct = parseInt(String(data.cell.raw), 10);
        if (pct > 100) {
          data.cell.styles.textColor = '#b91c1c';
          data.cell.styles.fontStyle = 'bold';
        } else if (pct > 90) {
          data.cell.styles.textColor = '#b45309';
        }
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    if (y > 240) {
      doc.addPage();
      page++;
      header(doc, project, 'Processing and port loading', page);
      y = 26;
    }
  }

  // ---------------------------------------------------------------- issues
  doc.addPage();
  page++;
  header(doc, project, 'Design checks', page);
  y = 26;
  y = sectionTitle(doc, 'Design checks', y);

  if (!issues.length) {
    doc.text('No issues found.', 12, y);
  } else {
    autoTable(doc, {
      startY: y,
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' },
      columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' } },
      head: [['Severity', 'Finding']],
      headStyles: { fillColor: ACCENT, fontSize: 8, textColor: '#ffffff' },
      body: issues.map((i) => [i.severity.toUpperCase(), i.message]),
      margin: { left: 12, right: 12 },
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const s = String(data.cell.raw);
        if (s === 'ERROR') data.cell.styles.textColor = '#b91c1c';
        else if (s === 'WARNING') data.cell.styles.textColor = '#b45309';
        else data.cell.styles.textColor = MUTED;
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(
    [
      'Method: port capacity = link rate × efficiency ÷ wire bits per pixel ÷ frame rate.',
      'Pixels are packed into power-of-two containers (8-bit = 24, 10-bit = 32, 12-bit = 48 bits per pixel),',
      'which reproduces NovaStar’s published MX40 Pro per-port figures exactly. LED refresh rate does not',
      'consume link bandwidth; it is checked separately against the panel’s quoted refresh.',
      '',
      'All figures are calculated, not measured. Verify against the controller before the wall goes live.',
    ].join('\n'),
    12,
    Math.max(y, 250),
    { maxWidth: pageW - 24 },
  );

  void cabinetSpec;
  return doc;
}
