import { readFileSync } from 'node:fs';

/**
 * Range spec: "1-10,15,200-*" (1-based, "*" = open ended). Returns a predicate n => boolean.
 * An empty string matches nothing.
 */
export function parseRanges(spec) {
  const parts = String(spec).split(',').map((s) => s.trim()).filter(Boolean);
  const ranges = parts.map((part) => {
    const m = /^(\d+)(?:\s*-\s*(\d+|\*))?$/.exec(part);
    if (!m) throw new Error(`bad range "${part}" in "${spec}"`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : m[2] === '*' ? Infinity : Number(m[2]);
    if (hi < lo) throw new Error(`range "${part}" is backwards`);
    return [lo, hi];
  });
  return (n) => ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const KIND_PREFIX = { sources: 'SRC', destinations: 'DST' };

function categoryRules(rules = []) {
  return rules.map((r) => {
    if (!r.name) throw new Error('every category needs a name');
    const byName = r.match ? new RegExp(r.match, 'i') : null;
    const byRange = r.range ? parseRanges(r.range) : null;
    if (!byName && !byRange) throw new Error(`category "${r.name}" needs "match" or "range"`);
    return { name: r.name, test: (n, name) => (byName?.test(name) ?? false) || (byRange?.(n) ?? false) };
  });
}

function buildList(kind, cfg, profile, routerNames, count) {
  const section = { ...cfg[kind], ...profile[kind] };
  const include = section.include !== undefined ? parseRanges(section.include) : () => true;
  const hidden = section.hidden !== undefined ? parseRanges(section.hidden) : () => false;
  const locked = section.protected !== undefined ? parseRanges(section.protected) : () => false;
  const rules = categoryRules(section.categories);
  const labels = section.labels ?? {};
  const max = Math.max(section.count ?? 0, count, ...routerNames.keys(), 0);

  const items = [];
  for (let n = 1; n <= max; n++) {
    if (!include(n) || hidden(n)) continue;
    const routerName = routerNames.get(n) ?? '';
    if (section.hideUnnamed && !routerName && !labels[n]) continue;
    const name = labels[n] ?? (routerName || `${KIND_PREFIX[kind]} ${n}`);
    const rule = rules.find((r) => r.test(n, name));
    const item = { n, name, cat: rule?.name ?? 'Other' };
    if (kind === 'destinations' && locked(n)) item.locked = true;
    items.push(item);
  }
  const catOrder = [...rules.map((r) => r.name), 'Other'];
  const used = new Set(items.map((i) => i.cat));
  return { items, categories: catOrder.filter((c) => used.has(c)) };
}

/**
 * Router names (with label overrides) for every source, hidden or not. Used only to label what a
 * destination is currently routed from, so a hidden source never shows up as "Source 127".
 */
function displayNames(cfg, profile, routerNames) {
  const labels = { ...cfg.sources?.labels, ...profile.sources?.labels };
  const out = {};
  for (const [n, name] of routerNames) if (name) out[n] = name;
  for (const [n, name] of Object.entries(labels)) out[n] = name;
  return out;
}

export function profileNames(cfg) {
  return Object.keys(cfg.profiles ?? {}).length ? Object.keys(cfg.profiles) : ['default'];
}

export function defaultProfile(cfg) {
  return cfg.defaultProfile && profileNames(cfg).includes(cfg.defaultProfile) ? cfg.defaultProfile : profileNames(cfg)[0];
}

export function profileInfo(cfg, name) {
  if (!profileNames(cfg).includes(name)) return null;
  const p = cfg.profiles?.[name];
  return { name, label: p?.label ?? name, locked: Boolean(p?.pin) };
}

/**
 * Resolve what one profile is allowed to see and do.
 * `names` = { sources: Map, destinations: Map } as reported by the router.
 * Returns the JSON sent to the browser plus the sets used to validate takes server-side.
 */
export function buildView(cfg, profileName, names, counts = {}) {
  const profile = cfg.profiles?.[profileName] ?? {};
  const levelDefs = cfg.levels ?? [{ name: 'Video', short: 'V' }];
  const allowed = profile.levels ?? levelDefs.map((_, i) => i + 1);
  const levels = allowed
    .filter((n) => levelDefs[n - 1])
    .map((n) => ({ n, name: levelDefs[n - 1].name, short: levelDefs[n - 1].short ?? levelDefs[n - 1].name }));

  const groupSpecs = profile.levelGroups ?? cfg.levelGroups ?? [];
  const inProfile = new Set(levels.map((l) => l.n));
  const levelGroups = groupSpecs
    .map((g) => {
      const wanted = Array.isArray(g.levels) ? g.levels : levels.map((l) => l.n).filter(parseRanges(g.levels));
      return { name: g.name, levels: wanted.filter((n) => inProfile.has(n)) };
    })
    .filter((g) => g.levels.length);

  const src = buildList('sources', cfg, profile, names.sources, counts.sources ?? 0);
  const dst = buildList('destinations', cfg, profile, names.destinations, counts.destinations ?? 0);
  const readOnly = Boolean(profile.readOnly ?? cfg.readOnly);

  return {
    json: {
      title: profile.title ?? cfg.title ?? 'Router',
      router: cfg.routerName ? { name: cfg.routerName, type: cfg.router?.type ?? 'swp08' } : null,
      profile: profileName,
      readOnly,
      levels,
      levelGroups,
      sourceNames: displayNames(cfg, profile, names.sources),
      sources: src.items,
      destinations: dst.items,
      categories: { sources: src.categories, destinations: dst.categories },
    },
    sourceSet: new Set(src.items.map((i) => i.n)),
    destSet: new Set(dst.items.map((i) => i.n)),
    lockedDests: new Set(dst.items.filter((i) => i.locked).map((i) => i.n)),
    levelSet: new Set(levels.map((l) => l.n)),
    readOnly,
  };
}
