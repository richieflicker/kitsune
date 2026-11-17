import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { defaults, merge } from '../src/config.js';
import { startServer } from '../src/server.js';
import { storyKey } from '../src/store.js';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.com' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const STORIES = [
  { id: 'button--primary', title: 'Button', name: 'Primary' },
  { id: 'card--default', title: 'Card', name: 'Default' },
];

/** A repo whose "Storybook" is a folder with a colour in it; `build.mjs` copies it to the output folder. */
function project(buttonColor = 'ff0000') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-bb-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'sb'));
  fs.writeFileSync(path.join(dir, 'sb', 'color.txt'), buttonColor);
  fs.writeFileSync(
    path.join(dir, 'build.mjs'),
    "import fs from 'node:fs';\nfs.cpSync('sb', process.argv[2], { recursive: true });\nfs.writeFileSync(process.argv[2] + '/modules.txt', String(fs.existsSync('node_modules/marker.txt')));\n",
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lock":1}');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.kitsune/\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function solid(file, hex, w = 20, h = 10) {
  const png = new PNG({ width: w, height: h });
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < w * h; i++) png.data.set([r, g, b, 255], i * 4);
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Stand-in for the browser: paints each story from the built folder. Button takes the colour from color.txt. */
function fakeCapture(seen) {
  return async (cfg, store, { progress }) => {
    const dir = cfg.storybook.dir;
    const color = fs.readFileSync(path.join(dir, 'color.txt'), 'utf8').trim();
    seen.push({ color, modules: fs.readFileSync(path.join(dir, 'modules.txt'), 'utf8') });
    const captured = [];
    for (const story of STORIES) {
      const viewport = cfg.viewports[0];
      const browser = cfg.browsers[0];
      const key = storyKey(story.id, viewport.name, browser.name);
      solid(store.newFile(key), story.id.startsWith('button') ? color : 'ffffff');
      captured.push({ key, story, viewport, browser, ok: true });
      progress(captured.length, STORIES.length);
    }
    return { stories: STORIES, captured };
  };
}

function config(extra = {}) {
  const cfg = merge(defaults, {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-data-')),
    branches: { install: false, buildCommand: 'node build.mjs {out}', ...extra },
  });
  cfg.browsers = [{ name: 'chromium', type: 'chromium' }];
  return cfg;
}

async function waitDone(url) {
  for (let i = 0; i < 200; i++) {
    const s = await (await fetch(`${url}/api/branches/build`)).json();
    if (!s.running) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('build did not finish');
}

const post = (url, p, body) =>
  fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'kitsune' }, body: JSON.stringify(body) });

test('branch build: builds base and branch in worktrees, compares, reviews, and leaves your folder alone', async () => {
  const cwd = project('ff0000');
  git(cwd, 'checkout', '-q', '-b', 'feature/blue');
  fs.writeFileSync(path.join(cwd, 'sb', 'color.txt'), '0000ff');
  git(cwd, 'commit', '-qam', 'make button blue');
  git(cwd, 'checkout', '-q', 'main');
  const before = git(cwd, 'status', '--porcelain');

  const seen = [];
  const cfg = config();
  const { url, server } = await startServer(cfg, { port: 0, cwd, capture: fakeCapture(seen) });
  try {
    const started = await post(url, '/api/branches/build', { base: 'main', head: 'feature/blue' });
    assert.equal(started.status, 202);
    assert.equal((await post(url, '/api/branches/build', { base: 'main', head: 'feature/blue' })).status, 409);

    const done = await waitDone(url);
    assert.equal(done.error, null, done.error);
    assert.deepEqual(seen.map((s) => s.color), ['ff0000', '0000ff']); // base first, then the branch

    const manifest = await (await fetch(`${url}/api/branch-review?id=${done.compareId}`)).json();
    assert.equal(manifest.summary.changed, 1);
    assert.equal(manifest.summary.unchanged, 1);
    assert.equal(manifest.branch, 'feature/blue');
    const button = manifest.stories.find((s) => s.id === 'button--primary');
    assert.equal(button.status, 'changed');
    assert.match(button.diffImage, new RegExp(`^/branch-images/${done.compareId}/diff/`));
    for (const u of [button.newImage, button.baselineImage, button.diffImage]) {
      const img = await fetch(url + u);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
    }

    // Approving works like the normal review screen.
    const approved = await (await post(url, '/api/branch-review/approve', { id: done.compareId, all: true })).json();
    assert.equal(approved.summary.accepted, 1);
    assert.equal(approved.summary.pending, 0);

    // Your own folder is exactly as it was and no worktree is left behind.
    assert.equal(git(cwd, 'status', '--porcelain'), before);
    assert.equal(git(cwd, 'branch', '--show-current'), 'main');
    assert.equal(git(cwd, 'worktree', 'list').split('\n').length, 1);

    // Same two commits again: screenshots come from the cache, so nothing is rebuilt.
    await post(url, '/api/branches/build', { base: 'main', head: 'feature/blue' });
    const again = await waitDone(url);
    assert.equal(again.error, null);
    assert.equal(seen.length, 2);

    // Bad ids and unknown branches are refused.
    assert.equal((await fetch(`${url}/api/branch-review?id=../../etc`)).status, 400);
    assert.equal((await fetch(`${url}/branch-images/${done.compareId}/constructor/x.png`)).status, 404);
    assert.equal((await post(url, '/api/branches/build', { base: 'main', head: 'nope' })).status, 202);
    assert.match((await waitDone(url)).error, /Unknown branch/);
    assert.equal((await post(url, '/api/branches/build', { base: 'main', head: 'main' })).status, 400);
  } finally {
    server.close();
  }
});

test('branch build: reuses your node_modules when the lockfile is unchanged, and surfaces a failing build', async () => {
  const cwd = project();
  fs.mkdirSync(path.join(cwd, 'node_modules'));
  fs.writeFileSync(path.join(cwd, 'node_modules', 'marker.txt'), 'x');
  git(cwd, 'checkout', '-q', '-b', 'feature/same');
  fs.writeFileSync(path.join(cwd, 'sb', 'color.txt'), '00ff00');
  git(cwd, 'commit', '-qam', 'green');
  git(cwd, 'checkout', '-q', 'main');

  const seen = [];
  const { url, server } = await startServer(config({ install: 'auto' }), { port: 0, cwd, capture: fakeCapture(seen) });
  try {
    await post(url, '/api/branches/build', { base: 'main', head: 'feature/same' });
    assert.equal((await waitDone(url)).error, null);
    assert.deepEqual(seen.map((s) => s.modules), ['true', 'true']);
  } finally {
    server.close();
  }

  const failing = await startServer(config({ buildCommand: 'node -e "console.error(\'boom\'); process.exit(3)"' }), { port: 0, cwd, capture: fakeCapture([]) });
  try {
    await post(failing.url, '/api/branches/build', { base: 'main', head: 'feature/same' });
    const s = await waitDone(failing.url);
    assert.match(s.error, /exit 3/);
    assert.match(s.error, /boom/);
    assert.equal(git(cwd, 'worktree', 'list').split('\n').length, 1);
  } finally {
    failing.server.close();
  }
});
