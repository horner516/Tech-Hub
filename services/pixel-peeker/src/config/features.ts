/**
 * Build-time feature flags.
 *
 * These are compile-time constants, not runtime settings. Vite substitutes
 * `import.meta.env.VITE_*` literally at build time, so a disabled flag collapses to
 * `false` and Rollup drops the guarded branch — including any module that is only
 * reachable from inside it. That is why the export handlers use dynamic `import()`:
 * it keeps the disabled code genuinely out of the bundle rather than merely hidden.
 *
 * Builds
 * ------
 *   npm run build         full app          (all flags on)
 *   npm run build:lite    "lite" variant    (reads .env.lite)
 *
 * The lite variant exists because the NovaStar side is honest-but-awkward to explain:
 * it hands you a cabinet schedule and a config brief rather than the .scr / .nprj files
 * people actually expect, because the VMP port mapping is still ambiguous (see
 * docs/novastar-vmp-format.md). Until that is resolved, the lite build ships the design
 * tool, the PDF report and the Resolume export. The Resolume export still has its own
 * caveat: the schema is verified, but no file it writes has been opened in a running Arena.
 *
 * When the VMP format is unblocked, delete the flag rather than leaving it lying around.
 */

/**
 * NovaStar-oriented exports: cabinet schedule CSV, LCT/VMP config brief, and the JSON
 * interchange document.
 *
 * MUST be a bare top-level `const` boolean, not a property on a `FEATURES` object.
 * Rollup folds `const X = <literal expression>` and then eliminates `X && …`, but it
 * will not reliably inline a property read across a module boundary — the first
 * version of this file used an object and the guarded code stayed in the bundle.
 * `npm run build:lite` asserts the stripping actually happened; see scripts/check-lite.mjs.
 */
export const NOVASTAR_EXPORTS = import.meta.env.VITE_NOVASTAR_EXPORTS !== 'false';
