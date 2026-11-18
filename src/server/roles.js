// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Who may do what on the shared server. Every route that changes something asks `can(role, action)` here,
// so the whole permission table is in one place and one test can check it.

export const ROLES = ['viewer', 'contributor', 'reviewer', 'admin'];
export const DEFAULT_ROLE = 'reviewer'; // what existing tokens and the shared review token have always been

const ALLOWED = {
  view: ROLES,
  request: ['contributor', 'reviewer', 'admin'], // submit a review request
  review: ['reviewer', 'admin'], // approve or reject changes
  build: ['admin'], // build a requested branch
  createPr: ['admin'],
  publish: ['admin'],
  manageUsers: ['admin'],
};

export const ACTIONS = Object.keys(ALLOWED);

/** An unknown role or action is always refused. */
export const can = (role, action) => Boolean(ALLOWED[action]?.includes(role));

export const permissions = (role) => ACTIONS.filter((a) => can(role, a));
