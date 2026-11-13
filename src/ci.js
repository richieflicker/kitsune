// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { execSync } from 'node:child_process';

export function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * The commit a status/build belongs to. On pull_request workflows GITHUB_SHA is a temporary merge
 * commit, but branch protection reads the PR head commit, so the head SHA from the event wins.
 */
export function resolveCommitSha(env = process.env, override) {
  if (override) return override;
  if (env.GITHUB_EVENT_PATH) {
    try {
      const sha = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.head?.sha;
      if (sha) return sha;
    } catch {
      /* no readable event payload: fall through */
    }
  }
  return env.GITHUB_SHA || git('rev-parse HEAD');
}

/** Branch + commit for the current run (GitHub Actions env first, then local git). */
export function detectRun(env = process.env, overrides = {}) {
  const branch = overrides.branch || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD');
  if (!branch || branch === 'HEAD') {
    throw new Error('Could not detect the git branch (detached HEAD?). Pass --branch <name>.');
  }
  return { branch, commit: resolveCommitSha(env, overrides.commit) };
}
