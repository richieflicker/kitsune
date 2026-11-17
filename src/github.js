// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { resolveCommitSha } from './ci.js';

export const STATUS_CONTEXT = 'visual-review';

/**
 * Read the GitHub details from the environment (works out of the box in GitHub Actions).
 * On pull_request workflows GITHUB_SHA is a temporary merge commit, but branch protection looks at
 * the PR head commit, so the head SHA from the event payload wins.
 */
export function githubContext(env = process.env, overrides = {}) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const repo = overrides.repo || env.GITHUB_REPOSITORY;

  const sha = resolveCommitSha(env, overrides.sha);

  const missing = [];
  if (!token) missing.push('GITHUB_TOKEN');
  if (!repo) missing.push('GITHUB_REPOSITORY (owner/repo)');
  if (!sha) missing.push('GITHUB_SHA (or --sha)');
  if (missing.length) throw new Error(`--github needs: ${missing.join(', ')}`);

  return {
    token,
    repo,
    sha,
    apiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
    reviewUrl: overrides.reviewUrl || env.KITSUNE_REVIEW_URL || null,
  };
}

/** state: 'pending' | 'success' | 'failure' | 'error' */
export async function postStatus(ctx, { state, description }) {
  const res = await fetch(`${ctx.apiUrl}/repos/${ctx.repo}/statuses/${ctx.sha}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kitsune-review',
    },
    body: JSON.stringify({
      state,
      context: STATUS_CONTEXT,
      // GitHub rejects descriptions over 140 characters.
      description: description.length > 140 ? `${description.slice(0, 137)}...` : description,
      ...(ctx.reviewUrl ? { target_url: ctx.reviewUrl } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub status API returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Posting must never hide the real check result, so failures here only warn. */
export async function postStatusSafely(ctx, status) {
  try {
    await postStatus(ctx, status);
  } catch (err) {
    console.warn(`warning: could not post GitHub status (${status.state}): ${err.message}`);
  }
}

/** One-line summary shown next to the check on the pull request. */
export function describeManifest(manifest) {
  const { summary: s } = manifest;
  if (s.pending === 0) {
    return `All ${s.total} snapshots approved${s.new ? ` (${s.new} new)` : ''}`;
  }
  const parts = [];
  if (s.changed) parts.push(`${s.changed} changed`);
  if (s.rejected) parts.push(`${s.rejected} rejected`);
  if (s.error) parts.push(`${s.error} failed to render`);

  let text = `${parts.join(', ')} - review needed`;
  if ((manifest.browsers?.length ?? 0) > 1) {
    const by = {};
    for (const st of manifest.stories) {
      if (['changed', 'rejected', 'error'].includes(st.status)) by[st.browser] = (by[st.browser] ?? 0) + 1;
    }
    text += ` (${Object.entries(by).map(([b, n]) => `${b}: ${n}`).join(', ')})`;
  }
  return text;
}
