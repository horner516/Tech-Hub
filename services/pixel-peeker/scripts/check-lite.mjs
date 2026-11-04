/**
 * Assert the lite build really dropped the NovaStar exports.
 *
 * This exists because the first attempt silently did not. The flag was a property on a
 * `FEATURES` object, Rollup would not inline the property read across the module
 * boundary, and the guarded JSX stayed in the bundle — the build log looked identical
 * either way. A feature flag you cannot see failing is worse than no feature flag.
 *
 * Run automatically by `npm run build:lite`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'dist-lite/assets';

/**
 * Strings that must not survive in the lite bundle.
 *
 * Each must be unique to the NovaStar path. "Cabinet schedule" was in this list once and
 * was a false positive — it is also a page heading in the PDF report, which the lite
 * build keeps.
 */
const FORBIDDEN = [
  'LCT / VMP brief',
  'pixel-peeker.interchange/1',
  'order_in_chain',
  'SCREEN CONFIGURATION',
];

/** Strings that must still be there — proof we did not strip too much. */
const REQUIRED = [
  'PDF report',
  'Resolume XML',
  'Save project',
  // The Line calc view has nothing to do with NovaStar exports and ships in both builds.
  'Panels on one circuit',
];

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const bundle = files.map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');

const leaked = FORBIDDEN.filter((s) => bundle.includes(s));
const missing = REQUIRED.filter((s) => !bundle.includes(s));

if (files.some((f) => f.includes('novastar'))) {
  leaked.push('a novastar-*.js chunk was emitted');
}

if (leaked.length || missing.length) {
  console.error('\n✗ lite build is wrong.\n');
  if (leaked.length) {
    console.error('  NovaStar code survived the strip:');
    leaked.forEach((s) => console.error(`    - ${s}`));
    console.error('\n  Check that the flag in src/config/features.ts is still a bare');
    console.error('  top-level const, and that .env.lite is being loaded.');
  }
  if (missing.length) {
    console.error('  Stripped too much — these should still be present:');
    missing.forEach((s) => console.error(`    - ${s}`));
  }
  console.error('');
  process.exit(1);
}

console.log(`✓ lite build verified: NovaStar exports stripped, ${files.length} chunks.`);
