// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** Tiny static file server (used for a built storybook-static folder and the dashboard). */
export function serveStatic(dir, { port = 0, fallbackIndex = false } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fallbackIndex) file = path.join(root, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Start serving the built Storybook (or reuse a running URL). */
export async function resolveStorybook(cfg) {
  if (cfg.storybook.url) {
    return { baseUrl: cfg.storybook.url.replace(/\/$/, ''), close: async () => {} };
  }
  if (!fs.existsSync(cfg.storybook.dir)) {
    throw new Error(`Storybook folder not found: ${cfg.storybook.dir} (did you run \`storybook build\`?)`);
  }
  const srv = await serveStatic(cfg.storybook.dir);
  return { baseUrl: srv.url, close: srv.close };
}

/** Read the story list from Storybook's index (v7+: index.json, v6.4+: stories.json). */
export async function fetchStories(baseUrl, indexPath = 'index.json') {
  const tries = [...new Set([indexPath, 'index.json', 'stories.json'])];
  let lastErr;
  for (const p of tries) {
    try {
      const res = await fetch(`${baseUrl}/${p}`);
      if (!res.ok) {
        lastErr = new Error(`${p} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const entries = Object.values(json.entries ?? json.stories ?? {});
      return entries
        .filter((e) => (e.type ?? 'story') === 'story')
        .map((e) => ({ id: e.id, title: e.title, name: e.name, tags: e.tags ?? [] }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not read the Storybook story index at ${baseUrl}: ${lastErr?.message}`);
}

export function filterStories(stories, cfg) {
  return stories.filter((s) => {
    if (cfg.include.length && !cfg.include.some((p) => s.id.includes(p))) return false;
    if (cfg.exclude.some((p) => s.id.includes(p))) return false;
    if (s.tags.some((t) => cfg.excludeTags.includes(t))) return false;
    return true;
  });
}
