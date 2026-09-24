import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createPanelServer } from '../src/server.js';
import { smallNames, startPair, until } from './helpers.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const config = {
  title: 'Test',
  levels: [{ name: 'Video', short: 'V' }, { name: 'Audio 1', short: 'A1' }, { name: 'Audio 2', short: 'A2' }],
  sources: { hidden: '19-*', categories: [{ name: 'Low', range: '1-9' }] },
  destinations: { protected: '2' },
  defaultProfile: 'op',
  profiles: {
    op: { sources: { include: '1-10' }, destinations: { include: '1-10' }, levels: [1, 2] },
    ro: { readOnly: true },
    eng: { pin: '4242' },
  },
};

let pair;
let panel;
let base;

before(async () => {
  pair = await startPair({ mock: { sources: smallNames('SRC', 20), dests: smallNames('DST', 20) } });
  panel = createPanelServer({ getConfig: () => config, router: pair.client, publicDir });
  base = `http://127.0.0.1:${await panel.listen(0, '127.0.0.1')}`;
  await until(() => pair.client.sourceNames.size === 20 && pair.client.destNames.size === 20, 3000, 'names');
});

after(async () => {
  await panel.close();
  await pair.stop();
});

const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('serves the page and lists profiles', async () => {
  assert.match(await (await fetch(base + '/')).text(), /<title>/);
  const { default: def, profiles } = await (await fetch(base + '/api/profiles')).json();
  assert.equal(def, 'op');
  assert.deepEqual(profiles.map((p) => [p.name, p.locked]), [['op', false], ['ro', false], ['eng', true]]);
});

test('static files cannot escape the public directory', async () => {
  const res = await fetch(base + '/..%2fpackage.json');
  assert.ok([403, 404].includes(res.status));
});

test('config is filtered per profile', async () => {
  const op = await (await fetch(base + '/api/config?profile=op')).json();
  assert.equal(op.sources.length, 10);
  assert.deepEqual(op.levels.map((l) => l.n), [1, 2]);
  assert.equal(op.destinations.find((d) => d.n === 2).locked, true);
  const ro = await (await fetch(base + '/api/config?profile=ro')).json();
  assert.equal(ro.sources.length, 18);
  assert.equal((await fetch(base + '/api/config?profile=nope')).status, 404);
});

test('take is validated against the profile, then routed and confirmed', async () => {
  const ok = await (await post('/api/take?profile=op', { dest: 5, src: 7, levels: [1, 2] })).json();
  assert.equal(ok.confirmed, true);
  assert.deepEqual(ok.actual, { 1: 7, 2: 7, 3: 1 });

  const cases = [
    [{ dest: 11, src: 1, levels: [1] }, 403, /destination not available/],
    [{ dest: 5, src: 11, levels: [1] }, 403, /source not available/],
    [{ dest: 5, src: 1, levels: [3] }, 403, /level not available/],
    [{ dest: 2, src: 1, levels: [1] }, 403, /protected/],
    [{ dest: 'x', src: 1, levels: [1] }, 400, /integers/],
    [{ dest: 5, src: 1, levels: [] }, 400, /integers/],
  ];
  for (const [body, status, re] of cases) {
    const res = await post('/api/take?profile=op', body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match((await res.json()).error, re);
  }
});

test('read-only profile cannot take; non-JSON posts are refused', async () => {
  assert.equal((await post('/api/take?profile=ro', { dest: 5, src: 1, levels: [1] })).status, 403);
  const res = await fetch(base + '/api/take?profile=op', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('PIN-protected profile: 401 until login, then the session cookie unlocks it', async () => {
  assert.equal((await fetch(base + '/api/config?profile=eng')).status, 401);
  assert.equal((await post('/api/login', { profile: 'eng', pin: '0000' })).status, 403);
  assert.equal((await post('/api/login', { profile: 'op', pin: '' })).status, 403, 'profile without a PIN cannot be "logged in"');

  const login = await post('/api/login', { profile: 'eng', pin: '4242' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/config?profile=eng', { headers: { cookie } })).status, 200);
  assert.equal((await post('/api/take?profile=eng', { dest: 9, src: 3, levels: [1, 2, 3] }, { cookie })).status, 200);
  assert.equal((await post('/api/take?profile=eng', { dest: 9, src: 3, levels: [1] })).status, 401, 'no cookie, no take');
});

test('SSE stream sends a snapshot, then live route changes from other controllers', async () => {
  const res = await fetch(base + '/events?profile=op');
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (event, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = new RegExp(`event: ${event}\\ndata: (.*)\\n\\n`).exec(buffer);
      if (m) { buffer = buffer.slice(m.index + m[0].length); return JSON.parse(m[1]); }
      if (Date.now() > deadline) throw new Error(`no ${event} event; buffer=${buffer}`);
      const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), 200))]);
      if (done) throw new Error('stream closed');
      if (value) buffer += decoder.decode(value);
    }
  };
  const snap = await next('state');
  assert.equal(snap.status, 'ready');
  assert.equal(snap.routes[5][1], 7, 'includes the route made in the earlier test');

  pair.mock.setRoute(1, 6, 8);
  const ev = await next('route');
  assert.deepEqual([ev.dest, ev.level, ev.src], [6, 1, 8]);
  assert.equal(typeof ev.t, 'number');

  pair.mock.setRoute(1, 15, 3); // dest 15 is outside the operator profile: must not be pushed to it
  pair.mock.setRoute(3, 7, 2); // level 3 is outside the operator profile too
  pair.mock.setRoute(2, 8, 2);
  const visible = await next('route');
  assert.deepEqual([visible.dest, visible.level, visible.src], [8, 2, 2]);
  await reader.cancel();
});

test('safety: a panel over a router with routing disabled is read-only and refuses every take', async () => {
  const locked = await startPair({ mock: { sources: smallNames('SRC', 20), dests: smallNames('DST', 20) }, client: { allowRouting: false } });
  const lockedPanel = createPanelServer({ getConfig: () => config, router: locked.client, publicDir });
  const url = `http://127.0.0.1:${await lockedPanel.listen(0, '127.0.0.1')}`;
  try {
    const cfgJson = await (await fetch(`${url}/api/config?profile=op`)).json();
    assert.equal(cfgJson.readOnly, true);
    const res = await fetch(`${url}/api/take?profile=op`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dest: 5, src: 7, levels: [1] }) });
    assert.equal(res.status, 403);
    assert.deepEqual(locked.mock.received.filter((c) => c === 0x02 || c === 0x82), []);
  } finally {
    await lockedPanel.close();
    await locked.stop();
  }
});

test('refresh-names endpoint: refreshes, reports changes, updates the timestamp, and is rate limited', async () => {
  const before = (await (await fetch(`${base}/api/config?profile=op`)).json()).namesLoadedAt;
  assert.equal(typeof before, 'number');

  pair.mock.rename('dest', 6, 'Renamed From Router', false);
  const res = await post('/api/refresh-names?profile=op', {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.changed, 1);

  const after = await (await fetch(`${base}/api/config?profile=op`)).json();
  assert.ok(after.namesLoadedAt > before, 'config carries the new load time');
  assert.equal(after.destinations.find((d) => d.n === 6).name, 'Renamed From Router');

  const again = await post('/api/refresh-names?profile=op', {});
  assert.equal(again.status, 429, 'a second refresh right away is refused');
  assert.ok((await again.json()).retryAfterMs > 0);
});

test('refresh-names honours PIN profiles and rejects non-JSON posts', async () => {
  assert.equal((await post('/api/refresh-names?profile=eng', {})).status, 401);
  const res = await fetch(`${base}/api/refresh-names?profile=op`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('revert: puts a destination back to its previous source, and a second press toggles back', async () => {
  assert.equal((await post('/api/revert?profile=op', { dest: 3 })).status, 404, 'nothing to revert before any take');

  const take1 = await post('/api/take?profile=op', { dest: 3, src: 6, levels: [1] });
  assert.equal((await take1.json()).confirmed, true);
  await sleep(800); // each step needs its own burst window (>750ms) - see the caveat in server.js
  const take2 = await post('/api/take?profile=op', { dest: 3, src: 4, levels: [1] });
  assert.equal((await take2.json()).confirmed, true);
  await sleep(800);

  const rev1 = await post('/api/revert?profile=op', { dest: 3 });
  assert.equal(rev1.status, 200);
  const body1 = await rev1.json();
  assert.equal(body1.ok, true);
  assert.deepEqual(body1.results.map((r) => [r.src, r.levels, r.confirmed]), [[6, [1], true]]);
  assert.equal(pair.client.routesFor(3).get(1), 6, 'reverted to the source before the last take');

  await sleep(800); // a real button press is never this fast; see the burst-window caveat in server.js
  assert.equal((await post('/api/revert?profile=op', { dest: 3 })).status, 200);
  assert.equal(pair.client.routesFor(3).get(1), 4, 'a second revert swaps back - the revert itself started a new batch');
});

test('revert refuses a protected destination even if it has history, and bad input is rejected', async () => {
  const protectedRes = await post('/api/revert?profile=op', { dest: 2 });
  assert.equal(protectedRes.status, 403);
  assert.match((await protectedRes.json()).error, /protected/);
  assert.equal((await post('/api/revert?profile=op', { dest: 'x' })).status, 400);
  assert.equal((await post('/api/revert?profile=op', { dest: 11 })).status, 403, 'destination outside the profile');
});

test('revert only offers levels the profile can route, and can run out of revertable levels', async () => {
  // dest 4, level 3 only - level 3 is outside op's levelSet ([1, 2]), so nothing here should be revertable
  pair.mock.setRoute(3, 4, 12);
  await until(() => pair.client.routesFor(4).get(3) === 12, 2000, 'level 3 baseline');
  await sleep(800);
  pair.mock.setRoute(3, 4, 14);
  await until(() => pair.client.routesFor(4).get(3) === 14, 2000, 'level 3 changed');

  const res = await post('/api/revert?profile=op', { dest: 4 });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /nothing to revert/);
});

test('revert refuses when the previous source is outside the profile', async () => {
  // dest 9, source 15 is outside op's sourceSet (include 1-10)
  pair.mock.setRoute(1, 9, 15);
  await until(() => pair.client.routesFor(9).get(1) === 15, 2000, 'source 15 baseline');
  await sleep(800);
  pair.mock.setRoute(1, 9, 8);
  await until(() => pair.client.routesFor(9).get(1) === 8, 2000, 'source changed to 8');

  const res = await post('/api/revert?profile=op', { dest: 9 });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /previous source/);
  assert.equal(pair.client.routesFor(9).get(1), 8, 'refused, so nothing was sent');
});

test('revert is refused for a read-only profile and requires JSON', async () => {
  assert.equal((await post('/api/revert?profile=ro', { dest: 3 })).status, 403);
  const res = await fetch(`${base}/api/revert?profile=op`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});
