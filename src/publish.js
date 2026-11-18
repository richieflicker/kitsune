// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Publish the package to a registry (Verdaccio first, public npm later) from the admin's own machine,
// after the checks that make "approved" mean something: clean tree, the approved commit, a version not yet taken.
// The token comes from the admin's environment or their own npm login; it is never stored or printed.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Run a command and return { code, stdout, stderr } without throwing on a non-zero exit. */
export async function run(cmd, args, { cwd, env } = {}) {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { cwd, env: env ?? process.env, maxBuffer: 20 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: typeof err.code === 'number' ? err.code : 1, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message };
  }
}

/** `//host:port/path/:_authToken=...` the way npm wants it in an .npmrc. */
export function npmrcLine(registry, token) {
  const u = new URL(registry);
  return `//${u.host}${u.pathname.replace(/\/?$/, '/')}:_authToken=${token}\n`;
}

const sameCommit = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));

export class PublishError extends Error {}

/**
 * Check, then publish. With dryRun (the default for the CLI) nothing is uploaded: npm's own --dry-run runs.
 * `exec` is injectable so the checks can be tested without npm or a registry.
 */
export async function publishPackage({ cwd = process.cwd(), registry, tag = 'next', access, dryRun = true, token, expectedSha, allowDirty = false, exec = run, log = () => {} }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  if (!pkg.name || !pkg.version) throw new PublishError('package.json needs a name and a version');
  if (pkg.private) throw new PublishError(`"${pkg.name}" is marked private, so npm will not publish it`);
  registry = registry || pkg.publishConfig?.registry;
  if (!registry) throw new PublishError('Say which registry: --registry <url> (for Verdaccio, for example http://localhost:4873), or set publishConfig.registry in package.json');
  try {
    new URL(registry);
  } catch {
    throw new PublishError(`"${registry}" is not a web address`);
  }
  if (!/^[\w.-]+$/.test(tag)) throw new PublishError('The tag may only contain letters, numbers, dots, dashes and underscores');

  // 1. the working tree is what was reviewed
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  if (!head) throw new PublishError('This folder is not a git repository');
  if (expectedSha && !sameCommit(head, expectedSha.toLowerCase())) {
    throw new PublishError(`You are on ${head.slice(0, 12)} but the approved commit is ${expectedSha.slice(0, 12)}. Check out the approved commit first.`);
  }
  const dirty = (await exec('git', ['status', '--porcelain'], { cwd })).stdout.trim();
  if (dirty && !allowDirty) throw new PublishError('You have uncommitted changes. Commit or stash them so the published code is what was reviewed (or pass --allow-dirty).');
  log(`Commit ${head.slice(0, 12)}${expectedSha ? ' matches the approved commit' : ''}, working tree clean`);

  // 2. credentials: a token from the environment goes in a throw-away npmrc; otherwise the admin's own npm login is used
  let tmpDir = null;
  const npmEnv = { ...process.env };
  const extra = [];
  try {
    if (token) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-npmrc-'));
      const rc = path.join(tmpDir, '.npmrc');
      fs.writeFileSync(rc, npmrcLine(registry, token), { mode: 0o600 });
      extra.push('--userconfig', rc);
    }
    const scrub = (text) => (token ? String(text).split(token).join('***') : String(text));

    const who = await exec('npm', ['whoami', '--registry', registry, ...extra], { cwd, env: npmEnv });
    if (who.code !== 0) {
      throw new PublishError(`Not signed in to ${registry}. Run: npm adduser --registry ${registry}  (or set KITSUNE_PUBLISH_TOKEN to your token)`);
    }
    log(`Signed in to ${registry} as ${who.stdout.trim()}`);

    // 3. the version must be free
    const taken = await exec('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--registry', registry, ...extra], { cwd, env: npmEnv });
    if (taken.code === 0 && taken.stdout.trim()) {
      throw new PublishError(`${pkg.name}@${pkg.version} already exists on ${registry}. Raise the version in package.json first.`);
    }

    // 4. publish (or rehearse)
    const args = ['publish', '--registry', registry, '--tag', tag, ...extra];
    if (access) args.push('--access', access);
    if (dryRun) args.push('--dry-run');
    log(dryRun ? `Dry run: npm publish ${pkg.name}@${pkg.version} --tag ${tag}` : `Publishing ${pkg.name}@${pkg.version} --tag ${tag}`);
    const out = await exec('npm', args, { cwd, env: npmEnv });
    if (out.code !== 0) throw new PublishError(scrub(out.stderr || out.stdout).trim() || 'npm publish failed');
    return { name: pkg.name, version: pkg.version, tag, registry, sha: head, dryRun, output: scrub(`${out.stdout}\n${out.stderr}`).trim() };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
