// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// A tiny client for the shared review server, used by `kitsune publish --request`.
// Signs in with the admin's own personal token (KITSUNE_REVIEW_TOKEN) and keeps the session cookie in memory.

export async function openRemote(server, token, fetchImpl = fetch) {
  if (!token) throw new Error('Set KITSUNE_REVIEW_TOKEN to your personal token for the shared server');
  const base = server.replace(/\/$/, '');
  const headers = { 'x-requested-with': 'kitsune', 'content-type': 'application/json' };
  const login = await fetchImpl(`${base}/api/v1/login`, { method: 'POST', headers, body: JSON.stringify({ token }) });
  if (!login.ok) throw new Error(`Could not sign in to ${base} (${login.status}). Check KITSUNE_REVIEW_TOKEN.`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (method, p, body) => {
    const res = await fetchImpl(`${base}${p}`, { method, headers: { ...headers, cookie }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  return {
    getRequest: (id) => call('GET', `/api/v1/requests/${encodeURIComponent(id)}`),
    listRequests: (limit = 100) => call('GET', `/api/v1/requests?limit=${limit}`).then((d) => d.requests ?? []),
    move: (id, action, body = {}) => call('POST', `/api/v1/requests/${encodeURIComponent(id)}/${action}`, body),
    progress: (id, body) => call('POST', `/api/v1/requests/${encodeURIComponent(id)}/progress`, body),
    markPublished: (id) => call('POST', `/api/v1/requests/${encodeURIComponent(id)}/publish`, {}),
  };
}
