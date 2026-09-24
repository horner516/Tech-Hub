import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientFor } from '../src/managed-router.js';
import { createPanelServer } from '../src/server.js';
import { Swp08Client } from '../src/swp08/client.js';
import { VideohubClient } from '../src/videohub/client.js';
import { createVideohubMock } from '../src/videohub/mock.js';
import { until } from './helpers.js';

const { migrate, resolve, validateRouterPanel } = createRequire(import.meta.url)('../src/validate-config.cjs');
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const panel = (overrides = {}) => ({ router: { type: 'swp08', host: '', port: 2000 }, levels: [{ name: 'Video' }], sources: {}, destinations: {}, defaultProfile: 'op', profiles: { op: {} }, ...overrides });
const saved = () => ({
  title: 'Router Panel',
  activeRouter: 'hub',
  routers: [
    { id: 'ultrix', name: 'Ultrix', ...panel({ levels: [{ name: 'Video' }, { name: 'Audio' }] }) },
    { id: 'hub', name: 'Studio Videohub', ...panel({ router: { type: 'videohub', host: '', port: 9990 } }) },
  ],
});

test('migrate: an old single-router config becomes one saved, active SW-P-08 router with the same setup', () => {
  const old = { title: 'Ultrix Panel', router: { host: '', port: 2000 }, levels: [{ name: 'Video' }], sources: { hidden: '5' }, destinations: {}, defaultProfile: 'op', profiles: { op: {} }, server: { port: 8080 } };
  const c = migrate(old);
  assert.equal(c.title, 'Router Panel', 'the old default title follows the rename');
  assert.deepEqual(c.server, { port: 8080 }, 'server settings stay shared');
  assert.equal(c.activeRouter, 'router-1');
  assert.deepEqual(c.routers[0].router, { type: 'swp08', host: '', port: 2000 });
  assert.deepEqual(c.routers[0].sources, { hidden: '5' });
  assert.equal(migrate({ ...old, title: 'Studio A' }).title, 'Studio A', 'a custom title is kept');
  assert.deepEqual(migrate(c), c, 'already migrated: unchanged');
  assert.equal(validateRouterPanel(old).routers.length, 1);
});

test('resolve: only the active router is used, as the single-router shape the panel runs on', () => {
  const r = resolve(saved());
  assert.equal(r.routerId, 'hub');
  assert.equal(r.routerName, 'Studio Videohub');
  assert.equal(r.router.type, 'videohub');
  assert.equal(r.title, 'Router Panel');
  assert.equal(r.routers, undefined);
  assert.throws(() => resolve({ ...saved(), activeRouter: 'gone' }), /active/);
});

test('validateRouterPanel checks every saved router, not only the active one', () => {
  assert.doesNotThrow(() => validateRouterPanel(saved()));
  const broken = saved();
  broken.routers[0].router.port = 0; // the inactive one
  assert.throws(() => validateRouterPanel(broken), /Router "Ultrix": Router port/);
  const twoLevelHub = saved();
  twoLevelHub.routers[1].levels.push({ name: 'Audio' });
  assert.throws(() => validateRouterPanel(twoLevelHub), /exactly one level/);
  assert.throws(() => validateRouterPanel({ ...saved(), routers: [] }), /between 1 and 32/);
  const dup = saved();
  dup.routers[1].id = 'ultrix';
  assert.throws(() => validateRouterPanel(dup), /used by two/);
  const badType = saved();
  badType.routers[0].router.type = 'nevion';
  assert.throws(() => validateRouterPanel(badType), /needs a type/);
});

test('clientFor picks the protocol from the router type (SW-P-08 when unset)', () => {
  assert.ok(clientFor({ host: '', port: 2000 }) instanceof Swp08Client);
  assert.ok(clientFor({ type: 'swp08', host: '', port: 2000 }) instanceof Swp08Client);
  assert.ok(clientFor({ type: 'videohub', host: '', port: 9990 }) instanceof VideohubClient);
});

test('settings page and live names are for the Tech Hub computer only', async () => {
  const mock = createVideohubMock({ inputs: ['CAM 1', 'CAM 2', 'GFX'], outputs: ['MON 1', 'REC 1'] });
  const port = await mock.listen(0, '127.0.0.1');
  const router = new VideohubClient({ host: '127.0.0.1', port, allowRouting: false });
  router.start();
  const config = resolve(saved());
  const server = createPanelServer({ getConfig: () => config, router, publicDir });
  const base = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
  const managed = process.env.TECH_HUB_MANAGED;
  try {
    await until(() => router.ready, 3000, 'videohub ready');
    const page = await fetch(base + '/setup');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Router settings/);
    assert.equal((await fetch(base + '/setup.js')).status, 200);
    const names = await (await fetch(base + '/api/setup/names')).json();
    assert.equal(names.routerId, 'hub');
    assert.deepEqual(names.sources, [[1, 'CAM 1'], [2, 'CAM 2'], [3, 'GFX']]);
    assert.deepEqual(names.destinations, [[1, 'MON 1'], [2, 'REC 1']]);

    process.env.TECH_HUB_MANAGED = '1'; // behind Tech Hub, only requests it marks as local are allowed
    for (const url of ['/setup', '/setup.js', '/api/setup/names']) {
      assert.equal((await fetch(base + url, { headers: { 'x-techhub-local-client': '0' } })).status, 403, url);
      assert.equal((await fetch(base + url, { headers: { 'x-techhub-local-client': '1' } })).status, 200, url);
    }
    const view = await (await fetch(base + '/api/config', { headers: { 'x-techhub-local-client': '0' } })).json();
    assert.deepEqual(view.router, { name: 'Studio Videohub', type: 'videohub' }, 'the panel names the active router');
    assert.equal(view.levels.length, 1);
  } finally {
    if (managed === undefined) delete process.env.TECH_HUB_MANAGED; else process.env.TECH_HUB_MANAGED = managed;
    router.stop();
    await server.close();
    await mock.close();
  }
});
