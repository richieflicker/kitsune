import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareBranches, fetchRemote, isAllowed, listBranches } from '../src/branches.js';
import { startServer } from '../src/server.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function commit(cwd, file, text, message) {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
}

/** A bare "origin", the developer's clone (`mine`) and a teammate's clone (`mate`) that pushes new work. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-branches-'));
  const origin = path.join(root, 'origin.git');
  const mine = path.join(root, 'mine');
  const mate = path.join(root, 'mate');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, mine);
  commit(mine, 'a.txt', 'one', 'first');
  git(mine, 'branch', '-M', 'main');
  git(mine, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, mate);
  return { root, origin, mine, mate };
}

test('isAllowed: empty list allows all, trailing * is a prefix rule', () => {
  assert.equal(isAllowed('anything', []), true);
  assert.equal(isAllowed('anything', undefined), true);
  assert.equal(isAllowed('release/1.0', ['release/*']), true);
  assert.equal(isAllowed('feature/x', ['release/*']), false);
  assert.equal(isAllowed('main', ['main']), true);
  assert.equal(isAllowed('main2', ['main']), false);
});

test('listBranches / fetchRemote: a teammate branch appears only after fetch, and nothing is merged', async () => {
  const { mine, mate } = setup();
  let before = await listBranches({ cwd: mine });
  assert.equal(before.current, 'main');
  assert.deepEqual(before.remotes, ['origin']);
  assert.deepEqual(before.local.map((b) => b.name), ['main']);
  assert.equal(before.suggestedBase, 'main');
  assert.equal(before.remote.some((b) => b.name === 'feature/login'), false);

  git(mate, 'checkout', '-q', '-b', 'feature/login');
  commit(mate, 'login.txt', 'login', 'add login');
  commit(mate, 'login2.txt', 'login2', 'polish login');
  git(mate, 'push', '-q', 'origin', 'feature/login');

  const headBefore = git(mine, 'rev-parse', 'HEAD');
  const after = await fetchRemote('origin', { cwd: mine });
  assert.ok(after.fetchedAt);
  assert.equal(after.remote.find((b) => b.name === 'feature/login')?.ref, 'origin/feature/login');
  assert.equal(after.remote.some((b) => b.name === 'HEAD'), false);
  // Fetch must never touch the local branch or working tree.
  assert.equal(git(mine, 'rev-parse', 'HEAD'), headBefore);
  assert.equal(fs.existsSync(path.join(mine, 'login.txt')), false);
  assert.deepEqual(after.local.map((b) => b.name), ['main']);

  await assert.rejects(fetchRemote('nope', { cwd: mine }), /Unknown remote/);
  await assert.rejects(fetchRemote('--upload-pack=evil', { cwd: mine }), /Unknown remote/);
});

test('listBranches: the allowed list hides other remote branches', async () => {
  const { mine, mate } = setup();
  git(mate, 'checkout', '-q', '-b', 'release/1.0');
  commit(mate, 'r.txt', 'r', 'release work');
  git(mate, 'push', '-q', 'origin', 'release/1.0');
  git(mate, 'checkout', '-q', '-b', 'spike/x');
  commit(mate, 's.txt', 's', 'spike');
  git(mate, 'push', '-q', 'origin', 'spike/x');

  const all = await fetchRemote('origin', { cwd: mine });
  assert.deepEqual(all.remote.map((b) => b.name).sort(), ['main', 'release/1.0', 'spike/x']);
  const limited = await listBranches({ cwd: mine, allowed: ['main', 'release/*'] });
  assert.deepEqual(limited.remote.map((b) => b.name).sort(), ['main', 'release/1.0']);
});

test('compareBranches: ahead/behind, merge-base, files and commits; unknown refs are refused', async () => {
  const { mine, mate } = setup();
  // main moves on locally after the teammate branches off.
  git(mate, 'checkout', '-q', '-b', 'feature/login');
  commit(mate, 'login.txt', 'login', 'add login');
  commit(mate, 'login2.txt', 'login2', 'polish login');
  git(mate, 'push', '-q', 'origin', 'feature/login');
  const forkPoint = git(mine, 'rev-parse', '--short', 'HEAD');
  commit(mine, 'b.txt', 'two', 'local main work');
  await fetchRemote('origin', { cwd: mine });

  const cmp = await compareBranches('main', 'origin/feature/login', { cwd: mine });
  assert.equal(cmp.ahead, 2);
  assert.equal(cmp.behind, 1);
  assert.equal(cmp.mergeBase, forkPoint.slice(0, 7));
  assert.equal(cmp.filesChanged, 2);
  assert.deepEqual(cmp.commits.map((c) => c.subject), ['polish login', 'add login']);
  assert.equal(cmp.commits[0].author, 'Test');

  await assert.rejects(compareBranches('main', 'origin/missing', { cwd: mine }), /Unknown branch/);
  await assert.rejects(compareBranches('--output=/tmp/x', 'main', { cwd: mine }), /Unknown branch/);
  await assert.rejects(compareBranches('main', 'main~1', { cwd: mine }), /Unknown branch/);
});

test('branches API: list, fetch, compare, and errors outside a git repository', async () => {
  const { mine, mate } = setup();
  git(mate, 'checkout', '-q', '-b', 'feature/x');
  commit(mate, 'x.txt', 'x', 'add x');
  git(mate, 'push', '-q', 'origin', 'feature/x');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-srv-'));
  const cfg = { dataDir, server: { port: 0 }, ui: {}, browsers: [{ name: 'chromium' }], branches: { allowed: [] } };
  const { url, server } = await startServer(cfg, { port: 0, cwd: mine });
  const post = (p, body) =>
    fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'kitsune' }, body: JSON.stringify(body) });
  try {
    const list = await (await fetch(`${url}/api/branches`)).json();
    assert.equal(list.current, 'main');
    assert.equal(list.remote.some((b) => b.name === 'feature/x'), false);

    assert.equal((await fetch(`${url}/api/branches/compare?base=main`)).status, 400);
    assert.equal((await post('/api/branches/fetch', { remote: 'origin' }).then((r) => r.json())).remote.some((b) => b.name === 'feature/x'), true);
    assert.equal((await fetch(`${url}/api/branches/compare?base=main&head=${encodeURIComponent('origin/feature/x')}`).then((r) => r.json())).ahead, 1);

    // A fetch needs the CSRF header like every other POST.
    const noHeader = await fetch(`${url}/api/branches/fetch`, { method: 'POST', body: '{}' });
    assert.equal(noHeader.status, 403);
    assert.equal((await post('/api/branches/fetch', { remote: 'nope' })).status, 400);
  } finally {
    server.close();
  }

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-nogit-'));
  const second = await startServer(cfg, { port: 0, cwd: plain });
  try {
    const res = await fetch(`${second.url}/api/branches`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a git repository/);
  } finally {
    second.server.close();
  }
});
