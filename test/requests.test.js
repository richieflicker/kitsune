import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDb } from '../src/server/db.js';
import { createService } from '../src/server/service.js';

const SHA = 'a'.repeat(40);

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-req-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  const { project } = svc.createProject({ name: 'p' });
  const as = (name, role) => ({ name, role });
  return { svc, project, as };
}

test('contributor submits, admin builds, reviews, approves, opens the PR and publishes', async () => {
  const { svc, project, as } = await setup();
  const dev = as('Dev', 'contributor');
  const admin = as('Root', 'admin');

  const made = svc.createRequest(project, dev, { source: 'feature/x', title: 'New button', sha: SHA, note: 'please look' });
  assert.equal(made.state, 'open');
  assert.equal(made.target, 'main'); // defaults to the project's default branch

  const reviewer = as('Rev', 'reviewer');
  for (const [who, action, state] of [[admin, 'build', 'building'], [admin, 'built', 'in_review'], [reviewer, 'approve', 'approved'], [admin, 'pr', 'pr_created'], [admin, 'publish', 'published']]) {
    assert.equal(svc.moveRequest(project, who, made.id, action).state, state);
  }
  const trail = svc.getRequest(project, admin, made.id).events.map((e) => e.kind);
  assert.deepEqual(trail, ['submitted', 'build', 'built', 'approve', 'pr', 'publish']);
});

test('a failed build goes back to the contributor with a reason', async () => {
  const { svc, project, as } = await setup();
  const { id } = svc.createRequest(project, as('Dev', 'contributor'), { source: 'b', title: 't', sha: SHA });
  const admin = as('Root', 'admin');
  svc.moveRequest(project, admin, id, 'build');
  assert.throws(() => svc.moveRequest(project, admin, id, 'buildFailed'), /reason/i);
  const moved = svc.moveRequest(project, admin, id, 'buildFailed', { reason: 'vite failed' });
  assert.equal(moved.state, 'changes_requested');
  assert.equal(moved.reason, 'vite failed');
});

test('who may do what', async () => {
  const { svc, project, as } = await setup();
  const dev = as('Dev', 'contributor');
  const reviewer = as('Rev', 'reviewer');
  const admin = as('Root', 'admin');
  assert.throws(() => svc.createRequest(project, as('Vi', 'viewer'), { source: 'b', title: 't', sha: SHA }), /cannot submit/);

  const { id } = svc.createRequest(project, dev, { source: 'b', title: 't', sha: SHA });
  assert.throws(() => svc.moveRequest(project, dev, id, 'build'), /role cannot/); // contributors cannot build
  assert.throws(() => svc.moveRequest(project, reviewer, id, 'build'), /role cannot/); // build is admin-only
  svc.moveRequest(project, admin, id, 'build');
  svc.moveRequest(project, admin, id, 'built');
  assert.equal(svc.moveRequest(project, reviewer, id, 'approve').state, 'approved'); // reviewers may approve
  assert.throws(() => svc.moveRequest(project, reviewer, id, 'publish'), /role cannot/);
  assert.throws(() => svc.moveRequest(project, admin, id, 'build'), /cannot be moved/); // wrong state
  assert.throws(() => svc.moveRequest(project, admin, id, 'teleport'), /Unknown action/);
});

test('changes requested: a reason is required, only the owner resubmits, the new sha is kept', async () => {
  const { svc, project, as } = await setup();
  const dev = as('Dev', 'contributor');
  const admin = as('Root', 'admin');
  const { id } = svc.createRequest(project, dev, { source: 'b', title: 't', sha: SHA });
  svc.moveRequest(project, admin, id, 'build');
  svc.moveRequest(project, admin, id, 'built');
  assert.throws(() => svc.moveRequest(project, admin, id, 'requestChanges'), /reason is required/);
  assert.equal(svc.moveRequest(project, admin, id, 'requestChanges', { reason: 'button is too wide' }).state, 'changes_requested');
  assert.throws(() => svc.moveRequest(project, as('Other', 'contributor'), id, 'resubmit'), /No such request/); // not theirs
  const again = svc.moveRequest(project, dev, id, 'resubmit', { sha: 'b'.repeat(40) });
  assert.equal(again.state, 'open');
  assert.equal(again.sha, 'b'.repeat(40));
});

test('contributors only see their own requests; reviewers see all', async () => {
  const { svc, project, as } = await setup();
  const a = as('A', 'contributor');
  const b = as('B', 'contributor');
  const ra = svc.createRequest(project, a, { source: 'x', title: 'a', sha: SHA });
  svc.createRequest(project, b, { source: 'y', title: 'b', sha: SHA });
  assert.deepEqual(svc.listRequests(project, a).map((r) => r.id), [ra.id]);
  assert.equal(svc.listRequests(project, as('Rev', 'reviewer')).length, 2);
  assert.throws(() => svc.getRequest(project, b, ra.id), /No such request/);
});

test('input is validated', async () => {
  const { svc, project, as } = await setup();
  const dev = as('Dev', 'contributor');
  assert.throws(() => svc.createRequest(project, dev, { source: 'b', title: 't', sha: 'nope' }), /sha must be/);
  assert.throws(() => svc.createRequest(project, dev, { source: '', title: 't', sha: SHA }), /source branch/);
  assert.throws(() => svc.createRequest(project, dev, { source: 'b', title: 'x'.repeat(200), sha: SHA }), /title/);
});

test('four eyes: whoever sent or built a request cannot approve it', async () => {
  const { svc, project, as } = await setup();
  const admin = as('Root', 'admin');
  const admin2 = as('Second', 'admin');
  const reviewer = as('Rev', 'reviewer');

  // An admin who builds it cannot approve it, but another admin or a reviewer can.
  const a = svc.createRequest(project, as('Dev', 'contributor'), { source: 'f/a', title: 'A', sha: SHA });
  svc.moveRequest(project, admin, a.id, 'build');
  svc.moveRequest(project, admin, a.id, 'built');
  assert.deepEqual(svc.getRequest(project, admin, a.id).blockedActions, ['approve']);
  assert.deepEqual(svc.getRequest(project, admin2, a.id).blockedActions, []);
  assert.throws(() => svc.moveRequest(project, admin, a.id, 'approve'), (e) => e.status === 403 && /someone else/.test(e.message));
  assert.equal(svc.getRequest(project, admin, a.id).state, 'in_review'); // nothing changed
  assert.equal(svc.moveRequest(project, admin2, a.id, 'approve').state, 'approved');

  // An admin who sent the request cannot approve it either.
  const b = svc.createRequest(project, admin, { source: 'f/b', title: 'B', sha: SHA });
  svc.moveRequest(project, admin2, b.id, 'build');
  svc.moveRequest(project, admin2, b.id, 'built');
  assert.throws(() => svc.moveRequest(project, admin, b.id, 'approve'), (e) => e.status === 403);
  assert.equal(svc.moveRequest(project, reviewer, b.id, 'approve').state, 'approved');

  // Asking for changes or rejecting is still allowed for them: only approval needs a second person.
  const c = svc.createRequest(project, admin, { source: 'f/c', title: 'C', sha: SHA });
  svc.moveRequest(project, admin, c.id, 'build');
  svc.moveRequest(project, admin, c.id, 'built');
  assert.equal(svc.moveRequest(project, admin, c.id, 'reject', { reason: 'withdrawn' }).state, 'rejected');
});

test('four eyes can be switched off for a one-person team', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-req-solo-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: { KITSUNE_ALLOW_SELF_APPROVAL: '1' } });
  const { project } = svc.createProject({ name: 'p' });
  const solo = { name: 'Solo', role: 'admin' };
  const r = svc.createRequest(project, solo, { source: 'f/x', title: 'X', sha: SHA });
  svc.moveRequest(project, solo, r.id, 'build');
  svc.moveRequest(project, solo, r.id, 'built');
  assert.deepEqual(svc.getRequest(project, solo, r.id).blockedActions, []);
  assert.equal(svc.moveRequest(project, solo, r.id, 'approve').state, 'approved');
});

test('progress: live run, then the finished run is kept (last 5)', async () => {
  const { svc, project, as } = await setup();
  const dev = as('Dev', 'contributor');
  const admin = as('Root', 'admin');
  const { id } = svc.createRequest(project, dev, { source: 'b', title: 't', sha: SHA });
  svc.moveRequest(project, admin, id, 'build');
  assert.equal(svc.getRequest(project, dev, id).run, null); // nothing reported yet
  assert.throws(() => svc.reportProgress(project, dev, id, { run: { startedAt: 1 } }), /worker/);
  assert.throws(() => svc.reportProgress(project, admin, id, { run: {} }), /run is required/);

  const base = { startedAt: 1000, status: 'running', stages: [{ id: 'build', label: 'Build Storybook', status: 'running' }] };
  svc.reportProgress(project, admin, id, { run: base, lines: [{ t: 5, stage: 'build', line: 'vite building' }] });
  const live = svc.getRequest(project, dev, id).run;
  assert.equal(live.status, 'running');
  assert.deepEqual(live.log.map((l) => l.line), ['vite building']);

  const failed = { ...base, status: 'failed', finishedAt: 9000, failure: { stage: 'build', title: 'Storybook build failed', hint: 'fix it', excerpt: ['x'] } };
  svc.reportProgress(project, admin, id, { run: failed, lines: [{ t: 8, stage: 'build', line: 'Error: boom' }] });
  svc.moveRequest(project, admin, id, 'buildFailed', { reason: 'boom' });
  const after = svc.getRequest(project, dev, id).run;
  assert.equal(after.status, 'failed');
  assert.equal(after.failure.title, 'Storybook build failed');
  assert.deepEqual(after.log.map((l) => l.line), ['vite building', 'Error: boom']);
  assert.equal(svc.listRuns(project, dev, id).runs.length, 1);
  assert.throws(() => svc.listRuns(project, as('Other', 'contributor'), id), /No such request/);
});
