// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanRun, createRun, diagnose, formatMs, redact } from '../src/run-stages.js';

function clock() {
  let t = 1000;
  const now = () => t;
  now.tick = (ms) => { t += ms; };
  return now;
}

test('run: stages start, finish and are timed', () => {
  const now = clock();
  const run = createRun({ stages: ['install', 'build', 'capture'], now });
  run.start('install');
  now.tick(2000);
  run.start('build'); // starting the next stage closes the previous one
  now.tick(5000);
  run.start('capture', { total: 10 });
  run.progress('capture', 4, 10);
  now.tick(1000);
  run.done();
  const s = run.snapshot();
  assert.deepEqual(s.stages.map((x) => [x.id, x.status, x.ms]), [['install', 'done', 2000], ['build', 'done', 5000], ['capture', 'done', 1000]]);
  assert.equal(s.status, 'done');
  assert.equal(s.ms, 8000);
  assert.equal(s.stages[2].done, 4);
});

test('run: a failure marks the running stage and explains it', () => {
  const run = createRun({ stages: ['install', 'build'] });
  run.start('build');
  run.note('vite: Could not resolve ./Button');
  const f = run.fail(new Error('Command failed: npm run build-storybook (exit 1)'));
  const s = run.snapshot();
  assert.equal(s.status, 'failed');
  assert.equal(s.stages.find((x) => x.id === 'build').status, 'failed');
  assert.equal(f.stage, 'build');
  assert.equal(f.kind, 'build-failed');
  assert.ok(f.excerpt.some((l) => l.includes('Could not resolve')));
});

test('run: output is redacted and only new lines are drained', () => {
  const run = createRun({ secrets: ['supersecret1'] });
  run.start('fetch');
  run.note('git clone https://bob:hunter2@host/repo.git');
  run.note('token supersecret1 and kitsune_up_abcDEF123 and \u001b[31mred\u001b[0m');
  const lines = run.drainLines().map((l) => l.line);
  assert.deepEqual(lines, ['git clone https://***@host/repo.git', 'token *** and kitsune_*** and red']);
  assert.deepEqual(run.drainLines(), []);
  run.note('next');
  assert.equal(run.drainLines().length, 1);
});

test('diagnose: the common failures get a plain reason', () => {
  const kind = (stage, text) => diagnose(stage, text).kind;
  assert.equal(kind('fetch', 'Branch "x" was not found on origin. Push it first.'), 'branch-missing');
  assert.equal(kind('fetch', 'Permission denied (publickey).'), 'git-auth');
  assert.equal(kind('install', 'npm ERR! code ERESOLVE'), 'install-peer');
  assert.equal(kind('install', 'npm ERR! code ENOTFOUND registry'), 'install-network');
  assert.equal(kind('build', 'sh: storybook: command not found'), 'build-command');
  assert.equal(kind('build', 'The build finished but .kitsune-storybook was not created.'), 'no-output');
  assert.equal(kind('capture', "browserType.launch: Executable doesn't exist"), 'browser-missing');
  assert.equal(kind('capture', 'No stories found to test'), 'no-stories');
  assert.equal(kind('upload', 'HTTP 401 Invalid upload token'), 'upload-token');
  assert.equal(kind('upload', 'Review server request failed (POST /x): fetch failed'), 'server-unreachable');
  assert.equal(kind('capture', 'something odd'), 'unknown');
});

test('cleanRun: untrusted snapshots are trimmed to safe shapes', () => {
  const r = cleanRun({ startedAt: 5, status: 'weird', stages: new Array(30).fill({ id: 'x'.repeat(99), status: 'nope' }), summary: { failedStories: new Array(80).fill({ title: 't' }) }, failure: { excerpt: new Array(40).fill('l') } });
  assert.equal(r.status, 'running');
  assert.equal(r.stages.length, 12);
  assert.equal(r.stages[0].id.length, 30);
  assert.equal(r.stages[0].status, 'pending');
  assert.equal(r.summary.failedStories.length, 50);
  assert.equal(r.failure.excerpt.length, 14);
  assert.equal(cleanRun('x'), null);
});

test('formatMs', () => {
  assert.equal(formatMs(850), '850 ms');
  assert.equal(formatMs(12_300), '12 s');
  assert.equal(formatMs(2_400), '2.4 s');
  assert.equal(formatMs(124_000), '2 min 04 s');
});
