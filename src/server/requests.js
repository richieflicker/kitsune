// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Review requests: a contributor asks for a branch to be reviewed; an admin builds it, reviews it, approves it,
// opens the pull request and publishes. This file is only the rules (who may move a request where).

export const STATES = ['open', 'building', 'in_review', 'approved', 'pr_created', 'published', 'rejected', 'changes_requested'];

// action -> { from: states it may start in, to: the state it ends in, needs: the permission in roles.js,
//             reason: a reason is required, owner: only the person who made the request may do it }
export const ACTIONS = {
  build: { from: ['open'], to: 'building', needs: 'build' },
  built: { from: ['building'], to: 'in_review', needs: 'build' },
  approve: { from: ['in_review'], to: 'approved', needs: 'review' },
  requestChanges: { from: ['in_review'], to: 'changes_requested', needs: 'review', reason: true },
  reject: { from: ['open', 'building', 'in_review', 'changes_requested'], to: 'rejected', needs: 'review', reason: true },
  resubmit: { from: ['changes_requested'], to: 'open', needs: 'request', owner: true },
  pr: { from: ['approved'], to: 'pr_created', needs: 'createPr' },
  publish: { from: ['approved', 'pr_created'], to: 'published', needs: 'publish' },
};

/** Why this action is not allowed right now, or null when it is. Pure, so it is easy to test. */
export function refusal(request, action, { can, name, involved = [], allowSelfApproval = false }) {
  const rule = ACTIONS[action];
  if (!rule) return { status: 404, message: `Unknown action "${action}"` };
  if (!can(rule.needs)) return { status: 403, message: 'Your role cannot do that' };
  if (rule.owner && request.requester !== name) return { status: 403, message: 'Only the person who made the request can do that' };
  // Four eyes: whoever sent or built a request cannot be the one who approves it.
  if (action === 'approve' && !allowSelfApproval && involved.includes(name)) {
    return { status: 403, message: 'You sent or built this request, so someone else has to approve it' };
  }
  if (!rule.from.includes(request.state)) return { status: 409, message: `A request that is "${request.state}" cannot be moved with "${action}"` };
  return null;
}
