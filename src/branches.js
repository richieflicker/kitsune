// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Git helpers behind the dashboard's Branches view: list branches, fetch a remote, compare two refs.
// Nothing here ever merges, checks out or resets. `fetch` only updates remote-tracking refs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 120_000;
const MAX_COMMITS = 50;
const SEP = '\x1f';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function explain(err, status = 500) {
  if (err.code === 'ENOENT') return httpError(500, 'git is not installed or not on PATH');
  const text = String(err.stderr || err.message || '').trim();
  if (/not a git repository/i.test(text)) return httpError(400, 'This folder is not a git repository');
  return httpError(status, text.slice(0, 500) || 'git failed');
}

/** Run git without ever prompting for credentials (a prompt would hang the dashboard). */
export async function git(args, { cwd, timeout = 30_000, status } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return stdout.trim();
  } catch (err) {
    throw explain(err, status);
  }
}

/** `feature/*` matches by prefix, anything else must match exactly. An empty list allows everything. */
export function isAllowed(name, allowed) {
  if (!Array.isArray(allowed) || !allowed.length) return true;
  return allowed.some((rule) => (rule.endsWith('*') ? name.startsWith(rule.slice(0, -1)) : name === rule));
}

/**
 * Local branches, remote-tracking branches (as last fetched) and the configured remotes.
 * `branches.allowed` in the config limits which remote branches are offered.
 */
export async function listBranches({ cwd, allowed } = {}) {
  const [remotesOut, currentOut, refsOut] = await Promise.all([
    git(['remote'], { cwd }),
    git(['branch', '--show-current'], { cwd }),
    git(
      [
        'for-each-ref',
        `--format=%(refname)${SEP}%(objectname:short)${SEP}%(committerdate:iso-strict)${SEP}%(contents:subject)`,
        '--sort=-committerdate',
        'refs/heads',
        'refs/remotes',
      ],
      { cwd },
    ),
  ]);

  const remotes = remotesOut ? remotesOut.split('\n').filter(Boolean) : [];
  const current = currentOut || null;
  const local = [];
  const remote = [];

  for (const line of refsOut ? refsOut.split('\n') : []) {
    const [refname, sha, date, subject = ''] = line.split(SEP);
    if (refname.startsWith('refs/heads/')) {
      const name = refname.slice('refs/heads/'.length);
      local.push({ name, ref: name, sha, date, subject, current: name === current });
    } else if (refname.startsWith('refs/remotes/')) {
      const rest = refname.slice('refs/remotes/'.length);
      // Longest match first, so a remote called "team/origin" is not mistaken for "team".
      const owner = remotes.filter((r) => rest.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
      if (!owner) continue;
      const name = rest.slice(owner.length + 1);
      if (name === 'HEAD' || !isAllowed(name, allowed)) continue;
      remote.push({ remote: owner, name, ref: rest, sha, date, subject });
    }
  }

  const baseGuess = ['main', 'master', 'develop'].find((b) => local.some((l) => l.name === b)) ?? current;
  return { current, remotes, local, remote, suggestedBase: baseGuess ?? null };
}

/** Fetch one remote. Updates remote-tracking refs only: the working tree and local branches are untouched. */
export async function fetchRemote(remote, { cwd, allowed } = {}) {
  const { remotes } = await listBranches({ cwd, allowed });
  if (!remotes.includes(remote)) throw httpError(400, `Unknown remote: ${remote}`);
  await git(['fetch', '--prune', remote], { cwd, timeout: FETCH_TIMEOUT_MS, status: 502 });
  return { remote, fetchedAt: new Date().toISOString(), ...(await listBranches({ cwd, allowed })) };
}

/** How `head` differs from `base`: commits each side has, the merge-base, files touched and the new commits. */
export async function compareBranches(base, head, { cwd, allowed } = {}) {
  const listing = await listBranches({ cwd, allowed });
  const known = new Set([...listing.local.map((b) => b.ref), ...listing.remote.map((b) => b.ref)]);
  for (const ref of [base, head]) {
    // Only refs we listed are accepted, so a request can never smuggle a flag or revision expression into git.
    if (typeof ref !== 'string' || !known.has(ref)) throw httpError(400, `Unknown branch: ${ref}`);
  }

  const range = `${base}...${head}`;
  const [counts, mergeBase, files, log] = await Promise.all([
    git(['rev-list', '--left-right', '--count', range, '--'], { cwd }),
    git(['merge-base', base, head], { cwd }).catch(() => null),
    git(['diff', '--name-only', range, '--'], { cwd }),
    git(['log', `--max-count=${MAX_COMMITS}`, `--format=%h${SEP}%an${SEP}%aI${SEP}%s`, `${base}..${head}`, '--'], { cwd }),
  ]);

  const [behind, ahead] = counts.split(/\s+/).map(Number);
  return {
    base,
    head,
    ahead, // commits only on head
    behind, // commits only on base
    mergeBase: mergeBase ? mergeBase.slice(0, 7) : null,
    filesChanged: files ? files.split('\n').length : 0,
    commits: log
      ? log.split('\n').map((l) => {
          const [sha, author, date, subject] = l.split(SEP);
          return { sha, author, date, subject };
        })
      : [],
  };
}

/**
 * The commit a listed branch points at (full sha). Only refs that listBranches offers are accepted,
 * for the same reason compareBranches limits them.
 */
export async function resolveCommit(ref, { cwd, allowed } = {}) {
  const listing = await listBranches({ cwd, allowed });
  const known = new Set([...listing.local.map((b) => b.ref), ...listing.remote.map((b) => b.ref)]);
  if (typeof ref !== 'string' || !known.has(ref)) throw httpError(400, `Unknown branch: ${ref}`);
  return git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd });
}

/** Top-level folder of the repository that contains `cwd`. */
export const repoRoot = (cwd) => git(['rev-parse', '--show-toplevel'], { cwd });
