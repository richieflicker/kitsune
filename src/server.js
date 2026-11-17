// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { review, runCheck } from './check.js';
import { createStore } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIST = path.resolve(here, '..', 'dashboard', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Only pages served from this machine (Storybook on localhost:6006, say) may call the API cross-origin. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The Host header must also be local. Otherwise DNS rebinding lets any website talk to this server. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const MAX_BODY_BYTES = 1024 * 1024;

function send(res, status, body, type = 'application/json') {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  const origin = res.req?.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

/** Resolve `rel` under `root`, refusing anything that escapes it. */
function inside(root, rel) {
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

export function startServer(cfg, { port = cfg.server.port } = {}) {
  const store = createStore(cfg);
  const imageRoots = {
    new: store.paths.newDir,
    diff: store.paths.diffDir,
    baselines: store.paths.baselines,
  };

  // One check at a time, started from the dashboard or the Storybook panel.
  const run = {
    state: { running: false, startedAt: null, finishedAt: null, error: null, done: 0, total: 0, ran: [] },
    snapshot() {
      const { state } = run;
      const manifest = store.readManifest();
      // Per-browser result of the last run, so the panel can show a status dot for each browser.
      const byBrowser = {};
      for (const s of manifest?.stories ?? []) {
        const b = (byBrowser[s.browser] ??= { total: 0, pending: 0 });
        b.total += 1;
        if (s.status === 'changed' || s.status === 'rejected' || s.status === 'error') b.pending += 1;
      }
      return {
        ...state,
        browsers: cfg.browsers.map((b) => b.name),
        byBrowser,
        summary: manifest?.summary ?? null,
        buildId: manifest?.buildId ?? null,
      };
    },
    start(only) {
      const names = cfg.browsers.map((b) => b.name);
      const chosen = Array.isArray(only) && only.length ? only : names;
      const unknown = chosen.filter((n) => !names.includes(n));
      if (unknown.length) throw Object.assign(new Error(`Unknown browser: ${unknown.join(', ')}. Configured: ${names.join(', ')}`), { status: 400 });
      const runCfg = { ...cfg, browsers: cfg.browsers.filter((b) => chosen.includes(b.name)) };
      Object.assign(run.state, { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, done: 0, total: 0, ran: chosen });
      runCheck(runCfg, { progress: (done, total) => Object.assign(run.state, { done, total }) })
        .catch((err) => { run.state.error = err.message; })
        .finally(() => Object.assign(run.state, { running: false, finishedAt: new Date().toISOString() }));
    },
  };

  const server = http.createServer(async (req, res) => {
    res.req = req;

    try {
      if (!LOCAL_HOST.test(req.headers.host ?? '')) return send(res, 403, { error: 'Host not allowed' });
      const url = new URL(req.url, 'http://x');
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, { error: 'Malformed URL' });
      }

      // Preflight for the Storybook "Visual tests" panel (a different local port).
      if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        if (!origin || !LOCAL_ORIGIN.test(origin)) return send(res, 403, { error: 'Origin not allowed' });
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-requested-with',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        });
        return res.end();
      }

      // Every state-changing call must carry this header. A plain cross-site form or no-cors fetch
      // cannot set it, and a cross-origin fetch that does is stopped by the preflight above.
      if (req.method === 'POST' && req.headers['x-requested-with'] !== 'kitsune') {
        return send(res, 403, { error: 'Missing x-requested-with: kitsune header' });
      }

      if (req.method === 'GET' && pathname === '/api/mode') return send(res, 200, { mode: 'local', ui: cfg.ui });

      if (req.method === 'GET' && pathname === '/api/run') return send(res, 200, run.snapshot());

      if (req.method === 'POST' && pathname === '/api/run') {
        if (run.state.running) return send(res, 409, { error: 'A check is already running', ...run.snapshot() });
        const body = await readBody(req);
        try {
          run.start(body.browsers);
        } catch (err) {
          return send(res, err.status ?? 500, { error: err.message });
        }
        return send(res, 202, run.snapshot());
      }

      if (req.method === 'GET' && pathname === '/api/build') {
        const manifest = store.readManifest();
        return manifest ? send(res, 200, manifest) : send(res, 404, { error: 'No build yet. Run `kitsune check`.' });
      }

      if (req.method === 'POST' && (pathname === '/api/approve' || pathname === '/api/reject')) {
        const body = await readBody(req);
        const keys = body.all ? 'all' : Array.isArray(body.keys) ? body.keys : body.key ? [body.key] : [];
        if (keys !== 'all' && !keys.length) return send(res, 400, { error: 'Provide key, keys[] or all:true' });
        const manifest = review(cfg, pathname.endsWith('approve') ? 'approve' : 'reject', keys);
        return send(res, 200, manifest);
      }

      if (req.method === 'GET' && pathname.startsWith('/images/')) {
        const [, , kind, ...rest] = pathname.split('/');
        const root = imageRoots[kind];
        const file = root && inside(root, rest.join('/'));
        return file ? sendFile(res, file) : send(res, 404, { error: 'Not found' });
      }

      if (req.method === 'GET') {
        if (!fs.existsSync(DASHBOARD_DIST)) {
          return send(res, 200, 'Dashboard not built yet. Run: npm run build:dashboard', 'text/plain');
        }
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
        const file = inside(DASHBOARD_DIST, rel);
        return sendFile(res, file && fs.existsSync(file) ? file : path.join(DASHBOARD_DIST, 'index.html'));
      }

      send(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      send(res, err.status ?? 500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, server }));
  });
}
