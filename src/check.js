// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { captureAll } from './capture.js';
import { git } from './ci.js';
import { comparePngs } from './compare.js';
import { REJECT_AFTER_APPROVE_MESSAGE, reviewTransition } from './review-rules.js';
import { compareRules, exceedsAllowance, resolveRules } from './rules.js';
import { createStore, storyKey, summarize } from './store.js';
import { fetchStories, filterStories, resolveStorybook } from './storybook.js';

const imageUrl = (kind, key) => `/images/${kind}/${key}.png`;

/**
 * Discover stories and screenshot them in every configured browser/viewport into store.newFile(key).
 * `onPlan({ stories, total })` runs after discovery and before any browser starts, so callers can
 * set things up first (the remote flow creates its build there, which also fails fast when the
 * server is unreachable).
 */
export async function captureRun(cfg, store, { log = () => {}, progress = () => {}, onPlan } = {}) {
  const { baseUrl, close } = await resolveStorybook(cfg);
  try {
    const stories = filterStories(await fetchStories(baseUrl, cfg.storybook.indexPath), cfg);
    if (!stories.length) throw new Error('No stories found to test (check include/exclude/excludeTags).');

    // One job per story x viewport x browser, minus whatever the overrides skip.
    const jobs = [];
    for (const browser of cfg.browsers) {
      for (const viewport of cfg.viewports) {
        for (const story of stories) {
          const rules = resolveRules(cfg, story, viewport, browser);
          if (!rules.skip) jobs.push({ story, viewport, browser, key: storyKey(story.id, viewport.name, browser.name), rules });
        }
      }
    }
    if (!jobs.length) throw new Error('Every story is skipped by the overrides, so there is nothing to capture.');

    const total = jobs.length;
    const skipped = stories.length * cfg.viewports.length * cfg.browsers.length - total;
    log(
      `Found ${stories.length} stories x ${cfg.viewports.length} viewport(s) x ${cfg.browsers.length} browser(s) [${cfg.browsers.map((b) => b.name).join(', ')}]` +
        (skipped ? `, ${skipped} skipped by overrides` : ''),
    );
    await onPlan?.({ stories, total });

    const captured = await captureAll({
      cfg,
      baseUrl,
      jobs,
      fileFor: (key) => store.newFile(key),
      onProgress: (n) => progress(n, total),
    });
    return { stories, captured };
  } finally {
    await close();
  }
}

/**
 * One local run:
 *  - no approved baseline yet  -> save it as the baseline, status "new" (auto-approved)
 *  - baseline exists, same     -> "unchanged"
 *  - baseline exists, differs  -> "changed" (waits for a human to approve/reject)
 *  - story could not render    -> "error"
 */
export async function runCheck(cfg, { log = () => {}, progress = () => {} } = {}) {
  const store = createStore(cfg);
  store.resetCurrent();
  const approved = store.readApproved();

  const { captured } = await captureRun(cfg, store, { log, progress });

  const buildId = new Date().toISOString().replace(/[:.]/g, '-');
  const items = [];

  for (const r of captured.sort((a, b) => a.key.localeCompare(b.key))) {
    const item = {
      key: r.key,
      id: r.story.id,
      title: r.story.title,
      name: r.story.name,
      viewport: r.viewport.name,
      browser: r.browser.name,
      status: 'unchanged',
      diffPixels: 0,
      diffRatio: 0,
    };

    if (!r.ok) {
      item.status = 'error';
      item.error = r.error;
    } else if (!approved[r.key] || !store.hasBaseline(r.key)) {
      fs.copyFileSync(store.newFile(r.key), store.baselineFile(r.key));
      approved[r.key] = { buildId, approvedAt: new Date().toISOString(), approvedBy: 'auto (first run)', auto: true };
      item.status = 'new';
      item.newImage = imageUrl('new', r.key);
      item.baselineImage = imageUrl('baselines', r.key);
    } else {
      const res = comparePngs(store.baselineFile(r.key), store.newFile(r.key), store.diffFile(r.key), compareRules(r.rules), cfg.impact);
      item.diffPixels = res.diffPixels;
      item.diffRatio = res.diffRatio;
      item.sizeChanged = res.sizeChanged;
      Object.assign(item, { impact: res.impact, bboxRatio: res.bboxRatio, regions: res.regions });
      item.newImage = imageUrl('new', r.key);
      item.baselineImage = imageUrl('baselines', r.key);
      if (exceedsAllowance(res, r.rules)) {
        item.status = 'changed';
        item.diffImage = imageUrl('diff', r.key);
      }
    }
    items.push(item);
  }

  store.writeApproved(approved);
  const manifest = {
    buildId,
    createdAt: new Date().toISOString(),
    commit: git('rev-parse --short HEAD'),
    branch: git('rev-parse --abbrev-ref HEAD'),
    browsers: cfg.browsers.map((b) => b.name),
    summary: summarize(items),
    stories: items,
  };
  store.writeManifest(manifest);
  return manifest;
}

/** Approve (or reject) stories from the latest run. keys = array, or 'all' for every changed one. */
export function review(cfg, action, keys) {
  const store = createStore(cfg);
  const manifest = store.readManifest();
  if (!manifest) throw new Error('No results yet. Run `kitsune check` first.');

  const approved = store.readApproved();
  // Bulk approve only touches stories still awaiting a decision. Anything a reviewer explicitly
  // rejected stays rejected until they approve it by name.
  const targets =
    keys === 'all' ? manifest.stories.filter((s) => s.status === 'changed') : manifest.stories.filter((s) => keys.includes(s.key));

  const missing = Array.isArray(keys) ? keys.filter((k) => !manifest.stories.some((s) => s.key === k)) : [];
  if (missing.length) throw new Error(`Unknown story key(s): ${missing.join(', ')}`);

  // Check everything first so a refused request changes nothing.
  if (action === 'reject' && keys !== 'all') {
    const done = targets.filter((s) => s.status === 'accepted').map((s) => s.key);
    if (done.length) throw new Error(`Cannot reject ${done.join(', ')}: ${REJECT_AFTER_APPROVE_MESSAGE}`);
  }

  for (const s of targets) {
    const next = reviewTransition(s.status, action);
    if (!next) continue; // nothing to do for this story (unchanged, new, error, ...)
    if (action === 'approve') {
      fs.copyFileSync(store.newFile(s.key), store.baselineFile(s.key));
      approved[s.key] = {
        buildId: manifest.buildId,
        approvedAt: new Date().toISOString(),
        approvedBy: process.env.USER || process.env.USERNAME || 'local',
      };
    }
    s.status = next;
  }

  manifest.summary = summarize(manifest.stories);
  store.writeApproved(approved);
  store.writeManifest(manifest);
  return manifest;
}
