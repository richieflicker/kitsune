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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const localSource = { loadBuild: getBuild, act };

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
  sourceFor: (buildId) => ({
    loadBuild: () => request(`/api/v1/builds/${buildId}`, { headers: CSRF }),
    act: (action, payload) => request(`/api/v1/builds/${buildId}/${action}`, json('POST', payload)),
  }),
};
