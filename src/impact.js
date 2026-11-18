// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// How drastically did a screenshot change? A bare "% of pixels" misleads (one icon vs. a heading that pushed
// everything down), so we also measure how spread out the change is and whether the page size changed.

export const DEFAULT_IMPACT = {
  minor: 0.005, // below this share of changed pixels, with one region, it is a minor change
  major: 0.05, // above this share it is a major change
  bboxMajor: 0.4, // changed pixels spread over more than this share of the image is major
  regionsModerate: 4, // this many separate changed regions is at least moderate
  regionsMajor: 12, // this many is major
};

export const LEVELS = ['none', 'minor', 'moderate', 'major'];
const CELL = 16; // changed pixels are grouped on a 16px grid, and neighbouring cells are merged into one region

/** Measure the changed area in a pixelmatch diff image (changed pixels are painted pure red). */
export function measureDiff(data, width, height) {
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cells = new Uint8Array(cols * rows);
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) {
        cells[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { bboxRatio: 0, regions: 0 };

  // connected cells (8 neighbours) are one region
  let regions = 0;
  const stack = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== 1) continue;
    regions++;
    cells[start] = 2;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop();
      const cx = c % cols;
      const cy = (c - cx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (cells[n] === 1) {
            cells[n] = 2;
            stack.push(n);
          }
        }
      }
    }
  }
  const bboxRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);
  return { bboxRatio, regions };
}

/** Turn the measurements into none | minor | moderate | major. A changed page size is always major. */
export function impactLevel({ diffPixels, diffRatio, bboxRatio, regions, sizeChanged }, overrides = {}) {
  const t = { ...DEFAULT_IMPACT, ...overrides };
  if (sizeChanged) return 'major';
  if (!diffPixels) return 'none';
  if (diffRatio > t.major || bboxRatio > t.bboxMajor || regions >= t.regionsMajor) return 'major';
  if (diffRatio >= t.minor || regions >= t.regionsModerate) return 'moderate';
  return 'minor';
}

const RANK = { none: 0, new: 1, minor: 2, unknown: 2, moderate: 3, major: 4 };

/** What the Storybook panel shows for one story: every viewport/browser result plus the worst impact. */
export function impactForStory(manifest, storyId) {
  const items = (manifest?.stories ?? []).filter((s) => s.id === storyId);
  const results = items.map((s) => ({
    key: s.key,
    viewport: s.viewport,
    browser: s.browser,
    status: s.status,
    impact: s.status === 'new' ? 'new' : s.impact ?? (s.status === 'changed' ? 'unknown' : 'none'),
    diffRatio: s.diffRatio ?? 0,
    bboxRatio: s.bboxRatio ?? 0,
    regions: s.regions ?? 0,
    sizeChanged: Boolean(s.sizeChanged),
    baselineImage: s.baselineImage ?? null,
    newImage: s.newImage ?? null,
    diffImage: s.diffImage ?? null,
  }));
  const worst = results.reduce((w, r) => ((RANK[r.impact] ?? 0) > (RANK[w] ?? 0) ? r.impact : w), 'none');
  return { buildId: manifest?.buildId ?? null, found: results.length > 0, worst: results.length ? worst : null, results };
}
