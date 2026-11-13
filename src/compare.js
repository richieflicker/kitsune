// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const readPng = (file) => PNG.sync.read(fs.readFileSync(file));

function padTo(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

/**
 * Compare two PNGs. Different sizes are padded to the larger one and always
 * count as a change (a layout that grew or shrank is a real regression).
 */
export function comparePngs(baselineFile, newFile, diffFile, { threshold, includeAA = false }) {
  const a = readPng(baselineFile);
  const b = readPng(newFile);
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(padTo(a, width, height).data, padTo(b, width, height).data, diff.data, width, height, {
    threshold,
    includeAA,
  });

  if (diffPixels > 0 || sizeChanged) fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return { diffPixels, diffRatio: diffPixels / (width * height), sizeChanged };
}
