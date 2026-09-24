// A small Blackmagic Videohub simulator for development and tests. Implements the parts of the Ethernet protocol
// the panel uses: the connect-time status dump, routing and label changes (pushed to every client), status
// requests, PING, ACK/NAK. Outputs listed in `locked` behave like ports locked by another client: the change is
// acknowledged but not applied, as a real Videohub does.
import net from 'node:net';
import { BlockReader } from './client.js';

export function demoVideohubNames() {
  const list = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
  return {
    inputs: [...list('CAM', 12), 'ATEM PGM', 'ATEM PVW', ...list('ATEM AUX', 4), ...list('HYPERDECK', 6), ...list('GFX', 4), ...list('PC', 4), ...list('SAT', 4), 'BARS', 'BLACK', 'CLOCK', 'SPARE'],
    outputs: [...list('MON', 12), ...list('REC', 6), ...list('ATEM IN', 12), ...list('MV', 4), ...list('STREAM', 2), ...list('PROJ', 4)],
  };
}

/**
 * options: { inputs, outputs (name lists), initialRoutes ({ [output]: input }, 1-based), locked (1-based
 *   outputs), devicePresent, model, chaos (ms between random external route changes), log }
 */
export function createVideohubMock(options = {}) {
  const demo = demoVideohubNames();
  const opts = { devicePresent: true, model: 'Videohub simulator', locked: [], chaos: 0, log: () => {}, ...options };
  const inputs = [...(opts.inputs ?? demo.inputs)];
  const outputs = [...(opts.outputs ?? demo.outputs)];
  const routes = outputs.map((_, i) => opts.initialRoutes?.[i + 1] ?? 1); // routes[output-1] = input (1-based)
  const locked = new Set(opts.locked);
  const clients = new Set();
  const received = []; // every block a client has sent: { header, lines }

  const block = (header, lines = []) => `${header}:\n${lines.map((l) => `${l}\n`).join('')}\n`;
  const labels = (names) => names.map((name, i) => `${i} ${name}`);
  const routing = (outs = outputs.map((_, i) => i)) => outs.map((o) => `${o} ${routes[o] - 1}`);
  const lockState = () => outputs.map((_, i) => `${i} ${locked.has(i + 1) ? 'L' : 'U'}`);
  const blocks = {
    'VIDEOHUB DEVICE': () => block('VIDEOHUB DEVICE', opts.devicePresent
      ? ['Device present: true', `Model name: ${opts.model}`, `Video inputs: ${inputs.length}`, 'Video processing units: 0', `Video outputs: ${outputs.length}`, 'Video monitoring outputs: 0', 'Serial ports: 0']
      : ['Device present: false']),
    'INPUT LABELS': () => block('INPUT LABELS', labels(inputs)),
    'OUTPUT LABELS': () => block('OUTPUT LABELS', labels(outputs)),
    'VIDEO OUTPUT ROUTING': () => block('VIDEO OUTPUT ROUTING', routing()),
    'VIDEO OUTPUT LOCKS': () => block('VIDEO OUTPUT LOCKS', lockState()),
  };
  const broadcast = (text) => { for (const s of clients) s.write(text); };

  function handle(socket, { header, lines }) {
    received.push({ header, lines });
    if (header === 'PING' && !lines.length) return true;
    if (!lines.length) { // status request: resend that block
      if (!blocks[header] || !opts.devicePresent) return false;
      socket.write('ACK\n\n');
      socket.write(blocks[header]());
      return null;
    }
    if (header === 'VIDEO OUTPUT ROUTING') {
      const changes = lines.map((l) => /^(\d+)\s+(\d+)$/.exec(l)).map((m) => m && [Number(m[1]), Number(m[2])]);
      if (changes.some((c) => !c || c[0] >= outputs.length || c[1] >= inputs.length)) return false;
      socket.write('ACK\n\n');
      const changed = changes.filter(([o, i]) => !locked.has(o + 1) && routes[o] !== i + 1);
      for (const [o, i] of changed) routes[o] = i + 1;
      if (changed.length) broadcast(block('VIDEO OUTPUT ROUTING', routing(changed.map(([o]) => o))));
      return null;
    }
    if (header === 'INPUT LABELS' || header === 'OUTPUT LABELS') {
      const names = header === 'INPUT LABELS' ? inputs : outputs;
      const changes = lines.map((l) => /^(\d+)(?: (.*))?$/.exec(l));
      if (changes.some((m) => !m || Number(m[1]) >= names.length)) return false;
      socket.write('ACK\n\n');
      for (const m of changes) names[Number(m[1])] = m[2] ?? '';
      broadcast(block(header, changes.map((m) => `${m[1]} ${names[Number(m[1])]}`)));
      return null;
    }
    return false;
  }

  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.setEncoding('utf8');
    socket.write(block('PROTOCOL PREAMBLE', ['Version: 2.3']));
    socket.write(blocks['VIDEOHUB DEVICE']());
    if (opts.devicePresent) for (const header of ['INPUT LABELS', 'OUTPUT LABELS', 'VIDEO OUTPUT ROUTING', 'VIDEO OUTPUT LOCKS']) socket.write(blocks[header]());
    const reader = new BlockReader();
    socket.on('data', (text) => {
      for (const b of reader.push(text)) {
        const result = handle(socket, b);
        if (result === true) socket.write('ACK\n\n');
        else if (result === false) socket.write('NAK\n\n');
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
  });

  let chaosTimer = null;
  return {
    server,
    received,
    get routes() { return [...routes]; },
    inputs,
    outputs,
    sourceCount: inputs.length,
    destCount: outputs.length,
    /** An external change (another controller): applied and pushed to every client. */
    setRoute(output, input) {
      routes[output - 1] = input;
      broadcast(block('VIDEO OUTPUT ROUTING', [`${output - 1} ${input - 1}`]));
    },
    rename(kind, n, name) {
      const header = kind === 'source' ? 'INPUT LABELS' : 'OUTPUT LABELS';
      (kind === 'source' ? inputs : outputs)[n - 1] = name;
      broadcast(block(header, [`${n - 1} ${name}`]));
    },
    listen: (port = 9990, host = '0.0.0.0') => new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => {
        server.removeListener('error', onError);
        if (opts.chaos) {
          chaosTimer = setInterval(() => {
            const output = 1 + Math.floor(Math.random() * outputs.length);
            const input = 1 + Math.floor(Math.random() * inputs.length);
            if (!locked.has(output) && routes[output - 1] !== input) { routes[output - 1] = input; broadcast(block('VIDEO OUTPUT ROUTING', [`${output - 1} ${input - 1}`])); }
          }, opts.chaos);
          chaosTimer.unref();
        }
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.listen(port, host, onListening);
    }),
    close: () => new Promise((resolve) => {
      clearInterval(chaosTimer);
      for (const s of clients) s.destroy();
      server.close(resolve);
    }),
  };
}
