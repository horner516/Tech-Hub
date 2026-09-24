import { EventEmitter } from 'node:events';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { ACK_FRAME, NAK_FRAME, Deframer, encode } from './frame.js';
import * as cmd from './commands.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 2000,
  matrix: 1,
  extended: 'auto', // 'auto' | true | false
  nameChars: 'auto', // 'auto' tries 32, 16, 12, 8 characters until the router accepts one; or a fixed 4/8/12/16/32
  levels: 1, // number of levels to dump / interrogate
  destinations: 0, // known destination count, only used when the router can't do tally dumps
  pollSeconds: 30,
  allowRouting: true, // set false for a read-only connection: only read queries can then be transmitted
  ackTimeoutMs: 1000,
  ackAttempts: 2,
  loadTimeoutMs: 15000,
  namesNoticeDelayMs: 3000, // wait this long after a "names updated" notice so a burst of renames causes one refresh
};

// If allowRouting is false these are the only commands that may ever be transmitted: interrogate, tally dump,
// protocol implementation request and name requests. Everything else (connect, protect, salvo...) is refused.
const READ_ONLY_COMMANDS = new Set([
  cmd.CMD.INTERROGATE, cmd.CMD.EXT_INTERROGATE, cmd.CMD.TALLY_DUMP, cmd.CMD.EXT_TALLY_DUMP, cmd.CMD.PROTOCOL_REQUEST,
  cmd.CMD.GET_SOURCE_NAMES, cmd.CMD.GET_DEST_NAMES, cmd.CMD.EXT_GET_SOURCE_NAMES, cmd.CMD.EXT_GET_DEST_NAMES,
]);

/**
 * SW-P-08 controller connection to a router.
 *
 * Status: 'disconnected' -> 'loading' (names + tally dump) -> 'ready'. Reconnects forever with backoff.
 * Events: 'status' (status), 'route' ({ dest, level, src, previousSrc, initial }), 'names' (), 'log' (level, msg)
 * State:  sourceNames / destNames (Map<number,string>), routes (Map<dest, Map<level, src>>)
 */
export class Swp08Client extends EventEmitter {
  constructor(options = {}) {
    super();
    this.opts = { ...DEFAULTS, ...options };
    this.status = 'disconnected';
    this.sourceNames = new Map();
    this.destNames = new Map();
    this.routes = new Map();
    this.useExtended = this.opts.extended === true;
    this.socket = null;
    this.stopped = true;
    this.lastRx = 0;
    this.lastDumpAt = 0;
    this.dumpLevels = new Set();
    this.ackWaiters = [];
    this.queue = Promise.resolve();
    this.retryMs = 1000;
    this.timers = new Set();
    this.namesTimer = null;
    this.noticeTimer = null;
    this.namesLoadedAt = null; // ms timestamp of the last completed name download
    this.nameChanges = 0; // names that differed from what we already had, since this was last reset
    this.nameChars = null; // name length the router accepted
    this.refreshing = null;
    this.refreshEndedAt = 0;
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
    clearTimeout(this.noticeTimer);
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
    this.#log('info', `connecting to ${host}:${port}`);
    const socket = net.connect({ host, port });
    this.socket = socket;
    const deframer = new Deframer();
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
    socket.setTimeout(8000, () => { if (this.status === 'disconnected') socket.destroy(); });

    socket.on('connect', () => {
      socket.setTimeout(0);
      this.retryMs = 1000;
      this.lastRx = Date.now();
      this.#setStatus('loading');
      this.#log('info', 'connected');
      this.#load().catch((err) => this.#log('error', `load failed: ${err.message}`));
      this.#startHealthCheck(socket);
    });
    socket.on('data', (chunk) => {
      this.lastRx = Date.now();
      for (const ev of deframer.push(chunk)) this.#onEvent(socket, ev);
    });
    socket.on('error', (err) => this.#log('warn', `socket error: ${err.message}`));
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const w of this.ackWaiters.splice(0)) w.reject(new Error('connection closed'));
      this.#setStatus('disconnected');
      if (this.stopped) return;
      this.#log('warn', `disconnected, retrying in ${this.retryMs} ms`);
      this.#later(() => this.#connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10000);
    });
  }

  #startHealthCheck(socket) {
    const tick = async () => {
      if (this.socket !== socket) return;
      const idleMs = Date.now() - this.lastRx;
      if (idleMs > this.opts.pollSeconds * 2000 + 5000) {
        this.#log('warn', 'router stopped responding, reconnecting');
        socket.destroy();
        return;
      }
      if (this.ready) {
        try { await this.send(cmd.interrogate({ matrix: this.opts.matrix, level: 1, dest: 1 }, this.useExtended)); } catch { /* health check covers it */ }
      }
      this.#later(tick, this.opts.pollSeconds * 1000);
    };
    this.#later(tick, this.opts.pollSeconds * 1000);
  }

  // ---- sending ----------------------------------------------------------------------------

  /** Send one payload and wait for the data-link ACK. Serialised; resends once on NAK/timeout. */
  send(payload) {
    if (!this.allowRouting && !READ_ONLY_COMMANDS.has(payload[0])) {
      return Promise.reject(new Error(`refused to send command 0x${payload[0].toString(16)}: routing is disabled`));
    }
    const p = this.queue.then(() => this.#sendNow(payload));
    this.queue = p.catch(() => {});
    return p;
  }

  async #sendNow(payload) {
    let lastErr;
    for (let attempt = 1; attempt <= this.opts.ackAttempts; attempt++) {
      if (!this.socket || this.socket.destroyed) throw new Error('not connected');
      const ack = this.#waitAck();
      this.socket.write(encode(payload));
      try {
        await ack;
        await sleep(5);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  #waitAck() {
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      const timer = setTimeout(() => {
        const i = this.ackWaiters.indexOf(waiter);
        if (i >= 0) this.ackWaiters.splice(i, 1);
        reject(new Error('ACK timeout'));
      }, this.opts.ackTimeoutMs);
      this.ackWaiters.push(waiter);
    });
  }

  // ---- receiving --------------------------------------------------------------------------

  #onEvent(socket, ev) {
    switch (ev.type) {
      case 'ack': this.ackWaiters.shift()?.resolve(); break;
      case 'nak': this.ackWaiters.shift()?.reject(new Error('NAK')); break;
      case 'bad':
        this.#log('warn', `bad frame from router: ${ev.reason}`);
        socket.write(NAK_FRAME);
        break;
      case 'msg':
        socket.write(ACK_FRAME);
        this.#onMessage(cmd.parse(ev.payload), ev.payload);
        break;
    }
  }

  #onMessage(msg, payload) {
    if (!msg) { this.#log('warn', `truncated message 0x${payload[0].toString(16)}`); return; }
    if (msg.matrix !== undefined && msg.matrix !== this.opts.matrix) return;
    switch (msg.type) {
      case 'route':
        this.#applyRoute(msg.dest, msg.level, msg.src);
        break;
      case 'dump':
        this.lastDumpAt = Date.now();
        this.dumpLevels.add(msg.level);
        msg.sources.forEach((src, i) => this.#applyRoute(msg.firstDest + i, msg.level, src));
        break;
      case 'names': {
        const map = msg.kind === 'source' ? this.sourceNames : this.destNames;
        msg.names.forEach((name, i) => {
          const n = msg.first + i;
          if (map.has(n) && map.get(n) !== name) this.nameChanges++;
          map.set(n, name);
        });
        clearTimeout(this.namesTimer);
        this.namesTimer = setTimeout(() => { this.namesLoadedAt = Date.now(); this.emit('names'); }, 300);
        break;
      }
      case 'protocol':
        this.protocolCommands = msg.commands;
        this.emit('protocol', msg.commands);
        break;
      case 'namesUpdated':
        this.#onNamesNotice();
        break;
      case 'unknown':
        this.#log('debug', `ignoring command 0x${msg.cmd.toString(16)}`);
        break;
    }
  }

  #applyRoute(dest, level, src) {
    let levels = this.routes.get(dest);
    if (!levels) this.routes.set(dest, levels = new Map());
    const previousSrc = levels.get(level);
    if (previousSrc === src) return;
    levels.set(level, src);
    // previousSrc is 0 (not undefined) for a level never seen before, matching the "no source" value -
    // there is no real prior route to revert to, and callers should treat 0 that way either way.
    this.emit('route', { dest, level, src, previousSrc: previousSrc ?? 0, initial: this.status !== 'ready' });
  }

  // ---- initial load -----------------------------------------------------------------------

  async #load() {
    const socket = this.socket;
    const { matrix, levels } = this.opts;
    this.routes.clear();
    this.dumpLevels.clear();
    this.lastDumpAt = 0;

    // 1. Ask what the router implements so 'auto' can choose standard vs extended commands.
    if (this.opts.extended === 'auto') {
      this.useExtended = false;
      const answered = new Promise((resolve) => { this.once('protocol', resolve); this.#later(resolve, 2000); });
      await this.send(cmd.protocolRequest()).catch(() => {});
      const commands = await answered;
      if (Array.isArray(commands)) {
        this.useExtended = commands.includes(cmd.CMD.EXT_CONNECT) && commands.includes(cmd.CMD.EXT_INTERROGATE);
        this.#log('info', `router reports ${commands.length} commands, using ${this.useExtended ? 'extended' : 'standard'} SW-P-08`);
      } else {
        this.#log('info', 'no protocol implementation reply, using standard SW-P-08');
      }
    }
    if (this.socket !== socket) return;

    // 2. Names (answers arrive as several packets, handled in #onMessage).
    this.nameChars = null;
    await this.#requestNames().catch((e) => this.#log('warn', e.message));

    // 3. Current crosspoints, one tally dump per level; fall back to interrogating every destination.
    let dumpFailed = false;
    for (let level = 1; level <= levels; level++) {
      await this.send(cmd.tallyDumpRequest({ matrix, level }, this.useExtended)).catch(() => { dumpFailed = true; });
    }
    if (dumpFailed) {
      this.#log('warn', 'tally dump not supported, interrogating destinations instead');
      await this.#interrogateAll();
    } else {
      await this.#waitForDumps(socket);
    }
    if (this.socket !== socket) return;
    this.#setStatus('ready');
    this.emit('names');
  }

  async #waitForDumps(socket) {
    const deadline = Date.now() + this.opts.loadTimeoutMs;
    while (this.socket === socket && Date.now() < deadline) {
      const settled = this.dumpLevels.size >= this.opts.levels && Date.now() - this.lastDumpAt > 600;
      if (settled) return;
      await sleep(100);
    }
    this.#log('warn', `tally dump incomplete (${this.dumpLevels.size}/${this.opts.levels} levels)`);
  }

  async #interrogateAll() {
    const count = this.opts.destinations || this.destNames.size;
    if (!count) { this.#log('warn', 'destination count unknown, set router.destinations in config'); return; }
    for (let dest = 1; dest <= count; dest++) {
      for (let level = 1; level <= this.opts.levels; level++) {
        await this.send(cmd.interrogate({ matrix: this.opts.matrix, level, dest }, this.useExtended)).catch(() => {});
      }
    }
    await sleep(300);
  }

  /** Ask for all source and destination names. Uses the length that already worked, else negotiates. */
  async #requestNames() {
    const { matrix } = this.opts;
    const ladder = this.nameChars ? [this.nameChars] : this.opts.nameChars === 'auto' ? [32, 16, 12, 8] : [this.opts.nameChars];
    for (const chars of ladder) {
      const names = cmd.nameRequests({ matrix, chars }, this.useExtended);
      try {
        await this.send(names.source);
        await this.send(names.dest);
        this.nameChars = chars;
        this.#log('info', `requested ${chars}-character names`);
        return;
      } catch (e) {
        this.#log('warn', `router refused ${chars}-character name request (${e.message})${chars === ladder.at(-1) ? '' : ', trying shorter'}`);
      }
    }
    this.nameChars = null;
    throw new Error('the router refused every name request');
  }

  /**
   * Re-download names only (crosspoints are untouched). Resolves { changed, loadedAt } once the replies have
   * stopped arriving. Concurrent calls share one download.
   */
  refreshNames(timeoutMs = 10000) {
    if (!this.ready) return Promise.reject(new Error('router not ready'));
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.nameChanges = 0;
      const settled = new Promise((resolve) => { this.once('names', resolve); this.#later(resolve, timeoutMs); });
      await this.#requestNames();
      await settled;
      return { changed: this.nameChanges, loadedAt: this.namesLoadedAt };
    })().finally(() => { this.refreshing = null; this.refreshEndedAt = Date.now(); });
    return this.refreshing;
  }

  /** The router announced a rename. Refresh once things go quiet; ignore echoes of our own request. */
  #onNamesNotice() {
    if (this.refreshing || Date.now() - this.refreshEndedAt < 2000) return;
    this.#log('info', 'router reported a name change');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (!this.ready || this.refreshing) return;
      this.refreshNames().catch((e) => this.#log('warn', `name refresh failed: ${e.message}`));
    }, this.opts.namesNoticeDelayMs);
  }

  // ---- routing ----------------------------------------------------------------------------

  /**
   * Route src to dest on the given levels, then verify with interrogates.
   * Resolves { confirmed, actual: { [level]: src } } - confirmed is false if the router did not
   * report the new crosspoint within timeoutMs (e.g. protected destination or lost message).
   */
  async route({ dest, src, levels }, timeoutMs = 3000) {
    if (!this.allowRouting) throw new Error('routing is disabled (router.allowRouting is not true); nothing was sent');
    if (!this.ready) throw new Error('router not ready');
    const { matrix } = this.opts;
    for (const level of levels) await this.send(cmd.connect({ matrix, level, dest, src }, this.useExtended));
    for (const level of levels) await this.send(cmd.interrogate({ matrix, level, dest }, this.useExtended)).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    const matches = () => levels.every((l) => this.routesFor(dest).get(l) === src);
    while (!matches() && Date.now() < deadline) await sleep(40);
    return { confirmed: matches(), actual: Object.fromEntries(this.routesFor(dest)) };
  }
}
