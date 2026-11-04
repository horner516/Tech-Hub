import type { CtaExtension, DisplayIdExtension, Edid } from './edid/types.ts'
import type { Timing } from './timing/types.ts'

/**
 * The one timing an EDID is really about.
 *
 * Search order matters and is not arbitrary: DisplayID first, because a mode
 * that needs DisplayID is by definition one a DTD could not hold, so if a
 * DisplayID block exists it describes the FASTEST mode present. Then the first
 * base-block DTD, which EDID 1.4 defines as the preferred timing. Then a CTA
 * detailed timing.
 */
export function primaryTiming(e: Edid): Timing | null {
  for (const ext of e.extensions) {
    if (ext.kind === 'displayid') {
      const d = ext as DisplayIdExtension
      const all = [...(d.type1Timings ?? []), ...d.type7Timings]
      const pref = all.find((t) => t.preferred) ?? all[0]
      if (pref) return pref.timing
    }
  }
  for (const d of e.descriptors) {
    if (d.kind === 'dtd') return d.timing
  }
  for (const ext of e.extensions) {
    if (ext.kind === 'cta') {
      const c = ext as CtaExtension
      if (c.detailedTimings[0]) return c.detailedTimings[0].timing
    }
  }
  return null
}

export function displayName(e: Edid): string {
  for (const d of e.descriptors) if (d.kind === 'name') return d.text
  return ''
}

export function setDisplayName(e: Edid, text: string): Edid {
  const descriptors = [...e.descriptors]
  const idx = descriptors.findIndex((d) => d.kind === 'name')
  if (idx >= 0) descriptors[idx] = { kind: 'name', text }
  else {
    const slot = descriptors.findIndex((d) => d.kind === 'dummy')
    if (slot >= 0) descriptors[slot] = { kind: 'name', text }
  }
  return { ...e, descriptors }
}
