// Router panel front end. Talks to the panel server (never to the router directly).
const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: not critical */ }
  },
};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

const state = {
  profiles: [],
  profile: null,
  cfg: null,
  srcMap: new Map(),
  dstMap: new Map(),
  routes: {}, // dest -> { level: src }
  activity: [],
  routerStatus: 'connecting',
  dest: null,
  src: null,
  levels: new Set(),
  levelMap: new Map(),
  showLevels: false,
  auto: store.get('auto', false),
  busy: false,
  ownTakeUntil: 0, // route changes right after our own take are ours, not another controller's
  changedByOthers: false,
  es: null,
};

let picker = null; // { kind: 'sources' | 'destinations', query, cat }

// ---- formatting ---------------------------------------------------------------------------

const srcName = (n) => (n === 0 ? 'none' : state.srcMap.get(n)?.name ?? state.cfg?.sourceNames?.[n] ?? `Source ${n}`);
const dstName = (n) => state.dstMap.get(n)?.name ?? `Dest ${n}`;

/** Level numbers -> "V A1–A4 A7", using consecutive runs so 16 audio levels read as one "A1–A16". */
function levelRuns(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  const short = (n) => state.levelMap.get(n)?.short ?? n;
  return runs.map(([a, b]) => (a === b ? short(a) : b === a + 1 ? `${short(a)} ${short(b)}` : `${short(a)}\u2013${short(b)}`)).join(' ');
}

const sameSet = (nums) => nums.length === state.levels.size && nums.every((n) => state.levels.has(n));

/** "CAM 03" when every level agrees, otherwise "V CAM 03 · A1–A16 CAM 05". */
function routedSummary(dest) {
  const r = state.routes[dest];
  if (!r || !state.cfg) return '';
  const groups = new Map();
  for (const l of state.cfg.levels) {
    const s = r[l.n];
    if (s === undefined) continue;
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(l.n);
  }
  if (!groups.size) return '';
  const all = state.cfg.levels.length;
  if (groups.size === 1) {
    const [[s, ls]] = groups;
    return ls.length < all ? `${srcName(s)} (${levelRuns(ls)})` : srcName(s);
  }
  return [...groups].map(([s, ls]) => `${levelRuns(ls)} ${srcName(s)}`).join(' \u00b7 ');
}

/** Names a preset when the levels match one exactly, otherwise lists them. */
function levelText(levels) {
  if (!state.cfg || levels.length >= state.cfg.levels.length) return 'all levels';
  const preset = state.cfg.levelGroups.find((g) => g.levels.length === levels.length && g.levels.every((n) => levels.includes(n)));
  return preset ? preset.name : levelRuns(levels);
}

function toast(message, bad = false, ms = 3000) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- rendering ----------------------------------------------------------------------------

const STATUS_TEXT = { ready: 'Live', loading: 'Loading router', disconnected: 'Router offline', connecting: 'Connecting', offline: 'Panel offline' };

function renderStatus() {
  const s = state.routerStatus;
  const el = $('status');
  el.dataset.state = s;
  el.textContent = STATUS_TEXT[s] ?? s;
}

function renderSlots() {
  const d = state.dest;
  const s = state.src;
  $('dstName').textContent = d ? dstName(d) : 'Choose destination';
  $('dstSlot').classList.toggle('chosen', Boolean(d));
  const now = d ? routedSummary(d) : '';
  const nowEl = $('dstNow');
  nowEl.textContent = d ? (now ? `Now: ${now}` : 'Now: —') : '';
  nowEl.classList.toggle('changed', state.changedByOthers);
  $('revertBtn').hidden = !d;
  $('srcName').textContent = s ? srcName(s) : 'Choose source';
  $('srcSlot').classList.toggle('chosen', Boolean(s));
  $('srcNow').textContent = '';
}

function levelChip(l) {
  return h('button', {
    type: 'button', class: 'level', 'data-level': l.n, 'aria-pressed': String(state.levels.has(l.n)), 'aria-label': l.name, title: l.name, text: l.short,
  });
}

/** Few levels: one chip each. Many levels: presets (All / Video / Audio ...) plus an expandable per-level list. */
function renderLevels() {
  const box = $('levels');
  box.replaceChildren();
  const levels = state.cfg?.levels ?? [];
  box.hidden = levels.length < 2;
  if (levels.length < 2) return;
  if (levels.length <= 6) {
    box.append(...levels.map(levelChip));
    return;
  }
  const groups = state.cfg.levelGroups.length ? state.cfg.levelGroups : [{ name: 'All', levels: levels.map((l) => l.n) }];
  groups.forEach((g, i) => box.append(h('button', {
    type: 'button', class: 'level preset', 'data-group': i, 'aria-pressed': String(sameSet(g.levels)), text: g.name,
  })));
  box.append(h('button', { type: 'button', class: 'level more', 'aria-expanded': String(state.showLevels), text: state.showLevels ? 'Hide levels' : 'Levels\u2026' }));
  if (state.showLevels) box.append(h('div', { class: 'level-grid' }, ...levels.map(levelChip)));
}

function takeReadiness() {
  if (state.cfg?.readOnly) return 'Read-only profile';
  if (state.routerStatus !== 'ready') return 'Router not connected';
  if (!state.dest) return 'Choose a destination';
  if (!state.src) return 'Choose a source';
  if (!state.levels.size) return 'Select at least one level';
  return null;
}

function renderTake() {
  const btn = $('take');
  const why = state.busy ? null : takeReadiness();
  btn.disabled = state.busy || Boolean(why);
  if (state.busy) return;
  btn.className = '';
  $('takeMain').textContent = 'TAKE';
  $('takeSub').textContent = why ?? `${srcName(state.src)} → ${dstName(state.dest)}${state.levels.size < (state.cfg?.levels.length ?? 0) ? ` (${levelText([...state.levels])})` : ''}`;
}

function renderActivity() {
  const list = $('activityList');
  list.replaceChildren();
  $('activityEmpty').hidden = state.activity.length > 0;
  for (const a of [...state.activity].reverse()) {
    list.append(h('li', {},
      h('span', { class: 'when', text: new Date(a.t).toLocaleTimeString([], { hour12: false }) }),
      h('span', { class: 'what', text: `${dstName(a.dest)} ← ${srcName(a.src)}` }),
      h('span', { class: 'lv', text: levelText(a.levels) }),
    ));
  }
}

function renderNamesInfo() {
  const at = state.cfg?.namesLoadedAt;
  $('namesInfo').textContent = at ? `Names loaded ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Names not loaded';
}

function renderAll() {
  $('title').textContent = state.cfg?.title ?? 'Router';
  $('routerName').textContent = state.cfg?.router?.name ?? '';
  $('routerName').hidden = !state.cfg?.router?.name;
  document.title = state.cfg?.title ?? 'Router Panel';
  $('auto').checked = state.auto;
  renderStatus();
  renderSlots();
  renderLevels();
  renderTake();
  renderActivity();
  renderNamesInfo();
}

// ---- picker -------------------------------------------------------------------------------

const recentKey = (kind) => `recent:${state.profile}:${kind}`;

function remember(kind, n) {
  const next = [n, ...store.get(recentKey(kind), []).filter((x) => x !== n)].slice(0, 6);
  store.set(recentKey(kind), next);
}

function matches(item, tokens) {
  const hay = `${item.n} ${item.name}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function pickerItems() {
  const { kind, query, cat } = picker;
  const all = state.cfg[kind];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let items = all.filter((i) => (!cat || i.cat === cat) && matches(i, tokens));
  if (tokens.length) {
    const first = tokens[0];
    const rank = (i) => (i.name.toLowerCase().startsWith(first) || String(i.n) === first ? 0 : 1);
    items = [...items].sort((a, b) => rank(a) - rank(b) || a.n - b.n);
  }
  return items;
}

function rowDetails(item) {
  const badges = [];
  let sub = null;
  if (picker.kind === 'destinations') {
    const now = routedSummary(item.n);
    sub = now ? `← ${now}` : null;
    if (item.locked) badges.push(h('span', { class: 'badge', text: 'Protected' }));
  } else if (state.dest) {
    const r = state.routes[state.dest] ?? {};
    const on = state.cfg.levels.filter((l) => r[l.n] === item.n);
    if (on.length) badges.push(h('span', { class: 'badge live', text: on.length === state.cfg.levels.length ? 'On dest' : `On ${on.map((l) => l.short).join(' ')}` }));
  }
  return { sub, badges };
}

function itemRow(item) {
  const selected = (picker.kind === 'destinations' ? state.dest : state.src) === item.n;
  const { sub, badges } = rowDetails(item);
  return h('button', {
    type: 'button', class: 'item', 'data-n': item.n, 'aria-current': selected ? 'true' : null, 'aria-disabled': item.locked ? 'true' : null,
  },
  h('span', { class: 'n', text: item.n }),
  h('span', { class: 'nm' }, item.name, sub ? h('span', { class: 'sub', text: sub }) : null),
  ...badges);
}

/**
 * Live updates patch rows in place. Rebuilding the list while it is open could replace a row between
 * touch-down and touch-up on a phone and swallow the tap.
 */
function refreshRow(row) {
  const item = (picker.kind === 'destinations' ? state.dstMap : state.srcMap).get(Number(row.dataset.n));
  if (!item) return;
  const { sub, badges } = rowDetails(item);
  const name = row.querySelector('.nm');
  let subEl = name.querySelector('.sub');
  if (sub) {
    if (!subEl) name.append(subEl = h('span', { class: 'sub' }));
    subEl.textContent = sub;
  } else {
    subEl?.remove();
  }
  row.querySelectorAll('.badge').forEach((b) => b.remove());
  row.append(...badges);
}

const BROWSE_ABOVE = 150; // a category bigger than this is shown as one "Browse" row until it is opened
const ROW_LIMIT = 300; // most rows drawn at once; search narrows the rest

function renderPickerList() {
  const list = $('list');
  const items = pickerItems();
  const frag = document.createDocumentFragment();
  const rows = (arr) => arr.map((i) => h('li', {}, itemRow(i)));
  if (!items.length) {
    frag.append(h('li', { class: 'noresults', text: 'Nothing matches.' }));
  } else if (!picker.query && !picker.cat) {
    const recent = store.get(recentKey(picker.kind), []).map((n) => state.cfg[picker.kind].find((i) => i.n === n)).filter(Boolean);
    if (recent.length) frag.append(h('li', { class: 'heading', text: 'Recent' }), ...rows(recent));
    const cats = state.cfg.categories[picker.kind];
    for (const cat of cats) {
      const inCat = items.filter((i) => i.cat === cat);
      if (cats.length > 1) frag.append(h('li', { class: 'heading', text: `${cat} \u00b7 ${inCat.length}` }));
      if (cats.length > 1 && inCat.length > BROWSE_ABOVE) {
        frag.append(h('li', {}, h('button', { type: 'button', class: 'item browse', 'data-cat': cat },
          h('span', { class: 'nm', text: `Browse ${inCat.length} in ${cat}` }), h('span', { class: 'badge', text: 'Open \u203a' }))));
      } else {
        frag.append(...rows(inCat));
      }
    }
  } else {
    frag.append(...rows(items.slice(0, ROW_LIMIT)));
    if (items.length > ROW_LIMIT) frag.append(h('li', { class: 'noresults', text: `Showing the first ${ROW_LIMIT} of ${items.length}. Type to narrow it down.` }));
  }
  list.replaceChildren(frag);
}

function renderChips() {
  const cats = state.cfg.categories[picker.kind];
  const box = $('chips');
  box.replaceChildren();
  box.hidden = cats.length < 2;
  const chip = (label, value) => h('button', { type: 'button', class: 'chip', 'data-cat': value ?? '', 'aria-pressed': String(picker.cat === value), text: label });
  box.append(chip('All', null), ...cats.map((c) => chip(c, c)));
}

function openPicker(kind) {
  if (!state.cfg) return;
  picker = { kind, query: '', cat: null };
  state.changedByOthers = false;
  $('pickerTitle').textContent = kind === 'destinations' ? 'Choose destination' : 'Choose source';
  $('search').value = '';
  renderChips();
  renderPickerList();
  $('picker').showModal();
  $('list').scrollTop = 0;
  if (matchMedia('(pointer: fine)').matches) $('search').focus(); // on touch screens the keyboard would hide the list
}

function closePicker() {
  if ($('picker').open) $('picker').close();
  picker = null;
}

function choose(n) {
  const kind = picker.kind;
  const item = state.cfg[kind].find((i) => i.n === n);
  if (!item) return;
  if (item.locked) { toast(`${item.name} is protected`, true); return; }
  remember(kind, n);
  if (kind === 'destinations') state.dest = n;
  else state.src = n;
  closePicker();
  renderSlots();
  renderTake();
  if (kind === 'sources' && state.auto && state.dest) take();
}

// ---- taking -------------------------------------------------------------------------------

function flash(kind, main, sub) {
  const btn = $('take');
  btn.className = kind;
  btn.disabled = false;
  $('takeMain').textContent = main;
  $('takeSub').textContent = sub;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(renderTake, kind === 'ok' ? 1400 : 3500);
}

async function take() {
  if (state.busy || takeReadiness()) return;
  const { dest, src } = state;
  const levels = [...state.levels].sort((a, b) => a - b);
  state.busy = true;
  state.ownTakeUntil = Infinity;
  state.changedByOthers = false;
  $('take').className = 'busy';
  $('take').disabled = true;
  $('revertBtn').disabled = true;
  $('takeMain').textContent = 'SENDING…';
  $('takeSub').textContent = `${srcName(src)} → ${dstName(dest)}`;
  try {
    const res = await fetch(`/api/take?profile=${enc(state.profile)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dest, src, levels }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    state.busy = false;
    if (data.confirmed) {
      flash('ok', 'ROUTED ✓', `${srcName(src)} → ${dstName(dest)}`);
    } else {
      flash('fail', 'NOT CONFIRMED', 'The router did not report the change');
      toast(`${dstName(dest)} is now ${routedSummary(dest) || 'unknown'}. The router did not confirm the route, so the destination may be protected.`, true, 6000);
    }
  } catch (err) {
    state.busy = false;
    flash('fail', 'FAILED', err.message);
  } finally {
    state.busy = false;
    state.ownTakeUntil = Date.now() + 1500;
    state.levels = new Set(state.cfg.levels.map((l) => l.n)); // always fall back to all levels after a take
    $('revertBtn').disabled = false;
    renderLevels();
    renderSlots();
  }
}

/** Puts the destination back to whatever was on it right before the most recent change - by anyone,
 * not just this panel. Pressing it again swaps back, since that "revert" is itself a new change. */
async function revert() {
  if (state.busy || !state.dest) return;
  const dest = state.dest;
  state.busy = true;
  state.ownTakeUntil = Infinity;
  state.changedByOthers = false;
  $('take').disabled = true;
  const btn = $('revertBtn');
  btn.disabled = true;
  btn.textContent = 'Reverting…';
  try {
    const res = await fetch(`/api/revert?profile=${enc(state.profile)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dest }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 404) toast('Nothing to revert for this destination.');
      else throw new Error(data.error ?? `HTTP ${res.status}`);
    } else if (data.results.some((r) => !r.confirmed)) {
      toast('Revert sent, but the router did not confirm all of it.', true, 6000);
    } else {
      toast(`Reverted ${dstName(dest)} to ${routedSummary(dest) || 'its previous source'}`);
    }
  } catch (err) {
    toast(err.message, true, 5000);
  } finally {
    state.busy = false;
    state.ownTakeUntil = Date.now() + 1500;
    btn.disabled = false;
    btn.textContent = '↺ Revert';
    renderTake();
    renderSlots();
  }
}

// ---- data ---------------------------------------------------------------------------------

function applyState(snapshot) {
  state.routerStatus = snapshot.status;
  state.routes = snapshot.routes;
  state.activity = snapshot.activity;
  renderStatus();
  renderSlots();
  renderTake();
  renderActivity();
}

function onRoute({ dest, level, src, t }) {
  (state.routes[dest] ??= {})[level] = src;
  const last = state.activity.at(-1);
  if (last && last.dest === dest && last.src === src && t - last.t < 750) {
    if (!last.levels.includes(level)) last.levels.push(level);
  } else {
    state.activity.push({ t, dest, src, levels: [level] });
    state.activity = state.activity.slice(-100);
  }
  if (dest === state.dest && Date.now() > state.ownTakeUntil) {
    state.changedByOthers = true;
    toast(`${dstName(dest)} changed: now ${routedSummary(dest)}`);
  }
  renderSlots();
  renderActivity();
  if (picker?.kind === 'destinations') {
    const row = $('list').querySelector(`.item[data-n="${dest}"]`);
    if (row) refreshRow(row);
  } else if (picker?.kind === 'sources' && dest === state.dest) {
    $('list').querySelectorAll('.item').forEach(refreshRow);
  }
}

function connectEvents() {
  state.es?.close();
  const es = new EventSource(`/events?profile=${enc(state.profile)}`);
  state.es = es;
  es.addEventListener('state', (e) => applyState(JSON.parse(e.data)));
  es.addEventListener('route', (e) => onRoute(JSON.parse(e.data)));
  es.addEventListener('status', (e) => {
    state.routerStatus = JSON.parse(e.data).status;
    renderStatus();
    renderTake();
  });
  es.addEventListener('config', () => loadConfig(state.profile, { quiet: true }));
  es.onerror = () => {
    state.routerStatus = 'offline';
    renderStatus();
    renderTake();
  };
}

function askPin(profile) {
  const dlg = $('login');
  const info = state.profiles.find((p) => p.name === profile);
  $('loginProfile').textContent = info?.label ?? profile;
  $('loginError').textContent = '';
  $('pin').value = '';
  return new Promise((resolve) => {
    const finish = (ok) => { dlg.close(); $('loginForm').onsubmit = null; $('loginCancel').onclick = null; resolve(ok); };
    $('loginCancel').onclick = () => finish(false);
    dlg.oncancel = () => finish(false);
    $('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, pin: $('pin').value }) });
      if (res.ok) finish(true);
      else { $('loginError').textContent = 'Wrong PIN'; $('pin').select(); }
    };
    dlg.showModal();
    $('pin').focus();
  });
}

/** Fetch the profile's config, prompting for its PIN if needed. Returns false if the user backed out. */
async function loadConfig(profile, { quiet = false } = {}) {
  for (;;) {
    const res = await fetch(`/api/config?profile=${enc(profile)}`);
    if (res.status === 401 && !quiet) {
      if (!(await askPin(profile))) return false;
      continue;
    }
    if (!res.ok) throw new Error(`config: HTTP ${res.status}`);
    const cfg = await res.json();
    const keepSelection = state.cfg && state.profile === profile; // same profile: this is a background reload
    state.cfg = cfg;
    state.profile = profile;
    state.srcMap = new Map(cfg.sources.map((s) => [s.n, s]));
    state.dstMap = new Map(cfg.destinations.map((d) => [d.n, d]));
    if (!state.srcMap.has(state.src)) state.src = null;
    if (!state.dstMap.has(state.dest) || state.dstMap.get(state.dest).locked) state.dest = null;
    state.levelMap = new Map(cfg.levels.map((l) => [l.n, l]));
    const kept = keepSelection ? [...state.levels].filter((n) => state.levelMap.has(n)) : [];
    state.levels = new Set(kept.length ? kept : cfg.levels.map((l) => l.n));
    renderAll();
    if (picker) { renderChips(); renderPickerList(); }
    return true;
  }
}

async function switchProfile(profile) {
  const previous = state.profile;
  try {
    if (await loadConfig(profile)) {
      store.set('profile', profile);
      connectEvents();
      return;
    }
  } catch (err) {
    toast(err.message, true);
  }
  $('profile').value = previous ?? '';
}

async function refreshNames() {
  const btn = $('refreshNames');
  btn.disabled = true;
  btn.textContent = 'Refreshing\u2026';
  try {
    const res = await fetch(`/api/refresh-names?profile=${enc(state.profile)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    toast(data.changed ? `Names refreshed: ${data.changed} changed` : 'Names refreshed: no changes');
  } catch (err) {
    toast(err.message, true, 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh names';
  }
}

// ---- wiring -------------------------------------------------------------------------------

function wire() {
  $('dstSlot').addEventListener('click', () => openPicker('destinations'));
  $('srcSlot').addEventListener('click', () => openPicker('sources'));
  $('take').addEventListener('click', take);
  $('revertBtn').addEventListener('click', revert);
  $('pickerClose').addEventListener('click', closePicker);
  $('picker').addEventListener('close', () => { picker = null; });
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });

  $('search').addEventListener('input', (e) => { picker.query = e.target.value; renderPickerList(); $('list').scrollTop = 0; });
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    picker.cat = chip.dataset.cat || null;
    renderChips();
    renderPickerList();
    $('list').scrollTop = 0;
  });
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.item');
    if (!row) return;
    if (row.dataset.cat) {
      picker.cat = row.dataset.cat;
      renderChips();
      renderPickerList();
      $('list').scrollTop = 0;
    } else {
      choose(Number(row.dataset.n));
    }
  });

  $('levels').addEventListener('click', (e) => {
    const btn = e.target.closest('.level');
    if (!btn) return;
    if (btn.classList.contains('more')) {
      state.showLevels = !state.showLevels;
    } else if (btn.classList.contains('preset')) {
      const groups = state.cfg.levelGroups.length ? state.cfg.levelGroups : [{ levels: state.cfg.levels.map((l) => l.n) }];
      state.levels = new Set(groups[Number(btn.dataset.group)].levels);
    } else {
      const n = Number(btn.dataset.level);
      if (state.levels.has(n)) state.levels.delete(n); else state.levels.add(n);
    }
    renderLevels();
    renderTake();
  });

  $('refreshNames').addEventListener('click', refreshNames);
  $('auto').addEventListener('change', (e) => { state.auto = e.target.checked; store.set('auto', state.auto); });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $('route').hidden = tab.dataset.tab !== 'route';
    $('activity').hidden = tab.dataset.tab !== 'activity';
  }));

  $('profile').addEventListener('change', (e) => switchProfile(e.target.value));

  // Phones suspend background tabs; resync when the panel comes back to the front.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.profile) return;
    if (!state.es || state.es.readyState === EventSource.CLOSED) connectEvents();
    try {
      const res = await fetch(`/api/state?profile=${enc(state.profile)}`);
      if (res.ok) applyState(await res.json());
    } catch { /* the event stream will report the outage */ }
  });
}

async function init() {
  wire();
  renderStatus();
  try {
    const { default: def, profiles } = await (await fetch('/api/profiles')).json();
    state.profiles = profiles;
    const wanted = new URLSearchParams(location.search).get('profile') ?? store.get('profile', null);
    const start = profiles.some((p) => p.name === wanted) ? wanted : def;
    const sel = $('profile');
    sel.replaceChildren(...profiles.map((p) => h('option', { value: p.name, text: p.locked ? `🔒 ${p.label}` : p.label })));
    sel.hidden = profiles.length < 2;
    sel.value = start;
    if (!(await loadConfig(start))) {
      // PIN dialog was cancelled: fall back to the first open profile
      const open = profiles.find((p) => !p.locked);
      if (!open || !(await loadConfig(open.name))) throw new Error('no accessible profile');
      sel.value = open.name;
    }
    connectEvents();
  } catch (err) {
    state.routerStatus = 'offline';
    renderStatus();
    toast(`Cannot reach the panel server: ${err.message}`, true, 8000);
  }
}

init();
