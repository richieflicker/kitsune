// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { review } from './check.js';
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

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (req.method === 'GET' && pathname === '/api/mode') return send(res, 200, { mode: 'local', ui: cfg.ui });

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
      send(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, server }));
  });
}
