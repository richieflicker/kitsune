// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import assert from 'node:assert/strict';
import test from 'node:test';
import { failureReason, processRequest, runWorker } from '../src/worker.js';

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

test('worker: a failed build goes back with a reason and hides the token', async () => {
  const session = fakeSession();
  await processRequest(req, { cfg: {}, cwd: '.', url: 'http://s', uploadToken: 'SECRET', session, ...ok, build: async () => { throw new Error('vite failed\nusing SECRET here'); } });
  assert.deepEqual(session.moves.map((m) => m[1]), ['build', 'buildFailed']);
  assert.ok(!session.moves[1][2].includes('SECRET'));
  assert.match(session.moves[1][2], /vite failed/);
});

test('worker: only open requests are picked up, and --once returns', async () => {
  const session = fakeSession([req, { ...req, id: 'r2', state: 'in_review' }]);
  const n = await runWorker({ server: 'http://s', reviewToken: 'x', uploadToken: 't', cfg: {}, once: true, log: () => {}, open: async () => session, ...ok });
  assert.equal(n, 1);
  assert.equal(session.moves[0][0], 'r1');
});

test('worker: needs an upload token', async () => {
  await assert.rejects(runWorker({ server: 'http://s', cfg: {}, once: true }), /KITSUNE_UPLOAD_TOKEN/);
});

test('failureReason keeps the last lines', () => {
  assert.match(failureReason(new Error('a\nb\nc')), /a \| b \| c/);
});
