import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HOOK_MARKER, installHook } from '../src/hook.js';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-hook-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const run = (file, env = {}) => spawnSync('sh', [file], { env: { ...process.env, ...env }, encoding: 'utf8' });

test('installs an executable pre-push hook into the git hooks folder', () => {
  const dir = repo();
  const r = installHook(dir);
  assert.equal(r.status, 'installed');
  assert.equal(r.via, 'git');
  assert.ok(fs.readFileSync(r.file, 'utf8').includes(HOOK_MARKER));
  assert.ok(fs.statSync(r.file).mode & 0o111, 'hook must be executable');
});

test('uses .husky/pre-push when the project uses Husky', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.husky'));
  const r = installHook(dir);
  assert.equal(r.via, 'husky');
  assert.equal(r.file, path.join(dir, '.husky', 'pre-push'));
});

test('does not overwrite a foreign hook unless forced, and updates its own', () => {
  const dir = repo();
  const file = path.join(dir, '.git', 'hooks', 'pre-push');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/bin/sh\necho mine\n');
  assert.equal(installHook(dir).status, 'foreign');
  assert.equal(fs.readFileSync(file, 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(installHook(dir, { force: true }).status, 'updated');
  assert.equal(installHook(dir, { warn: true }).status, 'updated');
});

test('remove deletes only a Kitsune hook', () => {
  const dir = repo();
  assert.equal(installHook(dir, { remove: true }).status, 'absent');
  installHook(dir);
  assert.equal(installHook(dir, { remove: true }).status, 'removed');
  const file = path.join(dir, '.git', 'hooks', 'pre-push');
  fs.writeFileSync(file, 'echo mine');
  assert.equal(installHook(dir, { remove: true }).status, 'foreign');
  assert.ok(fs.existsSync(file));
});

test('not a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-nogit-'));
  assert.equal(installHook(dir).status, 'not-a-git-repo');
});

test('hook blocks when the check fails, passes when it succeeds, and can be skipped or set to warn', () => {
  const dir = repo();
  const blocked = installHook(dir, { command: 'false' }).file;
  assert.equal(run(blocked).status, 1);
  assert.match(run(blocked).stdout, /visual changes need review/);
  // The message must print literally and never run a command (backticks inside echo would).
  assert.match(run(blocked).stdout, /Run "npx kitsune serve", approve the changes, then push again\./);
  assert.equal(run(blocked, { KITSUNE_SKIP: '1' }).status, 0);

  const warn = installHook(dir, { command: 'false', warn: true }).file;
  assert.equal(run(warn).status, 0);

  const pass = installHook(dir, { command: 'true' }).file;
  assert.equal(run(pass).status, 0);
});
