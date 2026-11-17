import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startServer } from '../src/server.js';
import { serveStatic } from '../src/storybook.js';

/** Raw request so we control the Host header and send paths fetch() would normalise. */
function raw(url, { path: reqPath, host, method = 'GET' }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: reqPath, method, headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serveStatic: serves files, refuses sibling-prefix folders and survives malformed URLs', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-static-'));
  const root = path.join(base, 'site');
  const sibling = path.join(base, 'site-old');
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, 'index.html'), 'ok');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'secret');

  const srv = await serveStatic(root);
  try {
    assert.equal((await raw(srv.url, { path: '/' })).body, 'ok');
    assert.equal((await raw(srv.url, { path: '/..%2fsite-old%2fsecret.txt' })).status, 403);
    assert.equal((await raw(srv.url, { path: '/%E0%A4%A' })).status, 400);
    assert.equal((await raw(srv.url, { path: '/' })).status, 200); // still alive
  } finally {
    await srv.close();
  }
});

test('local server: rejects foreign Host headers and malformed URLs without crashing', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-srv-'));
  const cfg = { dataDir, server: { port: 0 }, ui: {}, browsers: [{ name: 'chromium' }] };
  const { url, server } = await startServer(cfg, { port: 0 });
  try {
    assert.equal((await raw(url, { path: '/api/mode' })).status, 200);
    assert.equal((await raw(url, { path: '/api/mode', host: 'evil.example.com' })).status, 403);
    assert.equal((await raw(url, { path: '/api/mode', host: 'localhost:4455' })).status, 200);
    assert.equal((await raw(url, { path: '/%E0%A4%A' })).status, 400);
    assert.equal((await raw(url, { path: '/api/mode' })).status, 200); // still alive
  } finally {
    await new Promise((r) => server.close(r));
  }
});
