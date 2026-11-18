// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

async function request(path, options = {}) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body;
}

export const getMode = () => request('/api/mode');

// ---- local mode: `kitsune serve` ----
export const getBuild = () => request('/api/build');

export const act = (action, payload) =>
  request(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-requested-with': 'kitsune' },
    body: JSON.stringify(payload),
  });

export const localSource = { loadBuild: getBuild, act };

// Branches view (local mode only)
export const getBranches = () => request('/api/branches');
export const fetchBranches = (remote) => act('branches/fetch', { remote });
export const getBranchBuild = () => request('/api/branches/build');
export const startBranchBuild = (base, head) => act('branches/build', { base, head });
/** A review source for one branch comparison, shaped like localSource so the normal review screen can use it. */
export const branchSource = (id) => ({
  loadBuild: () => request(`/api/branch-review?id=${encodeURIComponent(id)}`),
  act: (action, payload) => act(`branch-review/${action}`, { id, ...payload }),
});
export const prLink = (id, target) => act('branches/pr-link', { id, target });
export const compareBranches = (base, head) =>
  request(`/api/branches/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);

// ---- remote mode: shared review server (cookie session; the header blocks cross-site form posts) ----
const CSRF = { 'x-requested-with': 'kitsune' };
const json = (method, body) => ({
  method,
  headers: { ...CSRF, 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export const remote = {
  session: () => request('/api/v1/session', { headers: CSRF }),
  login: (token, name) => request('/api/v1/login', json('POST', { token, name })),
  logout: () => request('/api/v1/logout', json('POST')),
  builds: () => request('/api/v1/builds?limit=40', { headers: CSRF }),
  requests: () => request('/api/v1/requests?limit=100', { headers: CSRF }),
  request: (id) => request(`/api/v1/requests/${id}`, { headers: CSRF }),
  submitRequest: (input) => request('/api/v1/requests', json('POST', input)),
  moveRequest: (id, action, payload) => request(`/api/v1/requests/${id}/${action}`, json('POST', payload)),
  cliq: () => request('/api/v1/settings/cliq', { headers: CSRF }),
  saveCliq: (payload) => request('/api/v1/settings/cliq', json('PUT', payload)),
  testCliq: () => request('/api/v1/settings/cliq/test', json('POST')),
  sourceFor: (buildId) => ({
    loadBuild: () => request(`/api/v1/builds/${buildId}`, { headers: CSRF }),
    act: (action, payload) => request(`/api/v1/builds/${buildId}/${action}`, json('POST', payload)),
  }),
};
