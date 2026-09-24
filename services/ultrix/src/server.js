import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildView, defaultProfile, profileInfo, profileNames } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const REFRESH_COOLDOWN_MS = 5000;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const SETUP_FILES = { '/setup': 'setup.html', '/setup.html': 'setup.html', '/setup.js': 'setup.js', '/setup.css': 'setup.css' };
/** The settings page and its data are for the Tech Hub computer only (Tech Hub marks those requests), like NETGEAR's setup. */
const settingsClient = (req) => LOOPBACK.includes(req.socket.remoteAddress) && (process.env.TECH_HUB_MANAGED !== '1' || req.headers['x-techhub-local-client'] === '1');

/**
 * HTTP + SSE front end. `router` is a ManagedRouter, Swp08Client or VideohubClient (they share one surface).
 * Access control model: a profile may carry a `pin`; the browser logs in once per profile and gets
 * an HttpOnly session cookie. Profiles without a pin are open to anyone who can reach the port.
 */
export function createPanelServer({ getConfig, router, publicDir, reloadConfig }) {
  const sessions = new Map(); // sid -> Set<profile>
  const clients = new Set(); // { res, profile }
  const views = new Map();
  const activity = [];
  let lastRefreshAt = 0;
  let activeCommands=0;
  // Revert support: previousRoutes.get(dest) is that destination's full per-level source map as it was
  // immediately before the most recent burst of changes (its own "one step back"). Rebuilt fresh each
  // time a new burst starts (see the 750ms grouping below, which matches how `activity` entries group);
  // a revert's own resulting changes start the next burst, so pressing Revert twice swaps back and forth.
  // Caveat: the 750ms window exists to group one multi-level take's several level-events into a single
  // burst, not to distinguish "same action" from "next action" - a revert fired within 750ms of the
  // change it's undoing lands in that same burst and won't move previousRoutes, so a second revert
  // right after (faster than any real button click) is a no-op rather than toggling further back.
  const previousRoutes = new Map(); // dest -> Map<level, src>
  const routeBursts = new Map(); // dest -> { startedAt, touchedLevels: Set<level> }

  const cfg = () => getConfig();
  const viewFor = (profile) => {
    if (!views.has(profile)) {
      const view = buildView(cfg(), profile, { sources: router.sourceNames, destinations: router.destNames }, {
        sources: cfg().sources?.count ?? 0,
        destinations: cfg().destinations?.count ?? 0,
      });
      if (router.allowRouting === false) { view.readOnly = true; view.json.readOnly = true; }
      view.json.namesLoadedAt = router.namesLoadedAt ?? null;
      views.set(profile, view);
    }
    return views.get(profile);
  };

  // ---- helpers ----------------------------------------------------------------------------

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };

  const cookieSid = (req) => /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];

  const authorized = (req, profile) => {
    const info = profileInfo(cfg(), profile);
    if (!info) return false;
    if (!info.locked) return true;
    return sessions.get(cookieSid(req))?.has(profile) ?? false;
  };

  async function readJson(req) {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('content-type must be application/json'), { status: 415 });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw Object.assign(new Error('body too large'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
  }

  function snapshot(profile) {
    const view = viewFor(profile);
    const routes = {};
    for (const dest of view.destSet) {
      const levels = router.routes.get(dest);
      if (!levels) continue;
      const entry = {};
      for (const [level, src] of levels) if (view.levelSet.has(level)) entry[level] = src;
      if (Object.keys(entry).length) routes[dest] = entry;
    }
    return {
      status: router.status,
      routes,
      activity: activity.filter((a) => view.destSet.has(a.dest) && view.sourceSet.has(a.src)),
    };
  }

  const sse = (client, event, data) => client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // ---- router events ----------------------------------------------------------------------

  router.on('route', ({ dest, level, src, previousSrc, initial }) => {
    if (initial) return;
    const now = Date.now();
    const last = activity.at(-1);
    if (last && last.dest === dest && last.src === src && now - last.t < 750) {
      if (!last.levels.includes(level)) last.levels.push(level);
    } else {
      activity.push({ t: now, dest, src, levels: [level] });
      if (activity.length > 100) activity.shift();
    }
    let burst = routeBursts.get(dest);
    if (!burst || now - burst.startedAt > 750) {
      burst = { startedAt: now, touchedLevels: new Set() };
      routeBursts.set(dest, burst);
      previousRoutes.set(dest, new Map());
    } else {
      burst.startedAt = now;
    }
    if (!burst.touchedLevels.has(level)) {
      burst.touchedLevels.add(level);
      previousRoutes.get(dest).set(level, previousSrc ?? 0);
    }
    for (const client of clients) {
      const view = viewFor(client.profile);
      if (view.destSet.has(dest) && view.levelSet.has(level)) sse(client, 'route', { dest, level, src, t: now });
    }
  });

  router.on('status', (status) => {
    for (const client of clients) {
      sse(client, 'status', { status });
      if (status === 'ready') sse(client, 'state', snapshot(client.profile));
    }
  });

  router.on('names', () => {
    views.clear();
    for (const client of clients) sse(client, 'config', {});
  });

  const keepAlive = setInterval(() => { for (const c of clients) c.res.write(': keep-alive\n\n'); }, 20000);
  keepAlive.unref();

  // ---- routes -----------------------------------------------------------------------------

  async function api(req, res, url) {
    if(url.pathname==='/api/health'&&req.method==='GET'){
      if(process.env.TECH_HUB_MANAGED==='1'&&req.headers['x-techhub-local-client']==='1'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,200,{status:router.status,lastRx:router.lastRx});
      return json(res,403,{error:'Local Tech Hub access required'});
    }
    if(url.pathname==='/api/reload-config'){
      if(!reloadConfig||process.env.TECH_HUB_MANAGED!=='1'||req.headers['x-techhub-local-client']!=='1'||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,403,{error:'Local Tech Hub access required'});
      if(req.method!=='POST'||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`))return json(res,403,{error:'Local POST required'});
      await readJson(req);
      if(activeCommands)return json(res,409,{error:'Wait for the current router operation to finish.'});
      try{reloadConfig();return json(res,200,{ok:true});}catch(error){return json(res,400,{error:error.message});}
    }
    if (url.pathname === '/api/setup/names' && req.method === 'GET') {
      if (!settingsClient(req)) return json(res, 403, { error: 'Settings are available only on the Tech Hub computer.' });
      const c = cfg();
      return json(res, 200, { routerId: c.routerId ?? null, routerName: c.routerName ?? null, status: router.status, sources: [...router.sourceNames], destinations: [...router.destNames] });
    }
    const profile = url.searchParams.get('profile') ?? defaultProfile(cfg());

    if (req.method === 'GET' && url.pathname === '/api/profiles') {
      return json(res, 200, { default: defaultProfile(cfg()), profiles: profileNames(cfg()).map((n) => profileInfo(cfg(), n)) });
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      const p = cfg().profiles?.[body.profile];
      await sleep(400); // slows down PIN guessing
      if (!p?.pin || !timingSafeEqual(sha(body.pin ?? ''), sha(p.pin))) return json(res, 403, { error: 'wrong PIN' });
      const sid = cookieSid(req) ?? randomBytes(24).toString('hex');
      if (!sessions.has(sid)) sessions.set(sid, new Set());
      sessions.get(sid).add(body.profile);
      return json(res, 200, { ok: true }, { 'set-cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
    }

    if (!profileInfo(cfg(), profile)) return json(res, 404, { error: `unknown profile "${profile}"` });
    if (!authorized(req, profile)) return json(res, 401, { error: 'PIN required', profile });

    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, viewFor(profile).json);
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, snapshot(profile));

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const client = { res, profile };
      clients.add(client);
      req.on('close', () => clients.delete(client));
      sse(client, 'state', snapshot(profile));
      return undefined;
    }

    if (req.method === 'POST' && url.pathname === '/api/refresh-names') {
      await readJson(req); // requires application/json, which keeps other websites from triggering this
      if (!router.ready) return json(res, 503, { error: `router is ${router.status}` });
      const wait = REFRESH_COOLDOWN_MS - (Date.now() - lastRefreshAt);
      if (wait > 0) return json(res, 429, { error: 'Names were only just refreshed. Try again in a few seconds.', retryAfterMs: wait });
      lastRefreshAt = Date.now();
      activeCommands++;let changed,loadedAt;try{({changed,loadedAt}=await router.refreshNames());}finally{activeCommands--;}
      return json(res, 200, { ok: true, changed, loadedAt });
    }

    if (req.method === 'POST' && url.pathname === '/api/revert') {
      const view = viewFor(profile);
      if (view.readOnly) return json(res, 403, { error: 'this profile is read-only' });
      if (!router.ready) return json(res, 503, { error: `router is ${router.status}` });
      const { dest } = await readJson(req);
      if (!Number.isInteger(dest)) return json(res, 400, { error: 'dest must be an integer' });
      if (!view.destSet.has(dest)) return json(res, 403, { error: 'destination not available' });
      if (view.lockedDests.has(dest)) return json(res, 403, { error: 'destination is protected' });

      const previous = previousRoutes.get(dest);
      const entries = [...(previous ?? [])].filter(([level]) => view.levelSet.has(level));
      if (!entries.length) return json(res, 404, { error: 'nothing to revert for this destination' });
      const sources = new Set(entries.map(([, src]) => src));
      for (const src of sources) {
        if (src !== 0 && !view.sourceSet.has(src)) return json(res, 403, { error: 'the previous source for this destination is not available in this profile' });
      }

      const groups = new Map(); // src -> levels[]
      for (const [level, src] of entries) {
        if (!groups.has(src)) groups.set(src, []);
        groups.get(src).push(level);
      }
      const results = [];
      activeCommands++;
      try {
        for (const [src, levels] of groups) {
          if (src === 0) continue; // no prior source on this level (e.g. it was never routed before) - nothing to send
          results.push({ src, levels, ...(await router.route({ dest, src, levels })) });
        }
      } finally { activeCommands--; }
      return json(res, 200, { ok: true, results });
    }

    if (req.method === 'POST' && url.pathname === '/api/take') {
      const view = viewFor(profile);
      if (view.readOnly) return json(res, 403, { error: 'this profile is read-only' });
      if (!router.ready) return json(res, 503, { error: `router is ${router.status}` });
      const { dest, src, levels } = await readJson(req);
      if (!Number.isInteger(dest) || !Number.isInteger(src) || !Array.isArray(levels) || !levels.length || !levels.every(Number.isInteger)) {
        return json(res, 400, { error: 'dest, src and levels[] must be integers' });
      }
      if (!view.destSet.has(dest)) return json(res, 403, { error: 'destination not available' });
      if (view.lockedDests.has(dest)) return json(res, 403, { error: 'destination is protected' });
      if (!view.sourceSet.has(src)) return json(res, 403, { error: 'source not available' });
      if (!levels.every((l) => view.levelSet.has(l))) return json(res, 403, { error: 'level not available' });
      activeCommands++;let result;try{result=await router.route({ dest, src, levels: [...new Set(levels)] });}finally{activeCommands--;}
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'not found' });
  }

  async function serveStatic(req, res, url) {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(publicDir, rel);
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname === '/events') await api(req, res, url);
      else if (req.method === 'GET' && SETUP_FILES[url.pathname]) {
        if (!settingsClient(req)) { res.writeHead(403, { 'content-type': 'text/plain' }).end('Settings are available only on the Tech Hub computer.'); return; }
        await serveStatic(req, res, new URL('/' + SETUP_FILES[url.pathname], url));
      } else if (req.method === 'GET') await serveStatic(req, res, url);
      else res.writeHead(405).end();
    } catch (err) {
      if (!res.headersSent) json(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' });
      if (!err.status) console.error(err);
    }
  });

  return {
    server,
    /** Call after the config file changes so open browsers refetch it. */
    invalidate({accessChanged=false,routerChanged=false}={}) {
      views.clear();
      // A different router means different port numbers: old activity and undo history would point at the wrong things.
      if(routerChanged){activity.length=0;previousRoutes.clear();routeBursts.clear();}
      if(accessChanged){sessions.clear();for(const client of clients)client.res.end();clients.clear();return;}
      for (const client of clients) sse(client, 'config', {});
    },
    listen: (port, host) => new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => { server.removeListener('error', onError); resolve(server.address().port); };
      server.once('error', onError);
      server.listen(port, host, onListening);
    }),
    close: () => new Promise((resolve) => {
      clearInterval(keepAlive);
      for (const c of clients) c.res.end();
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}
