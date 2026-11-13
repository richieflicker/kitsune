// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConfigRules } from './rules.js';

export const defaults = {
  // Point at ONE of: a built Storybook folder (served for you) or a running URL.
  storybook: {
    dir: null, // e.g. './storybook-static'
    url: null, // e.g. 'http://localhost:6006'
    indexPath: 'index.json',
  },
  viewports: [{ name: 'desktop', width: 1280, height: 720 }],
  // Engines to test in. Strings ('chromium' | 'firefox' | 'webkit') or objects like
  // { name: 'chrome-stable', type: 'chromium', channel: 'chrome' }. Every browser keeps its own
  // baselines. Install engines with: npx playwright install chromium firefox webkit
  browsers: ['chromium'],
  // pixelmatch colour tolerance (0 strict .. 1 loose). 0.1 (pixelmatch's default) can hide
  // subtle colour shifts on faded elements; 0.05 catches them. Raise it if your CI renders
  // differently from your laptop (better: render in the same pinned Docker image).
  threshold: 0.05,
  // A story is "changed" when more than this many pixels differ.
  maxDiffPixels: 0,
  concurrency: 4,
  delay: 100, // ms to wait after the story is ready, before the screenshot
  timeout: 30000,
  include: [], // story id substrings; empty = all
  exclude: [], // story id substrings to skip
  excludeTags: ['skip-visual'], // Storybook tags that opt a story out
  readySelector: '#storybook-root > *, #root > *',
  css: '', // extra CSS injected before each screenshot (hide clocks, etc.)
  screenshot: { fullPage: true, selector: null },
  // Legacy/shortcut overrides applied to Chromium entries only (e.g. a system Chrome in Docker/CI).
  browser: { executablePath: process.env.KITSUNE_BROWSER_PATH || undefined, channel: undefined, args: [] },
  dataDir: '.kitsune',
  server: { port: 4455 }, // the local `kitsune serve` dashboard

  // ---- capture environment (same for every screenshot) ----
  colorScheme: 'light', // 'light' | 'dark' | 'no-preference' (prefers-color-scheme)
  reducedMotion: 'reduce', // 'reduce' | 'no-preference'
  locale: 'en-US',
  timezoneId: 'UTC',
  deviceScaleFactor: 1, // 2 = retina screenshots (bigger files, sharper diffs)
  freezeAnimations: true, // stop CSS animations/transitions before the screenshot
  waitForFonts: true, // wait for web fonts and image decoding

  // ---- what to do on the page before the screenshot (each can also be set per story in `overrides`) ----
  waitFor: null, // CSS selector that must exist before the screenshot (e.g. '[data-loaded]')
  hide: [], // selectors set to visibility:hidden (layout is kept), e.g. ['.clock', '.avatar']
  mask: [], // selectors painted over with `maskColor` (same size, so layout and diffs stay honest)
  maskColor: '#ff00ff',
  ignoreRegions: [], // [{ x, y, width, height }] in screenshot pixels, painted solid in every screenshot

  // ---- how a screenshot is compared with its baseline ----
  includeAA: false, // true = count anti-aliased edge pixels as differences too
  allowSizeChange: false, // true = a page that got taller/shorter is judged by its pixels like any other change
  maxDiffRatio: null, // e.g. 0.001 = tolerate up to 0.1% of the page; a story changes only above BOTH limits

  // Per-story adjustments, later entries win:
  // overrides: [
  //   { match: 'charts-', threshold: 0.2, maxDiffPixels: 200 },
  //   { match: /^atoms-clock/, mask: ['.time'] },
  //   { match: 'modal', viewports: ['desktop'], delay: 400, waitFor: '[role=dialog]' },
  //   { match: 'legacy-', skip: true },
  //   { match: 'hero', viewport: 'mobile', browser: 'webkit', ignoreRegions: [{ x: 0, y: 0, width: 390, height: 60 }] },
  // ]
  overrides: [],

  // ---- review dashboard defaults (each reviewer can still change them; their choice is remembered) ----
  ui: {
    filter: 'review', // first list shown: 'review' | 'new' | 'accepted' | 'unchanged' | 'all'
    view: 'side', // 'side' | 'slider' | 'diff' | 'new' | 'baseline'
    zoom: 'fit', // 'fit' | 'actual' (1:1 pixels)
    theme: 'auto', // 'auto' | 'light' | 'dark'
    slider: {
      start: 50, // % of the baseline shown when the slider opens (100 = all baseline, 0 = all new)
      blinkMs: 700, // time each image stays up in Blink
      highlight: false, // start with changed pixels highlighted
      highlightOpacity: 0.85, // 0..1
    },
  },
  // Shared review server for `kitsune check --remote`. The upload token is never read from this file:
  // set KITSUNE_UPLOAD_TOKEN in the environment (and KITSUNE_URL, which overrides `url`).
  remote: { url: null },
};

const BROWSER_TYPES = ['chromium', 'firefox', 'webkit'];

function normalizeBrowsers(cfg) {
  const entries = (cfg.browsers?.length ? cfg.browsers : ['chromium']).map((b) =>
    typeof b === 'string' ? { name: b, type: b } : { ...b, type: b.type ?? b.name },
  );
  const seen = new Set();
  return entries.map((b) => {
    if (!BROWSER_TYPES.includes(b.type)) {
      throw new Error(`Unknown browser "${b.type}". Use one of: ${BROWSER_TYPES.join(', ')}.`);
    }
    const name = b.name ?? b.type;
    if (seen.has(name)) throw new Error(`Duplicate browser name "${name}" in config.`);
    seen.add(name);
    const legacy = b.type === 'chromium' ? cfg.browser : {};
    return {
      name,
      type: b.type,
      executablePath: b.executablePath ?? legacy.executablePath,
      channel: b.channel ?? legacy.channel,
      args: [...(legacy.args ?? []), ...(b.args ?? [])],
    };
  });
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function validateUi(ui) {
  const fail = (msg) => {
    throw new Error(`kitsune.config.js: ui.${msg}`);
  };
  const oneOf = (key, list) => list.includes(ui[key]) || fail(`${key} must be one of ${list.join(', ')} (got ${JSON.stringify(ui[key])})`);
  oneOf('filter', ['review', 'new', 'accepted', 'unchanged', 'all']);
  oneOf('view', ['side', 'slider', 'diff', 'new', 'baseline']);
  oneOf('zoom', ['fit', 'actual']);
  oneOf('theme', ['auto', 'light', 'dark']);
  const s = ui.slider;
  if (!(s.start >= 0 && s.start <= 100)) fail('slider.start must be between 0 and 100');
  if (!(s.blinkMs >= 200 && s.blinkMs <= 5000)) fail('slider.blinkMs must be between 200 and 5000');
  if (!(s.highlightOpacity >= 0 && s.highlightOpacity <= 1)) fail('slider.highlightOpacity must be between 0 and 1');
}

export async function loadConfig({ cwd = process.cwd(), configPath } = {}) {
  const candidates = configPath
    ? [configPath]
    : ['kitsune.config.js', 'kitsune.config.mjs', 'kitsune.config.json'];

  let found = null;
  for (const c of candidates) {
    const p = path.resolve(cwd, c);
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }
  if (configPath && !found) throw new Error(`Config file not found: ${configPath}`);

  let user = {};
  if (found) {
    user = found.endsWith('.json')
      ? JSON.parse(fs.readFileSync(found, 'utf8'))
      : (await import(pathToFileURL(found).href)).default;
  }

  const cfg = merge(defaults, user);
  const baseDir = found ? path.dirname(found) : cwd;
  cfg.baseDir = baseDir;
  cfg.configPath = found;
  cfg.dataDir = path.resolve(baseDir, cfg.dataDir);
  if (cfg.storybook.dir) cfg.storybook.dir = path.resolve(baseDir, cfg.storybook.dir);
  cfg.browsers = normalizeBrowsers(cfg);
  validateConfigRules(cfg);
  validateUi(cfg.ui);

  if (!cfg.storybook.dir && !cfg.storybook.url) {
    throw new Error(
      'No Storybook configured. Set storybook.dir (built folder) or storybook.url in kitsune.config.js. Run `kitsune init` to create one.',
    );
  }
  return cfg;
}
