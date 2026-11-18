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

  for (const [action, state] of [['build', 'building'], ['built', 'in_review'], ['approve', 'approved'], ['pr', 'pr_created'], ['publish', 'published']]) {
    assert.equal(svc.moveRequest(project, admin, made.id, action).state, state);
  }
  const trail = svc.getRequest(project, admin, made.id).events.map((e) => e.kind);
  assert.deepEqual(trail, ['submitted', 'build', 'built', 'approve', 'pr', 'publish']);
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
