// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createService, HttpError, KEY_RE } from './service.js';
import { pruneStorage } from './prune.js';
import { can, permissions } from './roles.js';
import { createFsStorage } from './storage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIST = path.resolve(here, '..', '..', 'dashboard', 'dist');

const MAX_PNG_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const COOKIE = 'kitsune_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function sendFile(res, file, headers = {}) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ...headers });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(new HttpError(413, `Body too large (limit ${limit} bytes)`));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `Body too large (limit ${limit} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, MAX_JSON_BYTES);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

/** Login throttle: 10 failed attempts per 15 minutes per client address. */
function createLoginLimiter() {
  const attempts = new Map();
  const WINDOW = 15 * 60 * 1000;
  return {
    check(ip) {
      const rec = attempts.get(ip);
      if (rec && rec.resetAt > Date.now() && rec.count >= 10) throw new HttpError(429, 'Too many failed logins. Try again later.');
    },
    fail(ip) {
      const rec = attempts.get(ip);
      if (!rec || rec.resetAt <= Date.now()) attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW });
      else rec.count += 1;
    },
    clear: (ip) => attempts.delete(ip),
  };
}

export async function startRemoteServer({ dataDir, imagesDir, diffsDir, archiveDir, port = 4456, host = '127.0.0.1', env = process.env, ui, sessionDays, retention, publicProject, onRetention = (r) => console.log(r) } = {}) {
  const db = await openDb(dataDir);
  const storage = createFsStorage({ dataDir, imagesDir, diffsDir, archiveDir });
  const svc = createService({ db, dataDir, storage, env, sessionDays });
  const limiter = createLoginLimiter();

  // Optional read-only access: anyone may look at one project's builds and images without signing in.
  // Approving, rejecting and uploading still need a review / upload token.
  const publicRow = publicProject ? db.projectByName(publicProject) : null;
  if (publicProject && !publicRow) throw new Error(`publicProject "${publicProject}" does not exist. Create it first with \`kitsune server create-project\`.`);
  const trustProxy = env.KITSUNE_TRUST_PROXY === '1';
  const secureCookie = (env.KITSUNE_PUBLIC_URL || '').startsWith('https://');

  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
  const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
  const sessionId = (req) => parseCookies(req.headers.cookie)[COOKIE] ?? null;

  /** Cookie-authenticated writes need a header a cross-site form or image cannot send. */
  const requireCsrfHeader = (req) => {
    if (req.headers['x-requested-with'] !== 'kitsune') throw new HttpError(403, 'Missing X-Requested-With header');
  };

  const routes = [];
  const route = (method, pattern, auth, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), auth, handler });

  // ---- public ----
  // The mode is not secret, and the Storybook panel (another origin) reads it to know a sign-in is needed.
  route('GET', '/api/mode', 'none', ({ res }) => send(res, 200, { mode: 'remote', ui }, { 'Access-Control-Allow-Origin': '*' }));
  route('GET', '/healthz', 'none', ({ res }) => send(res, 200, { ok: true }));

  route('POST', '/api/v1/login', 'none', async ({ req, res }) => {
    const ip = clientIp(req);
    limiter.check(ip);
    requireCsrfHeader(req);
    const body = await readJson(req);
    let result;
    try {
      result = svc.login(body.token, body.name);
    } catch (err) {
      if (err.status === 401) limiter.fail(ip);
      throw err;
    }
    limiter.clear(ip);
    const cookie = [`${COOKIE}=${encodeURIComponent(result.sessionId)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${result.maxAgeSeconds}`];
    if (secureCookie) cookie.push('Secure');
    send(res, 200, { project: result.project.name, name: result.name }, { 'Set-Cookie': cookie.join('; ') });
  });

  route('POST', '/api/v1/logout', 'none', ({ req, res }) => {
    requireCsrfHeader(req);
    svc.logout(sessionId(req));
    send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  });

  route('GET', '/api/v1/session', 'view', ({ res, project, session }) =>
    send(res, 200, { project: project.name, name: session?.name ?? null, readOnly: !session, role: session?.role ?? null, can: session ? permissions(session.role) : [] }));

  // ---- CI (upload token) ----
  route('POST', '/api/v1/builds', 'upload', async ({ req, res, project }) => {
    const created = await svc.createBuild(project, await readJson(req));
    send(res, 201, created);
  });

  route('PUT', '/api/v1/builds/(?<id>[^/]+)/snapshots/(?<key>[^/]+)', 'upload', async ({ req, res, project, params }) => {
    if (!KEY_RE.test(params.key)) throw new HttpError(400, 'Invalid snapshot key');
    let meta;
    try {
      meta = JSON.parse(Buffer.from(String(req.headers['x-kitsune-meta'] ?? ''), 'base64url').toString('utf8'));
    } catch {
      throw new HttpError(400, 'x-kitsune-meta must be base64url-encoded JSON');
    }
    const png = await readBody(req, MAX_PNG_BYTES);
    send(res, 200, svc.putSnapshot(project, params.id, params.key, meta, png));
  });

  route('PUT', '/api/v1/builds/(?<id>[^/]+)/snapshots/(?<key>[^/]+)/error', 'upload', async ({ req, res, project, params }) => {
    const body = await readJson(req);
    send(res, 200, svc.putSnapshotError(project, params.id, params.key, body.meta ?? {}, body.message));
  });

  route('POST', '/api/v1/builds/(?<id>[^/]+)/finalize', 'upload', async ({ res, project, params }) => {
    send(res, 200, await svc.finalize(project, params.id));
  });

  route('POST', '/api/v1/builds/(?<id>[^/]+)/fail', 'upload', async ({ req, res, project, params }) => {
    const body = await readJson(req);
    send(res, 200, await svc.failBuild(project, params.id, body.message));
  });

  // ---- shared read (CI or reviewer) ----
  route('GET', '/api/v1/builds/(?<id>[^/]+)', 'either-view', ({ res, project, params }) => send(res, 200, svc.getBuild(project, params.id)));

  // ---- reviewers (session) ----
  route('GET', '/api/v1/builds', 'view', ({ res, project, url }) => {
    send(res, 200, { builds: svc.listBuilds(project, { branch: url.searchParams.get('branch') || undefined, limit: url.searchParams.get('limit') }) });
  });

  for (const action of ['approve', 'reject']) {
    route('POST', `/api/v1/builds/(?<id>[^/]+)/${action}`, 'session', async ({ req, res, project, session, params }) => {
      requireCsrfHeader(req);
      if (!can(session.role, 'review')) throw new HttpError(403, 'Your role cannot approve or reject changes');
      const body = await readJson(req);
      const keys = body.all ? 'all' : Array.isArray(body.keys) ? body.keys : body.key ? [body.key] : [];
      if (keys !== 'all' && !keys.length) throw new HttpError(400, 'Provide key, keys[] or all:true');
      send(res, 200, await svc.review(project, params.id, action, keys, session.name));
    });
  }

  route('GET', '/api/v1/images/(?<hash>[a-f0-9]{64})\\.png', 'view', ({ res, project, params }) => {
    sendFile(res, svc.imageForProject(project, params.hash), { 'Cache-Control': 'private, max-age=31536000, immutable' });
  });

  route('GET', '/api/v1/diffs/(?<id>[^/]+)/(?<key>[^/]+)\\.png', 'view', ({ res, project, params }) => {
    sendFile(res, svc.diffForProject(project, params.id, params.key), { 'Cache-Control': 'private, max-age=3600' });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const pathname = url.pathname; // not decoded: route patterns are strict about their characters

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.re.exec(pathname);
        if (!match) continue;

        const ctx = { req, res, url, params: match.groups ?? {} };
        if (r.auth === 'upload' || r.auth === 'either' || r.auth === 'either-view') {
          const project = svc.authUpload(bearer(req));
          if (project) ctx.project = project;
        }
        if (!ctx.project && ['session', 'either', 'either-view', 'view'].includes(r.auth)) {
          const session = svc.authSession(sessionId(req));
          if (session) {
            ctx.session = session;
            ctx.project = session.project;
          }
        }
        if (!ctx.project && publicRow && (r.auth === 'view' || r.auth === 'either-view')) ctx.project = publicRow;
        if (r.auth !== 'none' && !ctx.project) throw new HttpError(401, 'Authentication required');
        if (r.auth === 'session' && !ctx.session) throw new HttpError(401, 'Sign in with a review token');
        return await r.handler(ctx);
      }

      if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

      // Dashboard (static; contains no data, everything it shows comes from authenticated API calls).
      if (!fs.existsSync(DASHBOARD_DIST)) return send(res, 200, 'Dashboard not built yet. Run: npm run build:dashboard');
      const rel = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1));
      const file = path.resolve(DASHBOARD_DIST, rel);
      const inside = file.startsWith(DASHBOARD_DIST + path.sep);
      sendFile(res, inside && fs.existsSync(file) ? file : path.join(DASHBOARD_DIST, 'index.html'));
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('Unhandled server error:', err);
      send(res, 500, { error: 'Internal server error' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  // Optional automatic clean-up of old builds' files (same rules as `kitsune server prune`).
  let retentionTimer = null;
  if (retention) {
    const runRetention = () => {
      try {
        const r = pruneStorage({ db, storage, olderThanDays: retention.olderThanDays, remove: retention.mode === 'delete' });
        if (r.images || r.diffs) {
          onRetention(`retention: ${r.mode === 'archive' ? 'archived' : 'deleted'} ${r.images} image(s) and ${r.diffs} diff(s) from ${r.builds} build(s) older than ${retention.olderThanDays} day(s)`);
        }
      } catch (err) {
        console.error('retention failed:', err.message);
      }
    };
    setTimeout(runRetention, 5000).unref();
    retentionTimer = setInterval(runRetention, retention.everyHours * 3600_000);
    retentionTimer.unref();
  }

  const address = server.address();
  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
    service: svc,
    close: () =>
      new Promise((resolve) => {
        if (retentionTimer) clearInterval(retentionTimer);
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}
