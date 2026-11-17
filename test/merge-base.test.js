import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { baseAncestors } from '../src/ci.js';
import { openDb } from '../src/server/db.js';
import { createService } from '../src/server/service.js';

const KEY = 'a__desktop__chromium';
const png = (r, g, b) => {
  const img = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < img.data.length; i += 4) img.data.set([r, g, b, 255], i);
  return PNG.sync.write(img);
};
const RED = png(255, 0, 0);
const BLUE = png(0, 0, 255);

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-mb-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  const { project } = svc.createProject({ name: 'p' });
  const run = async (branch, commit, image, ancestors) => {
    const { id } = await svc.createBuild(project, { branch, commit, expected: 1, ancestors });
    svc.putSnapshot(project, id, KEY, { storyId: 'a', title: 'A', name: 'a', viewport: 'desktop', browser: 'chromium', rules: {} }, image);
    const manifest = await svc.finalize(project, id);
    return { id, status: manifest.stories[0].status };
  };
  return { svc, project, run };
}

test('a branch compares against the default branch as it was where the branch was cut', async () => {
  const { svc, project, run } = await setup();
  const c1 = 'a'.repeat(40);
  const c2 = 'b'.repeat(40);

  assert.equal((await run('main', c1, RED)).status, 'new'); // main looks RED at c1
  const m2 = await run('main', c2, BLUE); // later, main changes to BLUE
  assert.equal(m2.status, 'changed');
  await svc.review(project, m2.id, 'approve', [KEY], 'tester');

  // Cut at c1, still RED: nothing changed on this branch, so nothing to review.
  assert.equal((await run('feature/x', 'c'.repeat(40), RED, [c1])).status, 'unchanged');
  // Without fork information the newest main approval (BLUE) is used, which is the old, noisy behaviour.
  assert.equal((await run('feature/y', 'd'.repeat(40), RED)).status, 'changed');
  // Fork information that matches no known commit falls back to the newest approval.
  assert.equal((await run('feature/z', 'e'.repeat(40), RED, ['f'.repeat(40)])).status, 'changed');
  // Cut at c2 (BLUE): a RED screenshot really is a change.
  assert.equal((await run('feature/w', '1'.repeat(40), RED, [c2, c1])).status, 'changed');
});

test('createBuild rejects malformed ancestors', async () => {
  const { svc, project } = await setup();
  const bad = (ancestors) => svc.createBuild(project, { branch: 'f', expected: 1, ancestors });
  await assert.rejects(bad('abc'), /ancestors/);
  await assert.rejects(bad(['not-a-sha']), /ancestors/);
  await assert.rejects(bad(Array(501).fill('a'.repeat(40))), /ancestors/);
});

test('baseAncestors returns the merge-base first, ignoring commits main gained afterwards', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-git-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  const commit = (m) => {
    fs.writeFileSync(path.join(dir, 'f'), m);
    git('add', '-A');
    git('commit', '-q', '-m', m);
    return git('rev-parse', 'HEAD');
  };
  const c1 = commit('c1');
  const c2 = commit('c2');
  git('checkout', '-q', '-b', 'feature', c1);
  commit('f1');
  git('checkout', '-q', 'main');
  commit('c3'); // main moves on after the branch was cut
  git('checkout', '-q', 'feature');

  assert.deepEqual(baseAncestors('main', { cwd: dir }), [c1]);
  assert.deepEqual(baseAncestors(undefined, { cwd: dir }), [c1]); // auto-detects main
  assert.equal(baseAncestors('nope', { cwd: dir }), null);
  assert.ok(!baseAncestors('main', { cwd: dir }).includes(c2));
});
