// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import assert from 'node:assert/strict';
import test from 'node:test';
import { failureReason, processRequest, runWorker, syncBranches } from '../src/worker.js';

const req = { id: 'r1', title: 'Button', source: 'feat/x', target: 'main', sha: 'a'.repeat(40), state: 'open' };

function fakeSession(requests = [req]) {
  const moves = [];
  return { moves, listRequests: async () => requests, move: async (id, action, body) => moves.push([id, action, body?.reason]) };
}
const ok = { resolve: async () => 'b'.repeat(40), build: async (cfg, sha, o, fn) => fn({ out: '/out', wt: { cwd: '/tmp' } }), check: async () => ({}) };

test('worker: build then check then built', async () => {
  const session = fakeSession();
  let checked;
  await processRequest(req, { cfg: { storybook: {} }, cwd: '.', url: 'http://s', uploadToken: 't', session, ...ok, check: async (cfg, o) => { checked = { cfg, o }; } });
  assert.deepEqual(session.moves.map((m) => m[1]), ['build', 'built']);
  assert.equal(checked.o.branch, 'feat/x');
  assert.equal(checked.o.commit, 'b'.repeat(40));
  assert.equal(checked.cfg.storybook.dir, '/out');
});

function recordingSession(requests) {
  const session = fakeSession(requests);
  session.posts = [];
  session.progress = async (id, body) => session.posts.push(body);
  return session;
}

test('worker: a failed build goes back with a plain reason and the token never leaves', async () => {
  const session = recordingSession();
  const failing = async (cfg, sha, o, fn) => {
    o.stage('install');
    o.stage('build');
    o.note('vite: Could not resolve ./Button');
    throw new Error('Command failed (exit 1) using SECRETTOKEN here');
  };
  await processRequest(req, { cfg: {}, cwd: '.', url: 'http://s', uploadToken: 'SECRETTOKEN', session, ...ok, build: failing, throttleMs: 0 });
  assert.deepEqual(session.moves.map((m) => m[1]), ['build', 'buildFailed']);
  assert.match(session.moves[1][2], /Storybook.s own build failed \(during "Build Storybook"\)/);
  assert.ok(!JSON.stringify(session.posts).includes('SECRETTOKEN'));
  assert.ok(!session.moves[1][2].includes('SECRETTOKEN'));
  const last = session.posts.at(-1).run;
  assert.equal(last.status, 'failed');
  assert.equal(last.failure.stage, 'build');
  assert.equal(last.stages.find((x) => x.id === 'install').status, 'done');
  const lines = session.posts.flatMap((p) => p.lines).map((l) => l.line);
  assert.ok(lines.includes('vite: Could not resolve ./Button'));
});

test('worker: stages and counts are reported while it runs', async () => {
  const session = recordingSession();
  const build = async (cfg, sha, o, fn) => {
    o.stage('checkout');
    o.stage('install');
    o.stage('build');
    return fn({ out: '/out', wt: { cwd: '/tmp' } });
  };
  const check = async (cfg, o) => {
    o.run.start('capture', { total: 4 });
    o.run.setSummary({ stories: 2, screenshots: 4 });
    o.run.progress('capture', 4, 4);
    o.run.finish('capture');
    o.run.start('upload', { total: 4 });
    o.run.finish('upload');
  };
  await processRequest(req, { cfg: {}, cwd: '.', url: 'http://s', uploadToken: 'kitsune_up_x1y2z3', session, ...ok, build, check, throttleMs: 0 });
  const last = session.posts.at(-1).run;
  assert.equal(last.status, 'done');
  assert.deepEqual(last.stages.map((x) => [x.id, x.status]), [['fetch', 'done'], ['checkout', 'done'], ['install', 'done'], ['build', 'done'], ['capture', 'done'], ['upload', 'done']]);
  assert.equal(last.summary.screenshots, 4);
  assert.deepEqual(session.moves.map((m) => m[1]), ['build', 'built']);
});

test('worker: only open requests are picked up, and --once returns', async () => {
  const session = fakeSession([req, { ...req, id: 'r2', state: 'in_review' }]);
  const n = await runWorker({ server: 'http://s', reviewToken: 'x', uploadToken: 't', cfg: {}, once: true, log: () => {}, open: async () => session, sync: async () => {}, ...ok });
  assert.equal(n, 1);
  assert.equal(session.moves[0][0], 'r1');
});

test('worker: needs an upload token', async () => {
  await assert.rejects(runWorker({ server: 'http://s', cfg: {}, once: true }), /KITSUNE_UPLOAD_TOKEN/);
});

test('failureReason keeps the last lines', () => {
  assert.match(failureReason(new Error('a\nb\nc')), /a \| b \| c/);
});

function branchSession(state) {
  const calls = [];
  return { calls, getBranches: async () => state, putBranches: async (b) => calls.push(b ?? 'ping') };
}
const listing = async () => ({ remote: [{ remote: 'origin', name: 'feat/x', sha: 'abc1234', subject: 's', date: 'd' }, { remote: 'upstream', name: 'z', sha: 'abc1234' }] });

test('branches: a fresh list is not refetched, the worker only pings', async () => {
  const session = branchSession({ fetchedAt: new Date().toISOString(), refreshRequestedAt: null, defaultBranch: 'main' });
  let fetched = false;
  await syncBranches(session, { cwd: '.', cfg: {}, list: listing, fetch: async () => { fetched = true; } });
  assert.equal(fetched, false);
  assert.deepEqual(session.calls, ['ping']);
});

test('branches: Fetch pressed means git fetch, then report origin branches and the repository address', async () => {
  const session = branchSession({ fetchedAt: new Date().toISOString(), refreshRequestedAt: new Date().toISOString(), defaultBranch: 'main' });
  let fetched = false;
  await syncBranches(session, { cwd: '.', cfg: { branches: { prUrl: 'https://x/{source}' } }, list: listing, fetch: async () => { fetched = true; }, count: async () => 3, remote: async () => 'ssh://git@bb:7999/P/r.git' });
  assert.equal(fetched, true);
  const sent = session.calls[0];
  assert.deepEqual(sent.list.map((b) => [b.name, b.ahead]), [['feat/x', 3]]);
  assert.equal(sent.remoteUrl, 'ssh://git@bb:7999/P/r.git');
  assert.equal(sent.prUrl, 'https://x/{source}');
});

test('branches: a failing git fetch still reports what is known', async () => {
  const session = branchSession({ fetchedAt: null, refreshRequestedAt: null, defaultBranch: 'main' });
  await syncBranches(session, { cwd: '.', cfg: {}, list: listing, fetch: async () => { throw new Error('network down'); }, count: async () => 0, remote: async () => '' });
  assert.equal(session.calls[0].list.length, 1);
});

test('worker: reports the commit it built', async () => {
  const session = fakeSession();
  const bodies = [];
  session.move = async (id, action, body) => { session.moves.push([id, action]); bodies.push(body); };
  await processRequest(req, { cfg: {}, cwd: '.', url: 'http://s', uploadToken: 'kitsune_up_x1y2z3', session, ...ok });
  assert.equal(bodies.at(-1).sha, 'b'.repeat(40));
});
