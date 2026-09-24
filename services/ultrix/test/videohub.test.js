import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BlockReader, VideohubClient } from '../src/videohub/client.js';
import { createVideohubMock } from '../src/videohub/mock.js';
import { until } from './helpers.js';

const names = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

async function startVideohub({ mock: mockOpts = {}, client: clientOpts = {} } = {}) {
  const mock = createVideohubMock({ inputs: names('IN', 12), outputs: names('OUT', 8), ...mockOpts });
  const port = await mock.listen(0, '127.0.0.1');
  const client = new VideohubClient({ host: '127.0.0.1', port, ackTimeoutMs: 500, loadTimeoutMs: 300, ...clientOpts });
  client.start();
  return { mock, client, async stop() { client.stop(); await mock.close(); } };
}

test('BlockReader: blocks split across packets, CRLF, header-only ACK/NAK, labels with spaces, stray lines', () => {
  const reader = new BlockReader();
  assert.deepEqual(reader.push('PROTOCOL PREAMBLE:\r\nVersion: 2.3\r\n'), []);
  assert.deepEqual(reader.push('\r\nINPUT LABELS:\n0 Camera 1 wide\n1 \n2'), [{ header: 'PROTOCOL PREAMBLE', lines: ['Version: 2.3'] }]);
  assert.deepEqual(reader.push('\n\nACK\n\n\nnoise outside a block\nNAK\n\n'), [
    { header: 'INPUT LABELS', lines: ['0 Camera 1 wide', '1 ', '2'] },
    { header: 'ACK', lines: [] },
    { header: 'NAK', lines: [] },
  ]);
});

test('loads the status dump, becomes ready, and exposes 1-based names and routes on one level', async () => {
  const { client, stop } = await startVideohub({ mock: { initialRoutes: { 3: 7 } } });
  try {
    await until(() => client.ready, 3000, 'ready');
    assert.equal(client.sourceNames.get(1), 'IN 1');
    assert.equal(client.destNames.get(8), 'OUT 8');
    assert.equal(client.routesFor(3).get(1), 7);
    assert.deepEqual([...client.routesFor(3).keys()], [1], 'a Videohub has one level');
    assert.equal(client.device.inputs, 12);
  } finally { await stop(); }
});

test('routes, waits for the router to confirm, and reports the change with its previous source', async () => {
  const { mock, client, stop } = await startVideohub();
  try {
    await until(() => client.ready, 3000, 'ready');
    const events = [];
    client.on('route', (e) => events.push(e));
    const result = await client.route({ dest: 5, src: 9, levels: [1] });
    assert.deepEqual(result, { confirmed: true, actual: { 1: 9 } });
    assert.equal(mock.routes[4], 9, 'the simulator applied it (0-based on the wire)');
    assert.deepEqual(events, [{ dest: 5, level: 1, src: 9, previousSrc: 1, initial: false }]);
    await assert.rejects(() => client.route({ dest: 5, src: 2, levels: [2] }), /one level/);
    await assert.rejects(() => client.route({ dest: 99, src: 1, levels: [1] }), /NAK/, 'out-of-range output is refused by the router');
  } finally { await stop(); }
});

test('changes and renames made elsewhere are pushed live; refreshNames counts what changed', async () => {
  const { mock, client, stop } = await startVideohub();
  try {
    await until(() => client.ready, 3000, 'ready');
    const seen = [];
    client.on('route', (e) => seen.push(e));
    mock.setRoute(2, 11);
    await until(() => seen.length === 1, 2000, 'external route');
    assert.deepEqual(seen[0], { dest: 2, level: 1, src: 11, previousSrc: 1, initial: false });

    let namesEvents = 0;
    client.on('names', () => namesEvents++);
    mock.rename('dest', 4, 'Stage Left');
    await until(() => client.destNames.get(4) === 'Stage Left' && namesEvents === 1, 2000, 'pushed rename');

    mock.inputs[0] = 'Renamed quietly'; // changed without a push; a refresh must find it
    const refreshed = await client.refreshNames();
    assert.equal(refreshed.changed, 1);
    assert.equal(client.sourceNames.get(1), 'Renamed quietly');
  } finally { await stop(); }
});

test('a locked output acknowledges but does not change, so the take is reported unconfirmed', async () => {
  const { client, stop } = await startVideohub({ mock: { locked: [6] } });
  try {
    await until(() => client.ready, 3000, 'ready');
    const result = await client.route({ dest: 6, src: 3, levels: [1] }, 400);
    assert.deepEqual(result, { confirmed: false, actual: { 1: 1 } });
  } finally { await stop(); }
});

test('safety: read-only sends only status requests and pings, never a routing or label change', async () => {
  const { mock, client, stop } = await startVideohub({ client: { allowRouting: false } });
  try {
    await until(() => client.ready, 3000, 'ready');
    await assert.rejects(() => client.route({ dest: 1, src: 2, levels: [1] }), /routing is disabled/);
    await assert.rejects(() => client.send('VIDEO OUTPUT ROUTING', ['0 1']), /routing is disabled/);
    await assert.rejects(() => client.send('OUTPUT LABELS', ['0 hacked']), /routing is disabled/);
    await client.refreshNames();
    await client.send('PING');
    assert.ok(mock.received.length >= 3);
    assert.deepEqual(mock.received.filter((b) => b.lines.length), [], 'every block the router received was body-less');
    assert.equal(mock.routes[0], 1);
  } finally { await stop(); }
});

test('no router attached: stays loading instead of pretending to be live', async () => {
  const { client, stop } = await startVideohub({ mock: { devicePresent: false } });
  try {
    await until(() => client.status === 'loading' && client.device.present === 'false', 2000, 'device report');
    await new Promise((r) => setTimeout(r, 500)); // past the re-request window
    assert.equal(client.ready, false);
  } finally { await stop(); }
});

test('reconnects by itself and reloads state after the connection drops', async () => {
  const { client, stop } = await startVideohub();
  try {
    await until(() => client.ready, 3000, 'ready');
    const statuses = [];
    client.on('status', (s) => statuses.push(s));
    client.socket.destroy();
    await until(() => statuses.includes('disconnected') && client.ready, 8000, 'reconnected');
    assert.ok(statuses.includes('loading'));
    assert.equal(client.destNames.get(1), 'OUT 1');
  } finally { await stop(); }
});
