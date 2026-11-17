// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

/**
 * The review state machine, shared by the local flow (check.js) and the shared server (server/service.js)
 * so the two cannot drift apart.
 *
 *   approve: changed | rejected -> accepted      (anything else is left alone)
 *   reject:  changed            -> rejected      (anything else is left alone)
 *
 * An approved story cannot be rejected afterwards: approving already replaced the baseline, so a
 * "rejected" label would not bring the old image back and the next run would pass anyway.
 */
export function reviewTransition(status, action) {
  if (action === 'approve') return status === 'changed' || status === 'rejected' ? 'accepted' : null;
  if (action === 'reject') return status === 'changed' ? 'rejected' : null;
  throw new Error(`Unknown review action: ${action}`);
}

export const REJECT_AFTER_APPROVE_MESSAGE =
  'already approved, so its baseline was replaced and it cannot be rejected. Fix the story and run `kitsune check` again.';
