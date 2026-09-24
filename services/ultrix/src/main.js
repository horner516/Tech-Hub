import { readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createMockRouter } from './mock-router.js';
import { createVideohubMock } from './videohub/mock.js';
import { createPanelServer } from './server.js';
import { ManagedRouter } from './managed-router.js';
import validation from './validate-config.cjs';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const configPath = path.resolve(args.includes('--config') ? args[args.indexOf('--config') + 1] : path.join(root, 'config.json'));

/** Turns a `npm run dump` router-dump.json into simulator options, so the panel can be exercised with real names offline. */
function loadReplay(file) {
  const dump = JSON.parse(readFileSync(file, 'utf8'));
  const toList = (map) => {
    const max = Math.max(0, ...Object.keys(map).map(Number));
    return Array.from({ length: max }, (_, i) => map[i + 1] ?? '');
  };
  return { sources: toList(dump.sources), dests: toList(dump.destinations), initialRoutes: dump.routes };
}

// config.json holds several saved routers; the panel runs on the active one, resolved to the single-router shape.
function readConfig(){const raw=loadConfig(configPath);if(process.env.TECH_HUB_MANAGED==='1')validation.validateRouterPanel(raw);return validation.resolve(raw);}
let config = readConfig();
const log = (level, msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${level.padEnd(5)} ${msg}`);
const levelCount = () => (config.levels ?? [{}]).length;

let mock = null;
if (config.mock?.enabled) {
  const replay = config.mock.replay ? loadReplay(path.resolve(path.dirname(configPath), config.mock.replay)) : {};
  const videohub = config.router.type === 'videohub';
  mock = videohub ? createVideohubMock({ chaos: 0, ...config.mock, log }) : createMockRouter({ levels: levelCount(), chaos: 0, ...replay, ...config.mock, log });
  const port = await mock.listen(config.router.port, '127.0.0.1');
  log('info', `mock ${videohub ? 'Videohub' : 'SW-P-08'} router listening on 127.0.0.1:${port} (${mock.sourceCount} sources, ${mock.destCount} destinations)`);
}

// Routing is on unless config.router.allowRouting is explicitly false (a read-only connection).
const allowRouting = config.router.allowRouting !== false;
const router = new ManagedRouter();
log('info', allowRouting ? 'routing enabled' : 'routing DISABLED (router.allowRouting is false): read-only, nothing will be sent to change a route');
router.on('log', log);
router.on('status', (s) => log('info', `router ${s}`));
router.configure(config);
log('info', `active router: ${config.routerName} (${config.router.type === 'videohub' ? 'Blackmagic Videohub' : 'SW-P-08'})`);
if (!config.router.host) log('info', 'Add the router address in Router Panel settings (/setup) to connect.');

function reloadConfig(){const raw=loadConfig(configPath);validation.validateRouterPanel(raw);const next=validation.resolve(raw);const accessChanged=!isDeepStrictEqual(config.profiles,next.profiles)||config.readOnly!==next.readOnly,routerChanged=config.routerId!==next.routerId;router.configure(next);config=next;panel.invalidate({accessChanged,routerChanged});log('info',routerChanged?`switched to router ${next.routerName}`:'settings applied live');}
const panel = createPanelServer({ getConfig: () => config, router, publicDir: path.join(root, 'public'), reloadConfig });
const port = await panel.listen(Number(process.env.TECH_HUB_BACKEND_PORT || config.server?.port || 8080), process.env.TECH_HUB_BACKEND_HOST || config.server?.host || '0.0.0.0');
log('info', `panel on http://localhost:${port}`);

// Watch the directory: atomic configuration saves replace the file inode. Managed saves use the authenticated reload endpoint.
let reloadTimer;
if(process.env.TECH_HUB_MANAGED!=='1')watch(path.dirname(configPath),(_,name)=>{if(String(name)!==path.basename(configPath))return;clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>{try{reloadConfig();}catch(err){log('error','config reload failed: '+err.message);}},200);});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    router.stop();
    await panel.close();
    await mock?.close();
    process.exit(0);
  });
}
