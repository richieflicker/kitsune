// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { PNG } from 'pngjs';

/** '#f0f' / '#ff00ff' -> [r, g, b] */
export function parseColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`maskColor must be a hex colour like #ff00ff (got ${JSON.stringify(hex)})`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Paint solid rectangles (screenshot pixels) over a PNG file, in place. Parts outside the image are ignored. */
export function paintRegions(file, regions, color) {
  if (!regions.length) return 0;
  const [r, g, b] = parseColor(color);
  const png = PNG.sync.read(fs.readFileSync(file));
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(png.width, Math.ceil(region.x + region.width));
    const y1 = Math.min(png.height, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * png.width + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
  return regions.length;
}
