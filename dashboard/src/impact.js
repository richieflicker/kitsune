// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

const RANK = { major: 3, moderate: 2, minor: 1, none: 0 };

/**
 * How big a change is, for the badge. Uses the level the build computed (local mode); builds from a
 * shared server may not carry one, so fall back to the pixel share with the default thresholds.
 */
export function impactOf(s) {
  if (s.impact) return s.impact;
  if (s.status !== 'changed' && s.status !== 'rejected') return null;
  if (s.sizeChanged) return 'major';
  const r = s.diffRatio ?? 0;
  if (r >= 0.05) return 'major';
  if (r >= 0.005) return 'moderate';
  return r > 0 ? 'minor' : 'none';
}

export const impactRank = (s) => RANK[impactOf(s)] ?? -1;
