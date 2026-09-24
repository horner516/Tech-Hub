// A small SW-P-08 router simulator for development and tests. Not a faithful Ultrix model:
// it implements the commands the panel uses (standard + extended), ACKs/NAKs like a router, and
// broadcasts crosspoint changes to every connected controller.
import net from 'node:net';
import { ACK_FRAME, NAK_FRAME, Deframer, encode } from './swp08/frame.js';
import { CMD } from './swp08/commands.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function demoNames() {
  const sources = [];
  const add = (prefix, count, width = 2) => { for (let i = 1; i <= count; i++) sources.push(`${prefix} ${pad(i, width)}`); };
  add('CAM', 24);
  add('RPL', 8);
  add('SAT', 16);
  add('IP', 32);
  add('GFX', 12);
  add('PLAY', 8);
  add('LIVEU', 6);
  add('STUDIO', 6);
  add('AUX', 190, 3);
  sources.push('BLACK', 'BARS', 'TEST');
  const dests = [];
  const addD = (prefix, count, width = 2) => { for (let i = 1; i <= count; i++) dests.push(`${prefix} ${pad(i, width)}`); };
  addD('MON', 64);
  addD('REC', 32);
  addD('ENC', 32);
  addD('MV', 16);
  addD('TX', 12);
  addD('MTX', 24);
  addD('SPARE', 130, 3);
  return { sources, dests };
}

/**
 * options: { levels, extended, dump, names, chaos, sources, dests, log }
 *   extended: advertise + accept extended commands; dump: support tally dumps (NAK them otherwise)
 *   chaos: ms interval at which a random destination is re-routed, simulating another operator
 */
export function createMockRouter(options = {}) {
  const opts = { levels: 3, extended: true, dump: true, chaos: 0, log: () => {}, ...options };
  const { sources: srcNames, dests: dstNames } = opts.sources && opts.dests ? { sources: opts.sources, dests: opts.dests } : demoNames();
  const clients = new Set();
  // routes[level-1][dest-1] = src (1-based), everything starts on source 1
  const routes = Array.from({ length: opts.levels }, () => Array.from({ length: dstNames.length }, () => 1));
  // initialRoutes: { [dest]: { [level]: src } } to start from a recorded state (src 0 = no source)
  for (const [dest, perLevel] of Object.entries(opts.initialRoutes ?? {})) {
    for (const [level, src] of Object.entries(perLevel)) if (routes[level - 1]) routes[level - 1][dest - 1] = src === 65536 ? 0 : src;
  }
  const protectedDests = new Set(opts.protectedDests ?? []);
  const received = []; // every command byte the mock has been sent, for tests

  const send = (socket, payload) => socket.write(encode(payload));
  const broadcast = (payload) => { for (const s of clients) send(s, payload); };

  const wire = (src) => (src === 0 ? 0xffff : src - 1); // 0 = no source
  const routePayload = (cmdStd, cmdExt, level, dest, src, ext) => ext
    ? [cmdExt, 0, level - 1, (dest - 1) >> 8, (dest - 1) & 0xff, wire(src) >> 8, wire(src) & 0xff]
    : [cmdStd, level - 1, (((dest - 1) >> 7) << 4) | ((src - 1) >> 7), (dest - 1) & 0x7f, (src - 1) & 0x7f];

  function chunkNames(names, chars, perPacket, build) {
    const out = [];
    for (let first = 0; first < names.length; first += perPacket) {
      const part = names.slice(first, first + perPacket);
      const bytes = part.flatMap((n) => [...Buffer.from(n.slice(0, chars).padEnd(chars, ' '), 'latin1')]);
      out.push(build(first, part.length, bytes));
    }
    return out;
  }

  function handle(socket, p) {
    const cmd = p[0];
    received.push(cmd);
    const codeToChars = [4, 8, 12, 16, 32];
    switch (cmd) {
      case CMD.PROTOCOL_REQUEST: {
        const supported = [CMD.INTERROGATE, CMD.CONNECT, CMD.TALLY, CMD.CONNECTED, CMD.GET_SOURCE_NAMES, CMD.GET_DEST_NAMES];
        if (opts.dump) supported.push(CMD.TALLY_DUMP);
        if (opts.extended) supported.push(CMD.EXT_INTERROGATE, CMD.EXT_CONNECT, CMD.EXT_GET_SOURCE_NAMES, CMD.EXT_GET_DEST_NAMES);
        if (opts.extended && opts.dump) supported.push(CMD.EXT_TALLY_DUMP);
        send(socket, [CMD.PROTOCOL_RESPONSE, 0, supported.length, ...supported]);
        return true;
      }
      case CMD.INTERROGATE: {
        const level = (p[1] & 0x0f) + 1;
        const dest = ((p[2] & 0x70) << 3) + p[3] + 1;
        const src = routes[level - 1]?.[dest - 1];
        if (src === undefined) return false;
        send(socket, routePayload(CMD.TALLY, CMD.EXT_TALLY, level, dest, src, false));
        return true;
      }
      case CMD.EXT_INTERROGATE: {
        if (!opts.extended) return false;
        const level = p[2] + 1;
        const dest = ((p[3] << 8) | p[4]) + 1;
        const src = routes[level - 1]?.[dest - 1];
        if (src === undefined) return false;
        send(socket, routePayload(CMD.TALLY, CMD.EXT_TALLY, level, dest, src, true));
        return true;
      }
      case CMD.CONNECT:
      case CMD.EXT_CONNECT: {
        const ext = cmd === CMD.EXT_CONNECT;
        if (ext && !opts.extended) return false;
        const level = ext ? p[2] + 1 : (p[1] & 0x0f) + 1;
        const dest = ext ? ((p[3] << 8) | p[4]) + 1 : ((p[2] & 0x70) << 3) + p[3] + 1;
        const src = ext ? ((p[5] << 8) | p[6]) + 1 : ((p[2] & 0x07) << 7) + p[4] + 1;
        if (!routes[level - 1] || dest > dstNames.length || src > srcNames.length) return false;
        if (protectedDests.has(dest)) return true; // ACKed but ignored, like a protected destination
        setRoute(level, dest, src);
        return true;
      }
      case CMD.TALLY_DUMP:
      case CMD.EXT_TALLY_DUMP: {
        if (!opts.dump || (cmd === CMD.EXT_TALLY_DUMP && !opts.extended)) return false;
        const ext = cmd === CMD.EXT_TALLY_DUMP;
        const level = ext ? p[2] + 1 : (p[1] & 0x0f) + 1;
        if (!routes[level - 1]) return false;
        const list = routes[level - 1];
        const word = ext || dstNames.length > 256 || srcNames.length > 256;
        const per = word ? 32 : 64; // keep packets under the 133 byte SW-P-08 limit
        for (let first = 0; first < list.length; first += per) {
          const part = list.slice(first, first + per);
          if (ext) {
            const bytes = [CMD.EXT_TALLY_DUMP_WORD, 0, level - 1, part.length, first >> 8, first & 0xff];
            for (const s of part) bytes.push(wire(s) >> 8, wire(s) & 0xff);
            send(socket, bytes);
          } else if (word) {
            const bytes = [CMD.TALLY_DUMP_WORD, level - 1, part.length, first >> 8, first & 0xff];
            for (const s of part) bytes.push(wire(s) >> 8, wire(s) & 0xff);
            send(socket, bytes);
          } else {
            send(socket, [CMD.TALLY_DUMP_BYTE, level - 1, part.length, first, ...part.map((s) => s - 1)]);
          }
        }
        return true;
      }
      case CMD.GET_SOURCE_NAMES:
      case CMD.GET_DEST_NAMES:
      case CMD.EXT_GET_SOURCE_NAMES:
      case CMD.EXT_GET_DEST_NAMES: {
        const ext = cmd >= 0xe0;
        if (ext && !opts.extended) return false;
        const isSource = cmd === CMD.GET_SOURCE_NAMES || cmd === CMD.EXT_GET_SOURCE_NAMES;
        const chars = codeToChars[ext ? p[isSource ? 3 : 2] : p[2]];
        if (!chars || chars > (opts.maxNameChars ?? 32)) return false; // maxNameChars simulates routers that refuse long names
        const names = isSource ? srcNames : dstNames;
        const perPacket = Math.floor(120 / chars);
        const packets = chunkNames(names, chars, perPacket, (first, count, bytes) => {
          const code = codeToChars.indexOf(chars);
          if (ext) {
            return isSource
              ? [CMD.EXT_SOURCE_NAMES, 0, 0, code, first >> 8, first & 0xff, count, ...bytes]
              : [CMD.EXT_DEST_NAMES, 0, code, first >> 8, first & 0xff, count, ...bytes];
          }
          return [isSource ? CMD.SOURCE_NAMES : CMD.DEST_NAMES, 0, code, first >> 8, first & 0xff, count, ...bytes];
        });
        for (const pk of packets) send(socket, pk);
        return true;
      }
      default:
        return false;
    }
  }

  function setRoute(level, dest, src) {
    routes[level - 1][dest - 1] = src;
    const std = !opts.extended || (dest <= 1024 && src <= 1024 && level <= 16);
    broadcast(routePayload(CMD.CONNECTED, CMD.EXT_CONNECTED, level, dest, src, !std));
  }

  const server = net.createServer((socket) => {
    clients.add(socket);
    const deframer = new Deframer();
    socket.on('data', (chunk) => {
      for (const ev of deframer.push(chunk)) {
        if (ev.type === 'msg') {
          const ok = handle(socket, ev.payload);
          socket.write(ok ? ACK_FRAME : NAK_FRAME);
        } else if (ev.type === 'bad') {
          socket.write(NAK_FRAME);
        }
      }
    });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
  });

  let chaosTimer = null;
  return {
    server,
    routes,
    received,
    sourceCount: srcNames.length,
    destCount: dstNames.length,
    setRoute,
    /** Rename a port, and tell connected controllers (like a router does) unless notify is false. */
    rename(kind, n, name, notify = true) {
      (kind === 'source' ? srcNames : dstNames)[n - 1] = name;
      if (notify) broadcast([CMD.NAMES_UPDATED, 0]);
    },
    listen: (port = 2000, host = '0.0.0.0') => new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => {
        server.removeListener('error', onError);
        if (opts.chaos) {
          chaosTimer = setInterval(() => {
            const dest = 1 + Math.floor(Math.random() * Math.min(dstNames.length, 64));
            const src = 1 + Math.floor(Math.random() * Math.min(srcNames.length, 64));
            for (let level = 1; level <= opts.levels; level++) setRoute(level, dest, src);
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
