// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Zoho Cliq alerts: post a short message to a Cliq channel through its incoming webhook URL
// (https://cliq.zoho.com/api/v2/channelsbyname/<channel>/message?zapikey=<token>, or the .in / .eu / ... twin).

export const EVENTS = ['submitted', 'built', 'buildFailed', 'approve', 'requestChanges', 'reject', 'resubmit', 'pr', 'publish'];

// Only Zoho's own hosts. The server makes this request on an admin's behalf, so it must not be pointable at an
// internal address or an arbitrary site.
const ZOHO_HOST = /^(?:[a-z0-9-]+\.)+zoho(?:cloud)?\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;

export function checkWebhookUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return 'That is not a web address';
  }
  if (u.protocol !== 'https:') return 'The webhook address must start with https://';
  if (u.port && u.port !== '443') return 'The webhook address must use the normal https port';
  if (u.username || u.password) return 'The webhook address must not contain a username or password';
  if (!ZOHO_HOST.test(u.hostname)) return 'Only Zoho Cliq addresses are allowed (for example https://cliq.zoho.com/... or https://cliq.zoho.in/...)';
  if (!u.searchParams.get('zapikey')) return 'The address needs its ?zapikey=... part (copy the whole webhook URL from Cliq)';
  return null;
}

/** Hide the secret part so the dashboard can show that a webhook is set without revealing it. */
export function maskWebhookUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}?zapikey=…${(u.searchParams.get('zapikey') ?? '').slice(-4)}`;
  } catch {
    return '';
  }
}

const LINES = {
  submitted: (r, by) => `🦊 *New review request* from ${by}: "${r.title}" (${r.source} → ${r.target})`,
  built: (r, by) => `🔎 *Ready to review*: "${r.title}" has been built by ${by}`,
  buildFailed: (r) => `🛠️ *Build failed* for "${r.title}"${r.reason ? `: ${r.reason}` : ''}`,
  approve: (r, by) => `✅ *Approved* by ${by}: "${r.title}"`,
  requestChanges: (r, by) => `✏️ *Changes requested* by ${by} on "${r.title}"${r.reason ? `: ${r.reason}` : ''}`,
  reject: (r, by) => `⛔ *Rejected* by ${by}: "${r.title}"${r.reason ? `: ${r.reason}` : ''}`,
  resubmit: (r, by) => `🔁 *Resubmitted* by ${by}: "${r.title}"`,
  pr: (r, by) => `🔀 *Pull request created* by ${by} for "${r.title}"`,
  publish: (r, by) => `📦 *Published* by ${by}: "${r.title}"`,
};

export function cliqMessage(event, request, actor, link) {
  const line = LINES[event]?.(request, actor);
  return line ? (link ? `${line}\n${link}` : line) : null;
}

/** Send one message. Resolves { ok, error } and never throws, so an alert can never break a review. */
export async function postToCliq(url, text, fetchImpl = fetch) {
  const bad = checkWebhookUrl(url);
  if (bad) return { ok: false, error: bad };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300) return { ok: false, error: `Cliq answered ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'Cliq did not answer in time' : `Could not reach Cliq: ${err.message}` };
  }
}
