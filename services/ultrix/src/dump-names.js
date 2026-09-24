// Read-only: connects to the router in config.json, downloads names and current crosspoints, and writes
// them to ./exports (sources.csv, destinations.csv, summary.txt, router-dump.json). Sends no routes.
//   node src/dump-names.js [--config path] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { buildDump, toJson } from './dump.js';
import { clientFor } from './managed-router.js';
import validation from './validate-config.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const config = validation.resolve(loadConfig(path.resolve(flag('--config', path.join(root, 'config.json'))))); // the active router
const outDir = path.resolve(flag('--out', path.join(root, 'exports')));

if (config.mock?.enabled) {
  console.error('config.json still has "mock": { "enabled": true }. Turn the mock off and set the address of the active router first.');
  process.exit(1);
}

const levels = (config.levels ?? [{}]).length;
const client = clientFor({ ...config.router, allowRouting: false, levels, destinations: config.destinations?.count ?? 0 });
client.on('log', (level, msg) => { if (level !== 'debug') console.log(`  ${level}: ${msg}`); });

let lastNames = Date.now();
client.on('names', () => { lastNames = Date.now(); });
client.on('protocol', () => { lastNames = Date.now(); });

console.log('Read-only: this tool only asks the router for names and current crosspoints.');
console.log(`Connecting to ${config.router.host}:${config.router.port} (matrix ${config.router.matrix ?? 1}, ${levels} levels)...`);
client.start();

const deadline = Date.now() + 60000;
while (!client.ready && Date.now() < deadline) await sleep(200);
if (!client.ready) {
  console.error('The router did not become ready within 60 seconds. Check the router address and port, and that its control protocol is enabled.');
  client.stop();
  process.exit(1);
}

// Names arrive as many small packets; wait until none has arrived for 2 seconds (30 second cap).
const namesDeadline = Date.now() + 30000;
lastNames = Date.now();
while (Date.now() - lastNames < 2000 && Date.now() < namesDeadline) await sleep(200);
client.stop();

const data = { sourceNames: client.sourceNames, destNames: client.destNames, routes: client.routes, levels };
const dump = buildDump(data);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'sources.csv'), dump.sourcesCsv);
await writeFile(path.join(outDir, 'destinations.csv'), dump.destinationsCsv);
await writeFile(path.join(outDir, 'summary.txt'), `${dump.summary}\n`);
await writeFile(path.join(outDir, 'router-dump.json'), JSON.stringify(toJson(data, {
  generatedAt: new Date().toISOString(),
  router: { host: config.router.host, port: config.router.port, matrix: config.router.matrix ?? 1 },
  levels,
}), null, 1));

console.log(`\n${dump.summary}\n\nWrote sources.csv, destinations.csv, summary.txt and router-dump.json to ${outDir}`);
process.exit(0);
