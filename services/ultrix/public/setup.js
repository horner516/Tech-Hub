'use strict';
// Router Panel settings. Reads and saves the whole config through Tech Hub (/__hub/settings, If-Match revision),
// which validates it, keeps a backup and applies it to the running panel. Only the Tech Hub computer can open it.
(() => {
  const TYPES = { swp08: { label: 'Ross Ultrix / SW-P-08', port: 2000 }, videohub: { label: 'Blackmagic Videohub', port: 9990 } };
  const $ = (id) => document.getElementById(id);
  const form = $('settings'), message = $('message'), saveButton = $('save');
  let config = null, revision = null, editing = null, dirty = false, names = null, nextKey = 1;

  function make(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node[k] = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = true;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }
  const touch = () => { dirty = true; };
  const optionalText = (v) => v.trim() || undefined;
  const optionalNumber = (v) => (v.trim() === '' ? undefined : Number(v));
  const set = (obj, key, value) => { if (value === undefined) delete obj[key]; else obj[key] = value; };

  /** A labelled input bound to obj[key]. */
  function input(obj, key, { label, type = 'text', help, parse = (v) => v, format = (v) => v ?? '', after, ...attrs } = {}) {
    const el = make('input', { type, ...attrs, value: format(obj[key]) });
    el.oninput = () => { set(obj, key, parse(el.value)); touch(); after?.(el); };
    return label ? make('label', {}, make('span', { text: label }), el, help && make('small', { text: help })) : el;
  }
  function select(obj, key, choices, { label, help, parse = (v) => v, onchange } = {}) {
    const el = make('select', { 'aria-label': label });
    for (const [value, text] of choices) el.append(make('option', { value: String(value), text }));
    el.value = String(obj[key] ?? choices[0][0]);
    el.onchange = () => { if (onchange && onchange(parse(el.value), el) === false) return; set(obj, key, parse(el.value)); touch(); };
    const wrap = make('div', { class: 'select-wrap' }, el);
    return label ? make('label', {}, make('span', { text: label }), wrap, help && make('small', { text: help })) : wrap;
  }
  function checkbox(obj, key, text, { fallback = false, after } = {}) {
    const el = make('input', { type: 'checkbox', checked: obj[key] ?? fallback });
    el.onchange = () => { obj[key] = el.checked; touch(); after?.(el); };
    return make('label', { class: 'check' }, el, text);
  }
  const iconButton = (text, title, onclick, cls = '') => make('button', { type: 'button', class: `icon ${cls}`, title, 'aria-label': title, text, onclick });

  function show(text, kind = '') { message.textContent = text; message.className = kind; }

  // ---- config <-> editing model ---------------------------------------------------------------------------
  // Profiles and labels are edited as ordered rows, so IDs and numbers can change while typing.
  function migrate(c) {
    if (Array.isArray(c.routers)) return c;
    const { title, server, mock, activeRouter, ...panel } = c;
    return { title: !title || title === 'Ultrix Panel' ? 'Router Panel' : title, server, mock, activeRouter: 'router-1', routers: [{ id: 'router-1', name: 'Ultrix', ...panel, router: { type: 'swp08', ...panel.router } }] };
  }
  function toModel(r) {
    r.router ??= {};
    r.router.type ??= 'swp08';
    r.levels ??= [{ name: 'Video', short: 'V' }];
    r.levelGroups = (r.levelGroups ?? []).map((g) => ({ ...g, levels: Array.isArray(g.levels) ? g.levels.join(',') : g.levels }));
    for (const kind of ['sources', 'destinations']) {
      r[kind] ??= {};
      r[kind].categories ??= [];
      r[kind]._labels = Object.entries(r[kind].labels ?? {}).map(([n, name]) => ({ n, name }));
      delete r[kind].labels;
    }
    r._profiles = Object.entries(r.profiles ?? {}).map(([id, value]) => ({ key: nextKey++, id, value }));
    if (!r._profiles.length) r._profiles.push({ key: nextKey++, id: 'operator', value: { title: 'Operator' } });
    r._default = (r._profiles.find((p) => p.id === r.defaultProfile) ?? r._profiles[0]).key;
    delete r.profiles; delete r.defaultProfile;
    return r;
  }
  function fromModel(r) {
    const { _profiles, _default, ...out } = structuredClone(r);
    const where = `Router “${r.name || r.id}”`;
    out.levelGroups = out.levelGroups.filter((g) => String(g.name ?? '').trim() || String(g.levels ?? '').trim());
    if (!out.levelGroups.length) delete out.levelGroups;
    for (const kind of ['sources', 'destinations']) {
      const section = out[kind], labels = {};
      for (const { n, name } of section._labels) {
        if (!String(n).trim() && !name.trim()) continue;
        if (!/^\d+$/.test(String(n).trim()) || Number(n) < 1) throw Error(`${where}: each ${kind === 'sources' ? 'source' : 'destination'} label needs a port number.`);
        if (Object.hasOwn(labels, Number(n))) throw Error(`${where}: ${kind} label ${Number(n)} is listed twice.`);
        labels[Number(n)] = name;
      }
      delete section._labels;
      if (Object.keys(labels).length) section.labels = labels;
      section.categories = section.categories.filter((c) => String(c.name ?? '').trim() || c.match || c.range);
      if (!section.categories.length) delete section.categories;
    }
    out.profiles = {};
    for (const p of _profiles) {
      const id = p.id.trim();
      if (!id) throw Error(`${where}: every access profile needs an ID.`);
      if (['__proto__', 'constructor', 'prototype'].includes(id)) throw Error(`${where}: “${id}” can’t be used as a profile ID.`);
      if (Object.hasOwn(out.profiles, id)) throw Error(`${where}: two access profiles use the ID “${id}”.`);
      for (const k of ['sources', 'destinations']) if (p.value[k] && !Object.keys(p.value[k]).length) delete p.value[k];
      if (Array.isArray(p.value.levels) && !p.value.levels.length) throw Error(`${where}: profile “${id}” needs at least one level, or All levels.`);
      out.profiles[id] = p.value;
    }
    out.defaultProfile = _profiles.find((p) => p.key === _default).id.trim();
    return out;
  }
  function payload() {
    const { routers, ...rest } = config;
    return { ...rest, routers: routers.map(fromModel) };
  }
  const routerById = (id) => config.routers.find((r) => r.id === id);
  const editingRouter = () => routerById(editing) ?? routerById(config.activeRouter) ?? config.routers[0];
  function newRouterId() { let n = 1; while (routerById(`router-${n}`)) n++; return `router-${n}`; }
  const namesFor = (r) => (names && names.routerId === r.id && (names.sources.length || names.destinations.length) ? names : null);

  // ---- 1. routers --------------------------------------------------------------------------------------------
  function renderRouters() {
    const box = $('routers');
    box.replaceChildren();
    for (const r of config.routers) {
      const active = r.id === config.activeRouter, conn = r.router, sw = conn.type !== 'videohub';
      const radio = make('input', { type: 'radio', name: 'active', 'aria-label': `Make ${r.name || 'this router'} the active router`, checked: active, onchange: () => { config.activeRouter = r.id; touch(); renderRouters(); renderEditingBar(); } });
      const head = make('div', { class: 'router-head' },
        make('label', { class: 'radio' }, radio, 'Active'),
        make('div', { class: 'name' }, input(r, 'name', { 'aria-label': 'Router name', placeholder: 'Router name', maxlength: 256, after: () => renderEditingBar() })),
        active && make('span', { class: 'badge', text: 'ACTIVE' }));
      const typeField = select(conn, 'type', Object.entries(TYPES).map(([k, t]) => [k, t.label]), { label: 'Router type', onchange: (type, el) => changeType(r, type, el) });
      const fields = make('div', { class: 'fields' },
        typeField,
        input(conn, 'host', { label: 'Address', placeholder: 'e.g. 192.168.1.50', help: 'Leave empty to stay disconnected.', parse: (v) => v.trim(), maxlength: 253, spellcheck: 'false', autocapitalize: 'off' }),
        input(conn, 'port', { label: 'TCP port', type: 'number', min: 1, max: 65535, parse: optionalNumber, help: `${TYPES[conn.type].label}: usually ${TYPES[conn.type].port}` }),
        make('label', {}, make('span', { text: 'Routing' }), checkbox(conn, 'allowRouting', 'Allow takes from the panel', { fallback: true }), make('small', { text: 'Off = watch only; nothing is sent that could change a route.' })));
      const advanced = sw && make('details', {}, make('summary', { text: 'SW-P-08 options' }), make('div', { class: 'fields' },
        input(conn, 'matrix', { label: 'Matrix', type: 'number', min: 0, max: 255, parse: optionalNumber, help: 'Usually 1 on a Ross Ultrix.' }),
        select(conn, 'extended', [['auto', 'Automatic'], [true, 'Always extended'], [false, 'Never extended']], { label: 'Extended commands', parse: (v) => (v === 'auto' ? 'auto' : v === 'true') }),
        select(conn, 'nameChars', [['auto', 'Automatic'], ...[4, 8, 12, 16, 32].map((n) => [n, `${n} characters`])], { label: 'Name length', parse: (v) => (v === 'auto' ? 'auto' : Number(v)) })));
      const actions = make('div', { class: 'router-actions' },
        make('button', { type: 'button', class: 'ghost', text: r.id === editingRouter().id ? 'Editing panel setup below' : 'Set up this router’s panel ↓', disabled: r.id === editingRouter().id, onclick: () => { editing = r.id; renderEditor(); $('editingBar').scrollIntoView({ behavior: 'smooth' }); } }),
        make('button', { type: 'button', class: 'danger', text: 'Remove', disabled: active || config.routers.length === 1, title: active ? 'Make another router active first' : undefined, onclick: () => removeRouter(r) }));
      box.append(make('div', { class: `router${active ? ' active' : ''}` }, head, fields, advanced, actions));
    }
    renderActiveStatus();
  }
  function changeType(r, type, el) {
    const conn = r.router, before = conn.type;
    if (type === 'videohub' && (r.levels.length !== 1 || r.levelGroups.length || r._profiles.some((p) => p.value.levels))) {
      const ok = confirm(`A Blackmagic Videohub has one level.\n\n“${r.name}” will keep one level (“${r.levels[0]?.name ?? 'Video'}”); its other levels, level presets and profile level limits are removed. Continue?`);
      if (!ok) { el.value = before; return false; }
      r.levels = [r.levels[0] ?? { name: 'Video', short: 'V' }];
      r.levelGroups = [];
      for (const p of r._profiles) delete p.value.levels;
    }
    if (conn.port === undefined || conn.port === TYPES[before].port) conn.port = TYPES[type].port;
    if (type === 'videohub') for (const k of ['matrix', 'extended', 'nameChars']) delete conn[k];
    else Object.assign(conn, { matrix: conn.matrix ?? 1, extended: conn.extended ?? 'auto', nameChars: conn.nameChars ?? 'auto' });
    conn.type = type;
    touch();
    renderRouters();
    renderEditor();
    return false; // already applied
  }
  function addRouter() {
    const id = newRouterId();
    config.routers.push(toModel({
      id, name: `Router ${id.slice(7)}`,
      router: { type: 'swp08', host: '', port: 2000, matrix: 1, extended: 'auto', nameChars: 'auto', allowRouting: true },
      levels: [{ name: 'Video', short: 'V' }], sources: {}, destinations: {},
      defaultProfile: 'operator', profiles: { operator: { title: 'Operator' }, viewer: { title: 'Viewer', readOnly: true } },
    }));
    editing = id;
    touch();
    renderRouters();
    renderEditor();
    $('routers').lastElementChild.querySelector('.name input').select();
  }
  function removeRouter(r) {
    if (!confirm(`Remove “${r.name}” and its panel setup? This takes effect when you save.`)) return;
    config.routers = config.routers.filter((x) => x !== r);
    if (editing === r.id) editing = config.activeRouter;
    touch();
    renderRouters();
    renderEditor();
  }
  function renderActiveStatus() {
    const badge = $('activeStatus'), saved = names && routerById(names.routerId);
    if (!saved) { badge.hidden = true; return; }
    const live = names.status === 'ready' || names.status === 'live';
    badge.hidden = false;
    badge.className = live ? '' : 'off';
    badge.textContent = `${saved.name.toUpperCase()} · ${String(names.status || 'unknown').toUpperCase()}`;
    badge.title = 'The router the running panel is connected to (as last saved).';
  }

  // ---- 2+. panel setup for one router --------------------------------------------------------------------
  function renderEditingBar() {
    const sel = $('editing'), r = editingRouter();
    sel.replaceChildren(...config.routers.map((x) => make('option', { value: x.id, text: `${x.name || x.id}${x.id === config.activeRouter ? ' (active)' : ''}` })));
    sel.value = r.id;
    $('editingNote').textContent = config.routers.length > 1 ? 'Levels, sources, destinations and profiles below belong to this router.' : '';
  }
  function renderEditor() {
    editing = editingRouter().id;
    renderEditingBar();
    renderLevels();
    for (const kind of ['sources', 'destinations']) renderList(kind);
    renderProfiles();
    renderRouters();
  }

  function renderLevels() {
    const r = editingRouter(), box = $('levels'), videohub = r.router.type === 'videohub';
    $('levelsHelp').textContent = videohub
      ? 'A Blackmagic Videohub has one level. You can rename it.'
      : 'Level N is the router’s level N. Add levels at the end; only the last level can be removed so the numbers keep matching the router.';
    const rows = make('div', { class: 'rows' });
    r.levels.forEach((level, i) => {
      const last = i === r.levels.length - 1;
      rows.append(make('div', { class: 'row level' },
        make('label', {}, make('span', { text: `Level ${i + 1}` }), input(level, 'name', { 'aria-label': `Level ${i + 1} name`, placeholder: 'Name', maxlength: 256 })),
        make('label', {}, make('span', { text: 'Abbreviation' }), input(level, 'short', { 'aria-label': `Level ${i + 1} abbreviation`, placeholder: 'Short', maxlength: 256, parse: optionalText })),
        !videohub && iconButton('✕', last && r.levels.length > 1 ? `Remove level ${i + 1}` : 'Only the last level can be removed', () => removeLevel(r), 'remove'),
      ));
      if (videohub || !last || r.levels.length === 1) rows.lastChild.querySelector('.remove')?.setAttribute('disabled', '');
    });
    box.replaceChildren(rows, videohub ? '' : make('button', { type: 'button', class: 'add', text: '+ Add level', onclick: () => { r.levels.push({ name: `Level ${r.levels.length + 1}` }); touch(); renderLevels(); renderProfiles(); } }));
    $('levelGroupsBox').hidden = videohub;
    const groups = make('div', { class: 'rows' });
    r.levelGroups.forEach((g, i) => groups.append(make('div', { class: 'row preset' },
      make('label', {}, make('span', { text: 'Button name' }), input(g, 'name', { placeholder: 'e.g. Audio', maxlength: 256 })),
      make('label', {}, make('span', { text: 'Levels' }), input(g, 'levels', { placeholder: 'e.g. 2-17', spellcheck: 'false' })),
      iconButton('✕', 'Remove preset', () => { r.levelGroups.splice(i, 1); touch(); renderLevels(); }, 'remove'))));
    $('levelGroups').replaceChildren(groups, make('button', { type: 'button', class: 'add', text: '+ Add preset', onclick: () => { r.levelGroups.push({ name: '', levels: '' }); touch(); renderLevels(); } }));
  }
  function removeLevel(r) {
    const n = r.levels.length;
    if (n < 2) return;
    r.levels.pop();
    for (const p of r._profiles) if (Array.isArray(p.value.levels)) { p.value.levels = p.value.levels.filter((l) => l !== n); if (!p.value.levels.length) delete p.value.levels; }
    touch();
    renderLevels();
    renderProfiles();
  }

  function renderList(kind) {
    const r = editingRouter(), s = r[kind], box = $(kind), noun = kind === 'sources' ? 'source' : 'destination';
    const refresh = () => updatePreview(kind);
    const fields = make('div', { class: 'fields' },
      input(s, 'include', { label: `Show ${kind}`, placeholder: 'All', help: 'Numbers and ranges, e.g. 1-64,100-*', parse: optionalText, spellcheck: 'false', after: refresh }),
      input(s, 'hidden', { label: `Hide ${kind}`, placeholder: 'None', help: 'Removed even if shown above.', parse: optionalText, spellcheck: 'false', after: refresh }),
      kind === 'destinations' && input(s, 'protected', { label: 'Protected', placeholder: 'None', help: 'Visible, but takes are refused.', parse: optionalText, spellcheck: 'false' }),
      input(s, 'count', { label: 'List up to', type: 'number', min: 0, max: 65535, placeholder: 'What the router reports', help: 'Only if the router reports fewer ports than it has.', parse: optionalNumber, after: refresh }),
      make('label', {}, make('span', { text: 'Unnamed ports' }), checkbox(s, 'hideUnnamed', `Hide ${kind} with no name`, { after: refresh })));

    const head = make('div', { class: 'row-head category' }, make('span', { text: 'Category' }), make('span', { text: 'Name matches' }), make('span', { text: 'or port numbers' }), make('span', { text: 'Preview' }));
    const rows = make('div', { class: 'rows' });
    s.categories.forEach((c, i) => {
      const count = make('span', { class: 'count', 'data-cat': i });
      rows.append(make('div', { class: 'row category' },
        input(c, 'name', { 'aria-label': 'Category name', placeholder: 'Name', maxlength: 256, after: refresh }),
        input(c, 'match', { 'aria-label': 'Name pattern', placeholder: 'e.g. ^CAM', parse: optionalText, spellcheck: 'false', autocapitalize: 'off', after: refresh }),
        input(c, 'range', { 'aria-label': 'Port numbers', placeholder: 'e.g. 1-12', parse: optionalText, spellcheck: 'false', after: refresh }),
        count,
        iconButton('↑', 'Move up (checked earlier)', () => moveCategory(kind, i, -1)),
        iconButton('↓', 'Move down', () => moveCategory(kind, i, 1)),
        iconButton('✕', 'Remove category', () => { s.categories.splice(i, 1); touch(); renderList(kind); }, 'remove')));
    });
    rows.firstChild?.querySelectorAll('.icon')[0].setAttribute('disabled', '');
    rows.lastChild?.querySelectorAll('.icon')[1].setAttribute('disabled', '');

    const labels = make('div', { class: 'rows' });
    s._labels.forEach((l, i) => {
      const name = input(l, 'name', { 'aria-label': 'Display name', placeholder: 'Display name', maxlength: 256, after: refresh });
      const setHint = () => { const known = namesFor(r) && new Map(namesFor(r)[kind]).get(Number(l.n)); name.placeholder = known ? `Router: ${known}` : 'Display name'; };
      labels.append(make('div', { class: 'row label' },
        make('label', {}, make('span', { text: 'Port' }), input(l, 'n', { type: 'number', min: 1, max: 65535, 'aria-label': `${noun} number`, after: () => { setHint(); refresh(); } })),
        make('label', {}, make('span', { text: 'Name on the panel' }), name),
        iconButton('✕', 'Remove label', () => { s._labels.splice(i, 1); touch(); renderList(kind); }, 'remove')));
      setHint();
    });

    box.replaceChildren(fields,
      make('h3', { text: 'Categories' }),
      make('p', { class: 'help', text: `The panel groups ${kind} by these, top to bottom: each ${noun} goes in the first category whose pattern matches its name (not case-sensitive; a regular expression, so ^CAM means “starts with CAM” and CAM|CCU means either) or whose port numbers include it. Anything else goes in Other.` }),
      s.categories.length ? head : '', rows,
      make('button', { type: 'button', class: 'add', text: '+ Add category', onclick: () => { s.categories.push({ name: '' }); touch(); renderList(kind); rows.lastChild?.querySelector('input')?.focus(); } }),
      make('p', { class: 'preview', id: `${kind}Preview` }),
      make('h3', { text: 'Name overrides' }),
      make('p', { class: 'help', text: `Show a different name on the panel than the router uses. The router itself is not renamed.` }),
      labels,
      make('button', { type: 'button', class: 'add', text: '+ Add name override', onclick: () => { s._labels.push({ n: '', name: '' }); touch(); renderList(kind); } }));
    updatePreview(kind);
  }
  function moveCategory(kind, i, by) {
    const list = editingRouter()[kind].categories, j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    touch();
    renderList(kind);
  }

  function parseRanges(spec) {
    const parts = String(spec).split(',').map((x) => x.trim()).filter(Boolean).map((part) => {
      const m = /^(\d+)(?:\s*-\s*(\d+|\*))?$/.exec(part);
      if (!m) throw Error(part);
      return [Number(m[1]), m[2] === undefined ? Number(m[1]) : m[2] === '*' ? Infinity : Number(m[2])];
    });
    return (n) => parts.some(([lo, hi]) => n >= lo && n <= hi);
  }
  /** Same grouping the panel does (config.js buildList), on the names the active router reports right now. */
  function updatePreview(kind) {
    const r = editingRouter(), s = r[kind], out = $(`${kind}Preview`), rows = document.querySelectorAll(`#${kind} .count`);
    if (!out) return;
    const live = namesFor(r);
    for (const el of rows) { el.textContent = ''; el.title = ''; }
    if (!live) {
      out.textContent = r.id === names?.routerId || r.id === config.activeRouter
        ? 'The live preview appears here once the active router is connected and has sent its names.'
        : 'Live preview is available for the active router only. Make this router active and save to preview its names.';
      return;
    }
    let include, hidden;
    try { include = s.include ? parseRanges(s.include) : () => true; hidden = s.hidden ? parseRanges(s.hidden) : () => false; } catch (e) { out.textContent = `Fix the port range “${e.message}” to see a preview.`; return; }
    const rules = s.categories.map((c, i) => {
      let byName = null, byRange = null, bad = false;
      try { byName = c.match ? new RegExp(c.match, 'i') : null; } catch { bad = true; }
      try { byRange = c.range ? parseRanges(c.range) : null; } catch { bad = true; }
      return { i, bad, test: (n, name) => (byName?.test(name) ?? false) || (byRange?.(n) ?? false) };
    });
    const routerNames = new Map(live[kind]), labels = new Map(s._labels.filter((l) => /^\d+$/.test(String(l.n)) && l.name).map((l) => [Number(l.n), l.name]));
    const max = Math.max(Number(s.count) || 0, ...routerNames.keys(), 0), buckets = rules.map(() => []), other = [];
    let shown = 0;
    for (let n = 1; n <= max; n++) {
      if (!include(n) || hidden(n)) continue;
      const routerName = routerNames.get(n) ?? '';
      if (s.hideUnnamed && !routerName && !labels.has(n)) continue;
      const name = labels.get(n) ?? (routerName || `${kind === 'sources' ? 'SRC' : 'DST'} ${n}`);
      shown++;
      const rule = rules.find((x) => !x.bad && x.test(n, name));
      (rule ? buckets[rule.i] : other).push(name);
    }
    const sample = (list) => list.slice(0, 12).join(', ') + (list.length > 12 ? `, … (+${list.length - 12})` : '');
    rows.forEach((el, i) => {
      const rule = rules[i];
      if (!rule) return;
      el.textContent = rule.bad ? 'invalid' : String(buckets[i].length);
      el.className = `count${rule.bad || !buckets[i].length ? ' none' : ''}`;
      el.title = rule.bad ? 'This pattern or range is not valid.' : sample(buckets[i]) || 'Nothing matches yet.';
    });
    out.replaceChildren(make('b', { text: `${shown} ${kind} shown` }), ` from ${names.routerName}. Other (${other.length}): ${sample(other) || 'none'}`);
  }

  function renderProfiles() {
    const r = editingRouter(), box = $('profiles');
    const defaultSelect = $('defaultProfile');
    defaultSelect.replaceChildren(...r._profiles.map((p) => make('option', { value: String(p.key), text: p.id || '(no ID yet)' })));
    defaultSelect.value = String(r._default);
    defaultSelect.onchange = () => { r._default = Number(defaultSelect.value); touch(); };
    box.replaceChildren();
    for (const p of r._profiles) {
      const v = p.value;
      const allLevels = make('input', { type: 'checkbox', checked: !Array.isArray(v.levels) });
      const picks = make('div', { class: 'levels-pick' });
      const drawPicks = () => {
        picks.replaceChildren(...r.levels.map((l, i) => {
          const box = make('input', { type: 'checkbox', checked: !Array.isArray(v.levels) || v.levels.includes(i + 1), disabled: !Array.isArray(v.levels) });
          box.onchange = () => { const chosen = new Set(v.levels); if (box.checked) chosen.add(i + 1); else chosen.delete(i + 1); v.levels = [...chosen].sort((a, b) => a - b); touch(); };
          return make('label', { class: 'check' }, box, `${i + 1} · ${l.name || 'Level'}`);
        }));
      };
      allLevels.onchange = () => { if (allLevels.checked) delete v.levels; else v.levels = r.levels.map((_, i) => i + 1); touch(); drawPicks(); };
      drawPicks();
      v.sources ??= {}; v.destinations ??= {}; // empty ones are dropped on save
      const idInput = input(p, 'id', { label: 'Profile ID', help: 'Used in links: ?profile=ID', maxlength: 256, spellcheck: 'false', autocapitalize: 'off', after: () => { const o = defaultSelect.querySelector(`option[value="${p.key}"]`); if (o) o.textContent = p.id || '(no ID yet)'; heading.textContent = p.id || 'New profile'; } });
      const heading = make('strong', { text: p.id || 'New profile' });
      box.append(make('div', { class: 'profile' },
        make('div', { class: 'profile-head' }, heading, make('button', { type: 'button', class: 'danger', text: 'Remove', disabled: r._profiles.length === 1, onclick: () => removeProfile(r, p) })),
        make('div', { class: 'fields' },
          idInput,
          input(v, 'label', { label: 'Name in profile menu', placeholder: p.id, parse: optionalText, maxlength: 256 }),
          input(v, 'title', { label: 'Panel title', placeholder: config.title, help: 'Blank uses the panel title.', parse: optionalText, maxlength: 256 }),
          input(v, 'pin', { label: 'PIN', type: 'password', placeholder: 'No PIN', autocomplete: 'new-password', parse: (x) => x || undefined, maxlength: 256 }),
          input(v.sources, 'include', { label: 'Sources this profile sees', placeholder: 'Same as the panel', parse: optionalText, spellcheck: 'false' }),
          input(v.destinations, 'include', { label: 'Destinations this profile sees', placeholder: 'Same as the panel', parse: optionalText, spellcheck: 'false' }),
          make('label', {}, make('span', { text: 'Access' }), checkbox(v, 'readOnly', 'Read-only (watch, no takes)')),
          make('div', { class: 'wide' }, make('label', { class: 'check' }, allLevels, 'All levels'), picks)),
      ));
    }
    box.append(make('button', { type: 'button', class: 'add', text: '+ Add profile', onclick: () => {
      let n = 1; while (r._profiles.some((x) => x.id === `profile-${n}`)) n++;
      r._profiles.push({ key: nextKey++, id: `profile-${n}`, value: {} });
      touch(); renderProfiles();
    } }));
  }
  function removeProfile(r, p) {
    if (!confirm(`Remove the “${p.id}” profile? People using it will be signed out when you save.`)) return;
    r._profiles = r._profiles.filter((x) => x !== p);
    if (r._default === p.key) r._default = r._profiles[0].key;
    touch();
    renderProfiles();
  }

  // ---- load / save --------------------------------------------------------------------------------------------
  async function loadNames() {
    try {
      const response = await fetch('/api/setup/names', { cache: 'no-store' });
      names = response.ok ? await response.json() : null;
    } catch { names = null; }
    if (!config) return;
    renderActiveStatus();
    for (const kind of ['sources', 'destinations']) updatePreview(kind);
  }
  async function load() {
    const response = await fetch('/__hub/settings', { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (response.status === 404 || !type.includes('json')) throw Error('Router Panel settings are managed by Tech Hub. Open Router Panel from Tech Hub on this computer (or, if you run the panel on its own, edit config.json as described in the README).');
    const value = await response.json();
    if (!response.ok) throw Error(value.error || `Settings could not be loaded (${response.status}).`);
    revision = response.headers.get('etag');
    config = migrate(value);
    config.routers = config.routers.map(toModel);
    if (!routerById(editing)) editing = config.activeRouter;
    $('title').value = config.title ?? '';
    $('title').oninput = () => { config.title = $('title').value; touch(); };
    renderRouters();
    renderEditor();
    dirty = false;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    let body;
    try { body = payload(); } catch (error) { show(error.message, 'error'); return; }
    saveButton.disabled = true;
    show('Saving and applying…', 'busy');
    try {
      const response = await fetch('/__hub/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || `Saving failed (${response.status}).`);
      const scroll = window.scrollY;
      await load();
      window.scrollTo(0, scroll);
      show('Saved and applied to the panel.', 'success');
      setTimeout(loadNames, 1500);
      setTimeout(loadNames, 5000);
    } catch (error) {
      show(error.message, 'error');
    } finally {
      saveButton.disabled = false;
    }
  };
  $('addRouter').onclick = addRouter;
  $('editing').onchange = () => { editing = $('editing').value; renderEditor(); };
  addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link && dirty && !confirm('Leave without saving your changes?')) event.preventDefault();
  });

  (async () => {
    try {
      await Promise.all([load(), loadNames()]);
      $('loading').hidden = true;
      form.hidden = false;
      renderActiveStatus();
      for (const kind of ['sources', 'destinations']) updatePreview(kind);
      setInterval(() => { if (!document.hidden) loadNames(); }, 15000);
    } catch (error) {
      $('loading').textContent = error.message;
      $('loading').className = 'note error';
    }
  })();
})();
