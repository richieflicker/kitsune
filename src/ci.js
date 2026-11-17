// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

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

function gitArgs(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Commits from where HEAD was cut off the base branch, nearest first (the merge-base is first).
 * The review server uses it to pick the baseline the default branch had at that point.
 * Returns null when it cannot be worked out (no such branch, shallow clone, not a repository).
 */
export function baseAncestors(baseBranch, { limit = 200, cwd } = {}) {
  const names = baseBranch ? [baseBranch] : ['main', 'master'];
  for (const name of names) {
    for (const ref of [`origin/${name}`, name]) {
      const base = gitArgs(['merge-base', 'HEAD', ref], cwd);
      if (!base) continue;
      const list = gitArgs(['rev-list', '--first-parent', '-n', String(limit), base], cwd);
      if (list) return list.split('\n');
    }
  }
  return null;
}
