import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smallNames, startPair, until } from './helpers.js';

test('extended router: loads names and crosspoints, routes and confirms', async () => {
  const { mock, client, stop } = await startPair();
  try {
    assert.equal(client.useExtended, true, 'auto-detected extended commands');
    await until(() => client.sourceNames.size === mock.sourceCount && client.destNames.size === mock.destCount, 5000, 'names');
    assert.equal(client.sourceNames.get(1), 'CAM 01');
    assert.equal(client.destNames.get(65), 'REC 01');
    assert.equal(client.routesFor(300).get(3), 1, 'initial tally dump populated all destinations and levels');

    const result = await client.route({ dest: 300, src: 250, levels: [1, 3] });
    assert.equal(result.confirmed, true);
    assert.deepEqual(result.actual, { 1: 250, 2: 1, 3: 250 });
    assert.equal(mock.routes[0][299], 250);
    assert.equal(mock.routes[1][299], 1, 'level 2 untouched (breakaway)');
  } finally { await stop(); }
});

test('standard-only router (no extended commands) still handles ports above 128 and 256', async () => {
  const { mock, client, stop } = await startPair({ mock: { extended: false } });
  try {
    assert.equal(client.useExtended, false);
    assert.equal(client.routesFor(310).get(1), 1, 'word-format tally dump parsed');
    const result = await client.route({ dest: 300, src: 250, levels: [1, 2, 3] });
    assert.equal(result.confirmed, true);
    assert.equal(mock.routes[2][299], 250);
  } finally { await stop(); }
});

test('falls back to interrogating destinations when the router has no tally dump', async () => {
  const { client, stop } = await startPair({
    mock: { dump: false, sources: smallNames('S', 12), dests: smallNames('D', 9) },
    client: { destinations: 9 },
  });
  try {
    assert.equal(client.routesFor(9).get(3), 1);
    assert.equal(client.routesFor(1).get(1), 1);
  } finally { await stop(); }
});

test('reports unconfirmed when the router ignores the connect (protected destination)', async () => {
  const { client, stop } = await startPair({ mock: { protectedDests: [7], sources: smallNames('S', 20), dests: smallNames('D', 20) } });
  try {
    const result = await client.route({ dest: 7, src: 5, levels: [1] }, 600);
    assert.equal(result.confirmed, false);
    assert.equal(result.actual[1], 1);
  } finally { await stop(); }
});

test("emits 'route' for changes made by another controller, marked non-initial, with the prior source", async () => {
  const { mock, client, stop } = await startPair({ mock: { sources: smallNames('S', 20), dests: smallNames('D', 20) } });
  try {
    const seen = [];
    client.on('route', (e) => seen.push(e));
    mock.setRoute(2, 4, 9); // dest 4 starts on source 1 (the mock's default)
    await until(() => seen.length === 1, 2000, 'route event');
    assert.deepEqual(seen[0], { dest: 4, level: 2, src: 9, previousSrc: 1, initial: false });

    mock.setRoute(2, 4, 15);
    await until(() => seen.length === 2, 2000, 'second route event');
    assert.equal(seen[1].previousSrc, 9, 'previousSrc tracks the source that was actually there, not just 1');
  } finally { await stop(); }
});

test('rejects invalid routes and refuses to route before ready', async () => {
  const { client, stop } = await startPair({ mock: { sources: smallNames('S', 20), dests: smallNames('D', 20) } });
  try {
    await assert.rejects(() => client.route({ dest: 0, src: 1, levels: [1] }), RangeError);
  } finally { await stop(); }
});

test('reconnects by itself after the connection drops and reloads state', async () => {
  const { client, stop } = await startPair({ mock: { sources: smallNames('S', 20), dests: smallNames('D', 20) } });
  try {
    const statuses = [];
    client.on('status', (s) => statuses.push(s));
    client.socket.destroy();
    await until(() => statuses.includes('disconnected'), 2000, 'disconnect noticed');
    await until(() => client.ready, 8000, 'reconnected');
    assert.ok(statuses.includes('loading'));
    assert.equal(client.routesFor(3).get(1), 1);
  } finally { await stop(); }
});

const READ_ONLY_COMMANDS = new Set([0x01, 0x81, 0x15, 0x95, 0x61, 0x64, 0x66, 0xe4, 0xe6]);

test('safety: with routing disabled, loading and a route attempt send no crosspoint connect', async () => {
  const { mock, client, stop } = await startPair({
    mock: { sources: smallNames('S', 20), dests: smallNames('D', 20) },
    client: { allowRouting: false },
  });
  try {
    assert.equal(client.allowRouting, false);
    await assert.rejects(() => client.route({ dest: 3, src: 4, levels: [1, 2, 3] }), /routing is disabled/);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(mock.received.length > 0);
    const forbidden = mock.received.filter((c) => !READ_ONLY_COMMANDS.has(c));
    assert.deepEqual(forbidden, [], 'router only ever received read queries');
    assert.equal(mock.routes[0][2], 1, 'crosspoint unchanged');
  } finally { await stop(); }
});

test('routing is on by default and only an explicit false makes the connection read-only', async () => {
  const { Swp08Client } = await import('../src/swp08/client.js');
  assert.equal(new Swp08Client({}).allowRouting, true);
  assert.equal(new Swp08Client({ allowRouting: true }).allowRouting, true);
  assert.equal(new Swp08Client({ allowRouting: false }).allowRouting, false);
});

test('safety: with routing disabled, send() refuses every command that is not a read query', async () => {
  const { mock, client, stop } = await startPair({
    mock: { sources: smallNames('S', 20), dests: smallNames('D', 20) },
    client: { allowRouting: false },
  });
  try {
    const before = mock.received.length;
    for (const payload of [[0x02, 0, 0, 1, 2], [0x82, 0, 0, 0, 1, 0, 2], [0x0c, 0, 0, 0, 0, 0, 0], [0x78, 0, 0], [0x1d, 0]]) {
      await assert.rejects(() => client.send(payload), /routing is disabled/);
    }
    await client.send([0x01, 0x00, 0x00, 0x00]); // a plain interrogate is still allowed
    assert.equal(mock.received.length, before + 1, 'only the interrogate reached the router');
  } finally { await stop(); }
});

test('"no source" (0xFFFF) is reported as source 0, not source 65536', async () => {
  const { mock, client, stop } = await startPair({
    mock: { sources: smallNames('S', 20), dests: smallNames('D', 20), initialRoutes: { 2: { 1: 5, 2: 65536, 3: 65536 } } },
  });
  try {
    assert.deepEqual([...client.routesFor(2)], [[1, 5], [2, 0], [3, 0]]);
    mock.setRoute(2, 2, 7);
    await until(() => client.routesFor(2).get(2) === 7, 2000, 'route to arrive');
  } finally { await stop(); }
});

test('name length: "auto" negotiates the longest length the router accepts', async () => {
  const long = ['Camera 1 Wide Shot Left', 'HiR14-Academy Ballroom', 'Record 01 Monitor'];
  const wide = await startPair({ mock: { sources: long, dests: smallNames('D', 5) } });
  try {
    await until(() => wide.client.sourceNames.size === 3, 3000, 'names');
    assert.equal(wide.client.nameChars, 32);
    assert.deepEqual([...wide.client.sourceNames.values()], long, 'full names, nothing cut off');
  } finally { await wide.stop(); }

  const narrow = await startPair({ mock: { sources: ['Camera 1', 'HiR14-Acad'], dests: smallNames('D', 5), maxNameChars: 12 } });
  try {
    await until(() => narrow.client.sourceNames.size === 2, 3000, 'names');
    assert.equal(narrow.client.nameChars, 12, 'fell back after the router refused 32 and 16');
    assert.equal(narrow.client.sourceNames.get(2), 'HiR14-Acad');
  } finally { await narrow.stop(); }

  const fixed = await startPair({ mock: { sources: long, dests: smallNames('D', 5) }, client: { nameChars: 12 } });
  try {
    await until(() => fixed.client.sourceNames.size === 3, 3000, 'names');
    assert.equal(fixed.client.sourceNames.get(2), 'HiR14-Academ', 'a fixed 12 truncates, which is what hid the long names');
  } finally { await fixed.stop(); }
});

test('refreshNames picks up renames and reports how many names changed', async () => {
  const { mock, client, stop } = await startPair({ mock: { sources: smallNames('S', 10), dests: smallNames('D', 10) } });
  try {
    await until(() => client.sourceNames.size === 10 && client.destNames.size === 10, 3000, 'names');
    const firstLoad = client.namesLoadedAt;
    mock.rename('source', 3, 'Studio Camera Three', false);
    mock.rename('dest', 4, 'Green Room Monitor', false);
    const result = await client.refreshNames();
    assert.equal(result.changed, 2);
    assert.equal(client.sourceNames.get(3), 'Studio Camera Three');
    assert.equal(client.destNames.get(4), 'Green Room Monitor');
    assert.ok(result.loadedAt >= firstLoad);
    const again = await client.refreshNames();
    assert.equal(again.changed, 0, 'nothing renamed since');
  } finally { await stop(); }
});

test('a "names updated" notice from the router triggers one automatic refresh', async () => {
  const { mock, client, stop } = await startPair({
    mock: { sources: smallNames('S', 10), dests: smallNames('D', 10) },
    client: { namesNoticeDelayMs: 50 },
  });
  try {
    await until(() => client.destNames.size === 10, 3000, 'names');
    await new Promise((r) => setTimeout(r, 2200)); // past the echo-guard window after the initial load
    const namesRequestsBefore = mock.received.filter((c) => c === 0xe4).length;
    let events = 0;
    client.on('names', () => events++);
    mock.rename('dest', 2, 'Renamed Dest', true);
    mock.rename('dest', 3, 'Also Renamed', true); // a burst of notices must not cause two refreshes
    await until(() => client.destNames.get(3) === 'Also Renamed' && events >= 1, 4000, 'automatic refresh and names event');
    assert.equal(client.destNames.get(2), 'Renamed Dest');
    await new Promise((r) => setTimeout(r, 600)); // long enough for a wrongly scheduled second refresh to show up
    assert.equal(mock.received.filter((c) => c === 0xe4).length, namesRequestsBefore + 1, 'exactly one refresh for the burst');
  } finally { await stop(); }
});

test('refreshNames needs a ready router, and works on a read-only connection using only read queries', async () => {
  const { Swp08Client } = await import('../src/swp08/client.js');
  await assert.rejects(() => new Swp08Client({}).refreshNames(), /not ready/);

  const { mock, client, stop } = await startPair({
    mock: { sources: smallNames('S', 6), dests: smallNames('D', 6) },
    client: { allowRouting: false },
  });
  try {
    mock.rename('source', 1, 'Renamed', false);
    assert.equal((await client.refreshNames()).changed, 1);
    assert.deepEqual(mock.received.filter((c) => !READ_ONLY_COMMANDS.has(c)), []);
  } finally { await stop(); }
});
