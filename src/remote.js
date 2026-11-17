// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { captureRun } from './check.js';
import { compareRules } from './rules.js';
import { createStore } from './store.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** JSON/PNG request with retries for network errors and 5xx. 4xx errors are final. */
async function api(base, token, method, pathname, { json, body, headers } = {}) {
  const attempts = 3;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json ? JSON.stringify(json) : body,
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text.slice(0, 200) };
      }
      if (res.ok) return data;
      const err = Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
      if (res.status < 500) throw err;
      lastErr = err;
    } catch (err) {
      if (err.status && err.status < 500) throw err;
      lastErr = err;
    }
    if (i < attempts - 1) await sleep(400 * 2 ** i);
  }
  throw new Error(`Review server request failed (${method} ${pathname}): ${lastErr.message}`);
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

/**
 * Capture locally, upload every screenshot to the shared review server, and let the server compare
 * against the branch baselines. Returns { manifest, build }.
 */
export async function runRemoteCheck(cfg, { url, token, branch, commit, ancestors, log = () => {}, progress = () => {} }) {
  const base = url.replace(/\/$/, '');
  const store = createStore(cfg);
  store.resetCurrent();

  let build = null;
  try {
    const { captured } = await captureRun(cfg, store, {
      log,
      progress,
      // Create the build as soon as the plan is known: GitHub shows "pending" while we capture,
      // and a wrong URL/token fails before any browser is launched.
      onPlan: async ({ total }) => {
        build = await api(base, token, 'POST', '/api/v1/builds', {
          json: {
            branch,
            commit,
            ancestors: ancestors ?? undefined,
            browsers: cfg.browsers.map((b) => b.name),
            expected: total,
            threshold: cfg.threshold,
            maxDiffPixels: cfg.maxDiffPixels,
          },
        });
        log(`Build ${build.id} created on ${branch}${commit ? ` @ ${commit.slice(0, 7)}` : ''}`);
      },
    });

    log(`Uploading ${captured.length} snapshots...`);
    await pool(captured, 4, async (r) => {
      const meta = { storyId: r.story.id, title: r.story.title, name: r.story.name, viewport: r.viewport.name, browser: r.browser.name, rules: compareRules(r.rules) };
      const route = `/api/v1/builds/${build.id}/snapshots/${r.key}`;
      if (r.ok) {
        await api(base, token, 'PUT', route, {
          body: fs.readFileSync(store.newFile(r.key)),
          headers: { 'Content-Type': 'image/png', 'x-kitsune-meta': b64(meta) },
        });
      } else {
        await api(base, token, 'PUT', `${route}/error`, { json: { meta, message: r.error } });
      }
    });

    const manifest = await api(base, token, 'POST', `/api/v1/builds/${build.id}/finalize`);
    return { manifest, build };
  } catch (err) {
    // Don't leave the pull request stuck on "pending" if the run died half way.
    if (build) await api(base, token, 'POST', `/api/v1/builds/${build.id}/fail`, { json: { message: err.message } }).catch(() => {});
    throw err;
  }
}
