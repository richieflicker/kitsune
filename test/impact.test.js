import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { comparePngs } from '../src/compare.js';
import { impactLevel, measureDiff } from '../src/impact.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-impact-'));

function png(name, width, height, paint) {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, PNG.sync.write(img));
  return file;
}

const white = () => [255, 255, 255];
const rule = { threshold: 0.1 };
const compare = (a, b) => comparePngs(a, b, path.join(dir, 'diff.png'), rule);

test('identical images have no impact', () => {
  const a = png('a.png', 100, 100, white);
  const res = compare(a, a);
  assert.equal(res.impact, 'none');
  assert.equal(res.regions, 0);
});

test('a small block is minor, one region', () => {
  const a = png('a.png', 200, 200, white);
  const b = png('b.png', 200, 200, (x, y) => (x < 10 && y < 10 ? [0, 0, 0] : [255, 255, 255]));
  const res = compare(a, b);
  assert.equal(res.regions, 1);
  assert.equal(res.impact, 'minor');
});

test('several separate blocks are moderate or worse', () => {
  const a = png('a.png', 400, 400, white);
  const spots = [[0, 0], [150, 0], [300, 0], [0, 300], [300, 300]];
  const b = png('b.png', 400, 400, (x, y) => (spots.some(([sx, sy]) => x >= sx && x < sx + 10 && y >= sy && y < sy + 10) ? [0, 0, 0] : [255, 255, 255]));
  const res = compare(a, b);
  assert.equal(res.regions, 5);
  assert.ok(['moderate', 'major'].includes(res.impact));
});

test('a mostly different page is major', () => {
  const a = png('a.png', 100, 100, white);
  const b = png('b.png', 100, 100, () => [0, 0, 0]);
  assert.equal(compare(a, b).impact, 'major');
});

test('a taller page is always major', () => {
  const a = png('a.png', 100, 100, white);
  const b = png('b.png', 100, 120, white);
  const res = compare(a, b);
  assert.equal(res.sizeChanged, true);
  assert.equal(res.impact, 'major');
});

test('thresholds can be overridden', () => {
  const m = { diffPixels: 100, diffRatio: 0.01, bboxRatio: 0.01, regions: 1, sizeChanged: false };
  assert.equal(impactLevel(m), 'moderate');
  assert.equal(impactLevel(m, { minor: 0.02 }), 'minor');
});

test('measureDiff ignores non-red pixels', () => {
  const data = new Uint8Array(16 * 16 * 4).fill(255);
  assert.deepEqual(measureDiff(data, 16, 16), { bboxRatio: 0, regions: 0 });
});
