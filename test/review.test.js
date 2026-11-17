import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { review } from '../src/check.js';
import { reviewTransition } from '../src/review-rules.js';
import { createStore } from '../src/store.js';

test('reviewTransition: approve and reject rules', () => {
  assert.equal(reviewTransition('changed', 'approve'), 'accepted');
  assert.equal(reviewTransition('rejected', 'approve'), 'accepted');
  assert.equal(reviewTransition('unchanged', 'approve'), null);
  assert.equal(reviewTransition('changed', 'reject'), 'rejected');
  assert.equal(reviewTransition('accepted', 'reject'), null);
  assert.equal(reviewTransition('new', 'reject'), null);
});

function setup(status) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-test-'));
  const cfg = { dataDir };
  const store = createStore(cfg);
  store.resetCurrent();
  const key = 'a__desktop__chromium';
  fs.writeFileSync(store.baselineFile(key), 'old');
  fs.writeFileSync(store.newFile(key), 'new');
  store.writeManifest({ buildId: 'b1', stories: [{ key, status }], summary: {} });
  return { cfg, store, key };
}

test('local review: approving replaces the baseline and records the approval', () => {
  const { cfg, store, key } = setup('changed');
  review(cfg, 'approve', [key]);
  assert.equal(fs.readFileSync(store.baselineFile(key), 'utf8'), 'new');
  assert.equal(store.readManifest().stories[0].status, 'accepted');
  assert.ok(store.readApproved()[key]);
});

test('local review: rejecting an approved story is refused and changes nothing', () => {
  const { cfg, store, key } = setup('changed');
  review(cfg, 'approve', [key]);
  assert.throws(() => review(cfg, 'reject', [key]), /cannot be rejected/);
  assert.equal(store.readManifest().stories[0].status, 'accepted');
});

test('local review: rejecting a changed story keeps the old baseline', () => {
  const { cfg, store, key } = setup('changed');
  review(cfg, 'reject', [key]);
  assert.equal(fs.readFileSync(store.baselineFile(key), 'utf8'), 'old');
  assert.equal(store.readManifest().stories[0].status, 'rejected');
});

test('local review: "approve all" skips rejected stories', () => {
  const { cfg, store, key } = setup('rejected');
  review(cfg, 'approve', 'all');
  assert.equal(store.readManifest().stories[0].status, 'rejected');
  assert.equal(fs.readFileSync(store.baselineFile(key), 'utf8'), 'old');
});
