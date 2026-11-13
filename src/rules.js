// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

/**
 * Per-story rules. Global settings in kitsune.config.js apply to everything; `overrides` adjust them for
 * the stories (and optionally viewports / browsers) they match. Later overrides win. Lists (hide, mask,
 * ignoreRegions, css) add to the global ones; single values replace them.
 */

export const RULE_KEYS = [
  'skip',
  'viewports',
  'delay',
  'timeout',
  'waitFor',
  'hide',
  'mask',
  'css',
  'fullPage',
  'selector',
  'ignoreRegions',
  'threshold',
  'maxDiffPixels',
  'maxDiffRatio',
  'includeAA',
  'allowSizeChange',
];
const SCOPE_KEYS = ['match', 'viewport', 'browser'];
const LIST_KEYS = ['hide', 'mask', 'ignoreRegions'];

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function matches(pattern, story) {
  if (pattern == null) return true;
  if (typeof pattern === 'function') return Boolean(pattern(story));
  if (pattern instanceof RegExp) return pattern.test(story.id) || pattern.test(story.title ?? '');
  return asList(pattern).some((p) => (p instanceof RegExp ? p.test(story.id) : story.id.includes(p) || (story.title ?? '').includes(p)));
}

/** Fail early, with a message that names the bad option, instead of misbehaving at capture time. */
export function validateConfigRules(cfg) {
  const fail = (msg) => {
    throw new Error(`kitsune.config.js: ${msg}`);
  };
  const checkNumber = (where, key, v, { min = 0, max = Infinity, int = false } = {}) => {
    if (v == null) return;
    if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max || (int && !Number.isInteger(v))) {
      fail(`${where}${key} must be ${int ? 'an integer' : 'a number'} between ${min} and ${max === Infinity ? '∞' : max} (got ${JSON.stringify(v)})`);
    }
  };
  const checkRegions = (where, regions) => {
    for (const r of asList(regions)) {
      const ok = r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0;
      if (!ok) fail(`${where}ignoreRegions entries must look like { x, y, width, height } with positive size (got ${JSON.stringify(r)})`);
    }
  };
  const checkSelectors = (where, key, v) => {
    for (const s of asList(v)) if (typeof s !== 'string' || !s.trim()) fail(`${where}${key} must be CSS selector string(s)`);
  };
  const checkCommon = (where, o) => {
    checkNumber(where, 'threshold', o.threshold, { max: 1 });
    checkNumber(where, 'maxDiffPixels', o.maxDiffPixels, { int: true });
    checkNumber(where, 'maxDiffRatio', o.maxDiffRatio, { max: 1 });
    checkNumber(where, 'delay', o.delay, { max: 60000 });
    checkNumber(where, 'timeout', o.timeout, { min: 1000, max: 600000 });
    checkRegions(where, o.ignoreRegions);
    checkSelectors(where, 'hide', o.hide);
    checkSelectors(where, 'mask', o.mask);
    if (o.waitFor != null) checkSelectors(where, 'waitFor', o.waitFor);
  };

  checkCommon('', cfg);
  if (!['light', 'dark', 'no-preference'].includes(cfg.colorScheme)) fail(`colorScheme must be 'light', 'dark' or 'no-preference'`);
  if (!['reduce', 'no-preference'].includes(cfg.reducedMotion)) fail(`reducedMotion must be 'reduce' or 'no-preference'`);
  checkNumber('', 'deviceScaleFactor', cfg.deviceScaleFactor, { min: 0.5, max: 4 });
  checkNumber('', 'concurrency', cfg.concurrency, { min: 1, max: 32, int: true });

  const vpNames = new Set(cfg.viewports.map((v) => v.name));
  if (vpNames.size !== cfg.viewports.length) fail('viewport names must be unique');
  for (const [i, o] of cfg.overrides.entries()) {
    const where = `overrides[${i}].`;
    if (!o || typeof o !== 'object') fail(`overrides[${i}] must be an object`);
    const unknown = Object.keys(o).filter((k) => !RULE_KEYS.includes(k) && !SCOPE_KEYS.includes(k));
    if (unknown.length) fail(`${where}${unknown[0]} is not a known option. Allowed: ${[...SCOPE_KEYS, ...RULE_KEYS].join(', ')}`);
    if (o.match == null && o.viewport == null && o.browser == null) fail(`${where}match is required (a story id/title fragment, RegExp or function); use viewport/browser to narrow it`);
    checkCommon(where, o);
    for (const name of asList(o.viewports)) if (!vpNames.has(name)) fail(`${where}viewports names "${name}", which is not in the top-level viewports (${[...vpNames].join(', ')})`);
    for (const name of asList(o.viewport)) if (!vpNames.has(name)) fail(`${where}viewport "${name}" is not in the top-level viewports (${[...vpNames].join(', ')})`);
  }
}

/** The rules that apply to one story at one viewport in one browser. */
export function resolveRules(cfg, story, viewport, browser) {
  const rules = {
    skip: false,
    delay: cfg.delay,
    timeout: cfg.timeout,
    waitFor: cfg.waitFor,
    hide: asList(cfg.hide),
    mask: asList(cfg.mask),
    css: cfg.css || '',
    fullPage: cfg.screenshot.fullPage,
    selector: cfg.screenshot.selector,
    ignoreRegions: asList(cfg.ignoreRegions),
    threshold: cfg.threshold,
    maxDiffPixels: cfg.maxDiffPixels,
    maxDiffRatio: cfg.maxDiffRatio,
    includeAA: cfg.includeAA,
    allowSizeChange: cfg.allowSizeChange,
  };

  for (const o of cfg.overrides) {
    if (!matches(o.match, story)) continue;
    if (o.viewport != null && !asList(o.viewport).includes(viewport.name)) continue;
    if (o.browser != null && !asList(o.browser).includes(browser.name)) continue;
    if (o.viewports && !asList(o.viewports).includes(viewport.name)) rules.skip = true;
    for (const key of RULE_KEYS) {
      if (key === 'viewports' || o[key] === undefined) continue;
      if (LIST_KEYS.includes(key)) rules[key] = [...rules[key], ...asList(o[key])];
      else if (key === 'css') rules.css = `${rules.css}\n${o.css}`;
      else rules[key] = o[key];
    }
  }
  return rules;
}

/**
 * A page that changed size is always a change, unless allowSizeChange is set. Otherwise a change needs BOTH
 * more differing pixels than allowed and a bigger share of the page than allowed.
 */
export function exceedsAllowance(result, rules) {
  if (result.sizeChanged && !rules.allowSizeChange) return true;
  if (result.diffPixels <= rules.maxDiffPixels) return false;
  return rules.maxDiffRatio == null || result.diffRatio > rules.maxDiffRatio;
}

/** Everything the comparison needs, in the small shape that is sent to the review server. */
export const compareRules = (rules) => ({
  threshold: rules.threshold,
  maxDiffPixels: rules.maxDiffPixels,
  maxDiffRatio: rules.maxDiffRatio ?? null,
  includeAA: Boolean(rules.includeAA),
  allowSizeChange: Boolean(rules.allowSizeChange),
});
