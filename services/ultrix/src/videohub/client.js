import { EventEmitter } from 'node:events';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

// Blackmagic Videohub Ethernet Protocol (text over TCP 9990, v2.3 - still current; newer firmware only adds
// blocks, which the spec tells clients to ignore). The router pushes its whole state on connect and every
// change afterwards, to every client, so there is no polling or name request dance as with SW-P-08.
// Ports are 0-based on the wire and 1-based here, matching the rest of the panel. A Videohub has one level.

const DEFAULTS = {
  host: '127.0.0.1',
  port: 9990,
  allowRouting: true, // false = read-only: only status requests and pings (blocks without a body) are sent
  pollSeconds: 15, // PING interval; no data for twice this long means the connection is dead
  ackTimeoutMs: 2000, // ACK/NAK carry no request ID, so a missing ACK leaves the stream unaccountable: reconnect
  loadTimeoutMs: 4000, // ask again for any part of the initial dump that has not arrived by then
};

const REQUIRED = ['INPUT LABELS', 'OUTPUT LABELS', 'VIDEO OUTPUT ROUTING'];

/** Splits the byte stream into blocks: { header, lines }. ACK and NAK arrive as header-only blocks. */
export class BlockReader {
  #buffer = '';
  #header = null;
  #lines = [];

  push(text) {
    this.#buffer += text;
    const blocks = [];
    for (let i = this.#buffer.indexOf('\n'); i >= 0; i = this.#buffer.indexOf('\n')) {
      const line = this.#buffer.slice(0, i).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(i + 1);
      if (this.#header === null) {
        if (line === 'ACK' || line === 'NAK') { this.#header = line; this.#lines = []; continue; }
        const m = /^([^:]+):\s*$/.exec(line);
        if (m) { this.#header = m[1].trim(); this.#lines = []; }
        continue; // blank lines between blocks, or noise outside a block
      }
      if (line === '') {
        blocks.push({ header: this.#header, lines: this.#lines });
        this.#header = null;
        this.#lines = [];
      } else {
        this.#lines.push(line);
      }
    }
    return blocks;
  }
}

/** Same surface as Swp08Client, so ManagedRouter and the panel treat both router types alike. */
export class VideohubClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.opts = { ...DEFAULTS, ...options };
    this.status = 'disconnected';
    this.sourceNames = new Map();
    this.destNames = new Map();
    this.routes = new Map();
    this.device = { present: null, model: '', inputs: 0, outputs: 0 };
    this.socket = null;
    this.stopped = true;
    this.lastRx = 0;
    this.pending = []; // FIFO of commands awaiting ACK/NAK
    this.queue = Promise.resolve();
    this.retryMs = 1000;
    this.timers = new Set();
    this.seen = new Set(); // block headers received on this connection
    this.labelWaiters = new Set();
    this.namesTimer = null;
    this.namesLoadedAt = null;
    this.nameChanges = 0;
    this.refreshing = null;
  }

  start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.namesTimer);
    this.socket?.destroy();
  }

  get ready() {
    return this.status === 'ready';
  }

  get allowRouting() {
    return this.opts.allowRouting !== false;
  }

  routesFor(dest) {
    return this.routes.get(dest) ?? new Map();
  }

  #log(level, msg) {
    this.emit('log', level, msg);
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  #later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  // ---- connection -------------------------------------------------------------------------

  #connect() {
    if (this.stopped) return;
    const { host, port } = this.opts;
    this.#log('info', `connecting to Videohub ${host}:${port}`);
    const socket = net.connect({ host, port });
    this.socket = socket;
    const reader = new BlockReader();
    socket.setEncoding('utf8'); // labels may be UTF-8; the decoder copes with characters split across packets
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
    socket.setTimeout(8000, () => { if (this.status === 'disconnected') socket.destroy(); });

    socket.on('connect', () => {
      socket.setTimeout(0);
      this.retryMs = 1000;
      this.lastRx = Date.now();
      this.seen.clear();
      this.routes.clear();
      this.sourceNames.clear();
      this.destNames.clear();
      this.device = { present: null, model: '', inputs: 0, outputs: 0 };
      this.#setStatus('loading');
      this.#log('info', 'connected');
      this.#later(() => this.#requestMissing(socket), this.opts.loadTimeoutMs);
      this.#startHealthCheck(socket);
    });
    socket.on('data', (text) => {
      this.lastRx = Date.now();
      for (const block of reader.push(text)) this.#onBlock(block);
    });
    socket.on('error', (err) => this.#log('warn', `socket error: ${err.message}`));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const p of this.pending.splice(0)) { clearTimeout(p.timer); p.reject(new Error('connection closed')); }
      this.#setStatus('disconnected');
      if (this.stopped) return;
      this.#log('warn', `disconnected, retrying in ${this.retryMs} ms`);
      this.#later(() => this.#connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10000);
    });
  }

  #startHealthCheck(socket) {
    const tick = () => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastRx > this.opts.pollSeconds * 2000 + 5000) {
        this.#log('warn', 'Videohub stopped responding, reconnecting');
        socket.destroy();
        return;
      }
      this.send('PING').catch(() => { /* the ACK timeout already reconnects */ });
      this.#later(tick, this.opts.pollSeconds * 1000);
    };
    this.#later(tick, this.opts.pollSeconds * 1000);
  }

  /** The dump arrives unasked on connect; if part of it is missing, ask for those blocks explicitly. */
  #requestMissing(socket) {
    if (this.socket !== socket || this.ready) return;
    if (this.device.present !== 'true' && this.device.present !== null) return; // no router attached: nothing to ask
    for (const header of ['VIDEOHUB DEVICE', ...REQUIRED]) {
      if (!this.seen.has(header)) this.send(header).catch(() => {});
    }
  }

  // ---- sending ----------------------------------------------------------------------------

  /**
   * Send one block and wait for ACK. One command at a time: ACK/NAK carry no ID, and a Videohub silently drops
   * commands that arrive in a burst. A block with no body lines is a status request (or PING) and never changes
   * anything, which is what read-only mode is limited to.
   */
  send(header, lines = []) {
    if (!this.allowRouting && lines.length) return Promise.reject(new Error(`refused to send ${header}: routing is disabled`));
    const p = this.queue.then(() => this.#sendNow(header, lines));
    this.queue = p.catch(() => {});
    return p;
  }

  #sendNow(header, lines) {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.destroyed) { reject(new Error('not connected')); return; }
      const entry = { resolve, reject };
      entry.timer = setTimeout(() => {
        const i = this.pending.indexOf(entry);
        if (i >= 0) this.pending.splice(i, 1);
        reject(new Error('ACK timeout'));
        this.#log('warn', 'Videohub stopped acknowledging commands, reconnecting');
        socket.destroy();
      }, this.opts.ackTimeoutMs);
      this.pending.push(entry);
      socket.write(`${header}:\n${lines.map((l) => `${l}\n`).join('')}\n`);
    });
  }

  // ---- receiving --------------------------------------------------------------------------

  #onBlock({ header, lines }) {
    if (header === 'ACK' || header === 'NAK') {
      const p = this.pending.shift();
      if (!p) return;
      clearTimeout(p.timer);
      if (header === 'ACK') p.resolve(); else p.reject(new Error('the Videohub refused the command (NAK)'));
      return;
    }
    this.seen.add(header);
    switch (header) {
      case 'VIDEOHUB DEVICE': this.#onDevice(lines); break;
      case 'INPUT LABELS': this.#onLabels(this.sourceNames, lines, header); break;
      case 'OUTPUT LABELS': this.#onLabels(this.destNames, lines, header); break;
      case 'VIDEO OUTPUT ROUTING':
        for (const line of lines) {
          const m = /^(\d+)\s+(\d+)\s*$/.exec(line);
          if (m) this.#applyRoute(Number(m[1]) + 1, Number(m[2]) + 1);
        }
        break;
      default: break; // monitoring outputs, serial ports, locks, hardware status and later additions are not used
    }
    this.#checkReady();
  }

  #onDevice(lines) {
    const info = {};
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    this.device = { present: info['Device present'] ?? null, model: info['Model name'] ?? '', inputs: Number(info['Video inputs']) || 0, outputs: Number(info['Video outputs']) || 0 };
    if (this.device.present === 'true') {
      this.#log('info', `Videohub: ${this.device.model || 'router'} with ${this.device.inputs} inputs and ${this.device.outputs} outputs`);
    } else {
      this.#log('warn', this.device.present === 'needs_update' ? 'the Videohub needs a firmware update before it can be controlled' : 'the Videohub server reports no router attached');
      if (this.ready) this.#setStatus('loading');
    }
  }

  #onLabels(map, lines, header) {
    for (const line of lines) {
      const m = /^(\d+)(?: (.*))?$/.exec(line);
      if (!m) continue;
      const n = Number(m[1]) + 1;
      const name = (m[2] ?? '').trim();
      if (map.has(n) && map.get(n) !== name) this.nameChanges++;
      map.set(n, name);
    }
    for (const waiter of this.labelWaiters) waiter(header);
    if (this.ready && !this.refreshing) {
      // Someone renamed a port (Videohub Setup, another panel): the router pushes it, so just pass it on.
      clearTimeout(this.namesTimer);
      this.namesTimer = setTimeout(() => { this.namesLoadedAt = Date.now(); this.emit('names'); }, 300);
    }
  }

  #applyRoute(dest, src) {
    let levels = this.routes.get(dest);
    if (!levels) this.routes.set(dest, levels = new Map());
    const previousSrc = levels.get(1);
    if (previousSrc === src) return;
    levels.set(1, src);
    this.emit('route', { dest, level: 1, src, previousSrc: previousSrc ?? 0, initial: this.status !== 'ready' });
  }

  #checkReady() {
    if (this.status !== 'loading' || this.device.present !== 'true') return;
    if (!REQUIRED.every((h) => this.seen.has(h))) return;
    this.namesLoadedAt = Date.now();
    this.#setStatus('ready');
    this.emit('names');
  }

  // ---- names & routing --------------------------------------------------------------------

  /** Re-request both label blocks. Resolves { changed, loadedAt } once both have arrived. */
  refreshNames(timeoutMs = 10000) {
    if (!this.ready) return Promise.reject(new Error('router not ready'));
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.nameChanges = 0;
      const got = new Set();
      let waiter;
      const done = new Promise((resolve) => {
        waiter = (header) => { got.add(header); if (got.has('INPUT LABELS') && got.has('OUTPUT LABELS')) resolve(); };
        this.labelWaiters.add(waiter);
        this.#later(resolve, timeoutMs);
      });
      try {
        await this.send('INPUT LABELS');
        await this.send('OUTPUT LABELS');
        await done;
      } finally { this.labelWaiters.delete(waiter); }
      clearTimeout(this.namesTimer);
      this.namesLoadedAt = Date.now();
      this.emit('names');
      return { changed: this.nameChanges, loadedAt: this.namesLoadedAt };
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /**
   * Route src to dest, then wait for the router's own routing update. Resolves { confirmed, actual } - confirmed
   * is false if the router did not report the change in time (for example the output is locked elsewhere).
   */
  async route({ dest, src, levels = [1] }, timeoutMs = 3000) {
    if (!this.allowRouting) throw new Error('routing is disabled (router.allowRouting is not true); nothing was sent');
    if (!this.ready) throw new Error('router not ready');
    if (!Number.isInteger(dest) || dest < 1 || !Number.isInteger(src) || src < 1) throw new RangeError('dest and src must be positive integers');
    if (levels.some((l) => l !== 1)) throw new RangeError('a Videohub has one level');
    await this.send('VIDEO OUTPUT ROUTING', [`${dest - 1} ${src - 1}`]);
    const deadline = Date.now() + timeoutMs;
    while (this.routesFor(dest).get(1) !== src && Date.now() < deadline) await sleep(40);
    return { confirmed: this.routesFor(dest).get(1) === src, actual: Object.fromEntries(this.routesFor(dest)) };
  }
}
