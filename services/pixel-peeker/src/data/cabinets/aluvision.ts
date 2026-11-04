import type { CabinetSpec } from '../../domain/types';

const ALUVISION_SOURCE = 'Aluvision Hi-LED 55 brochure (via psco.co.uk), spec page 23';
const ALUVISION_SOURCE_WITH_SCAN = `${ALUVISION_SOURCE}; scan rate from the US edition 2025-03 (via exhibitoronline.com), spec page 23`;

/**
 * Aluvision Hi-LED 55.
 * Note the 496 mm tile, not 500 — Aluvision's frame system is built on 496 and it
 * will not interleave with 500 mm cabinets on the same wall without a gap.
 *
 * These four are the whole straight range as of the 2024 EU and 2025 US brochures (the
 * 2.8 has been dropped from the US edition). Scan rates come from the US edition, which
 * is the only one to print them; the 2.8's is not printed anywhere.
 */
const ALUVISION: CabinetSpec[] = [
  {
    id: 'aluvision-hiled55-19',
    manufacturer: 'Aluvision',
    series: 'Hi-LED 55',
    model: 'Hi-LED 55 1.9',
    pixelPitchMm: 1.9,
    widthMm: 496, heightMm: 496, depthMm: 55,
    pixelsX: 256, pixelsY: 256,
    weightKg: 9.5,
    powerMaxW: 120, powerAvgW: 40,
    scanRate: 16,
    maxRefreshHz: 7680,
    greyscaleBits: 16,
    brightnessNits: 1000,
    receivingCardId: 'novastar-a10s-pro',
    verified: true,
    source: ALUVISION_SOURCE_WITH_SCAN,
  },
  {
    id: 'aluvision-hiled55-25',
    manufacturer: 'Aluvision',
    series: 'Hi-LED 55',
    model: 'Hi-LED 55 2.5',
    pixelPitchMm: 2.58,
    widthMm: 496, heightMm: 496, depthMm: 55,
    pixelsX: 192, pixelsY: 192,
    weightKg: 9.5,
    powerMaxW: 150, powerAvgW: 50,
    scanRate: 24,
    maxRefreshHz: 3840,
    greyscaleBits: 14,
    brightnessNits: 1000,
    receivingCardId: 'novastar-a8s',
    verified: true,
    source: ALUVISION_SOURCE_WITH_SCAN,
  },
  {
    id: 'aluvision-hiled55-28',
    manufacturer: 'Aluvision',
    series: 'Hi-LED 55',
    model: 'Hi-LED 55 2.8',
    pixelPitchMm: 2.82,
    widthMm: 496, heightMm: 496, depthMm: 55,
    pixelsX: 176, pixelsY: 176,
    weightKg: 9.0,
    powerMaxW: 145, powerAvgW: 49,
    maxRefreshHz: 3840,
    greyscaleBits: 14,
    brightnessNits: 1000,
    receivingCardId: 'novastar-a4s',
    verified: true,
    source: ALUVISION_SOURCE,
  },
  {
    id: 'aluvision-hiled55-39',
    manufacturer: 'Aluvision',
    series: 'Hi-LED 55',
    model: 'Hi-LED 55 3.9',
    pixelPitchMm: 3.88,
    widthMm: 496, heightMm: 496, depthMm: 62,
    pixelsX: 128, pixelsY: 128,
    weightKg: 9.1,
    powerMaxW: 130, powerAvgW: 43,
    scanRate: 8,
    maxRefreshHz: 3840,
    greyscaleBits: 16,
    brightnessNits: 4500,
    receivingCardId: 'novastar-a5s-plus',
    verified: true,
    source: ALUVISION_SOURCE_WITH_SCAN,
    notes: 'Indoor/outdoor. Deeper tile (62 mm) than the rest of the range.',
  },
];

const ALUVISION_PRO_SOURCE =
  'Aluvision Hi-LED pro P1.9 / Hi-LED+ pro P1.9 Specifications V20250211 (via psco.co.uk)';

/**
 * Aluvision Hi-LED pro — the 2025 chassis, with the tile's specification sheet in Absen's
 * house format (Aluvision's tiles are built for them). Aluvision keep their own datasheets
 * behind an extranet login; PSCo, their UK distributor, mirrors the sheets. The Hi-LED pro
 * P1.5 (flip-chip IMD, US launch October 2025) has no public specification yet.
 */
export const ALUVISION_PRO: CabinetSpec[] = [
  // Hi-LED pro P1.9
  // IMD 4-in-1 LEDs, 144 Hz max frame rate, A10s Pro fitted, IP40/IP21. 495.9 mm square,
  // so it sits in the 496 mm Omni-55 frame like the rest of the Hi-LED family.
  {
    id: 'aluvision-hiled-pro-19',
    manufacturer: 'Aluvision',
    series: 'Hi-LED pro',
    model: 'Hi-LED pro P1.9',
    pixelPitchMm: 1.9,
    widthMm: 495.9, heightMm: 495.9, depthMm: 55,
    pixelsX: 256, pixelsY: 256,
    weightKg: 8.2,
    powerMaxW: 118, powerAvgW: 39.3,
    scanRate: 16,
    maxRefreshHz: 7680,
    greyscaleBits: 16,
    brightnessNits: 1000,
    receivingCardId: 'novastar-a10s-pro',
    verified: true,
    source: ALUVISION_PRO_SOURCE,
    notes: 'The lighter chassis with integrated connectors and one-step quick lock.',
  },
  {
    id: 'aluvision-hiled-plus-pro-19',
    manufacturer: 'Aluvision',
    series: 'Hi-LED pro',
    model: 'Hi-LED+ pro P1.9',
    pixelPitchMm: 1.9,
    widthMm: 495.9, heightMm: 495.9, depthMm: 55,
    pixelsX: 256, pixelsY: 256,
    weightKg: 9.7,
    powerMaxW: 118, powerAvgW: 39.3,
    scanRate: 16,
    maxRefreshHz: 7680,
    greyscaleBits: 16,
    brightnessNits: 1000,
    receivingCardId: 'novastar-a10s-pro',
    verified: true,
    source: ALUVISION_PRO_SOURCE,
    notes: 'The "+" chassis: chamfered edges for seamless corners and cubes, fully compatible with the straight pro tile.',
  },
];

export const ALUVISION_CABINETS: CabinetSpec[] = [...ALUVISION, ...ALUVISION_PRO];
