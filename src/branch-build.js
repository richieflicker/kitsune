// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Build a branch's Storybook in a temporary git worktree, screenshot it, and compare it with the base
// branch built the same way. Your own working folder is never touched.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, repoRoot, resolveCommit } from './branches.js';
import { captureRun, review } from './check.js';
import { comparePngs } from './compare.js';
import { compareRules, exceedsAllowance, resolveRules } from './rules.js';
import { createStore, summarize } from './store.js';

const BUILD_TIMEOUT_MS = 20 * 60_000;
const LOCKFILES = [
  ['package-lock.json', 'npm ci'],
  ['pnpm-lock.yaml', 'pnpm install --frozen-lockfile'],
  ['yarn.lock', 'yarn install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
];
const ID_PATTERN = /^[0-9a-f]{12}_[0-9a-f]{12}_[0-9a-f]{8}$/;

const short = (sha) => sha.slice(0, 7);
const hash = (text, n) => crypto.createHash('sha256').update(text).digest('hex').slice(0, n);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function quote(text) {
  return process.platform === 'win32' ? `"${text}"` : `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Run a shell command, keeping the last lines of output so a failure can say why. */
function runShell(command, { cwd, onLine = () => {}, timeout = BUILD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const tail = [];
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const feed = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 20) tail.shift();
        onLine(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const why = signal ? `stopped (${signal}; ${Math.round(timeout / 60000)} min limit)` : `failed (exit ${code})`;
      reject(new Error(`${command} ${why}\n${tail.slice(-12).join('\n')}`));
    });
  });
}

/** Everything that changes how a screenshot looks, so cached screenshots are never reused after a config change. */
function fingerprint(cfg) {
  const { dataDir, server, ui, branches, storybook, ...rest } = cfg;
  return hash(JSON.stringify({ rest, indexPath: storybook?.indexPath }), 8);
}

function sameFile(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function linkModules(from, to) {
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.symlinkSync(from, to, 'junction');
}

/** Give the worktree its dependencies: reuse yours when the lockfile is identical, otherwise install. */
async function ensureDeps({ cfg, wt, live, log }) {
  const mode = cfg.branches?.install ?? 'auto';
  if (mode === false) return;
  if (typeof mode === 'string' && mode !== 'auto') {
    log(`Installing: ${mode}`);
    return runShell(mode, { cwd: wt.cwd, onLine: log });
  }

  // Look for a lockfile in the project folder first, then the repo root (monorepos).
  const levels = [
    [wt.cwd, live.cwd],
    [wt.root, live.root],
  ];
  for (const [wtDir, liveDir] of levels) {
    for (const [file, installCommand] of LOCKFILES) {
      if (!fs.existsSync(path.join(wtDir, file))) continue;
      if (sameFile(path.join(wtDir, file), path.join(liveDir, file)) && fs.existsSync(path.join(liveDir, 'node_modules'))) {
        log('Dependencies unchanged: reusing your node_modules');
        for (const [w, l] of levels) linkModules(path.join(l, 'node_modules'), path.join(w, 'node_modules'));
        return;
      }
      log(`Lockfile differs from your folder: running ${installCommand}`);
      return runShell(installCommand, { cwd: wtDir, onLine: log });
    }
  }
  // No lockfile anywhere: link what you have, if anything.
  log('No lockfile found: reusing your node_modules if present');
  for (const [w, l] of levels) linkModules(path.join(l, 'node_modules'), path.join(w, 'node_modules'));
}

function defaultBuildCommand(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.scripts?.['build-storybook']) return 'npm run build-storybook -- -o {out}';
  } catch {
    /* no package.json: fall through */
  }
  return 'npx --no-install storybook build -o {out}';
}

/**
 * Builds and screenshots branches, then compares two of them.
 * `capture` can be replaced (tests do, to avoid launching a browser).
 */
export function createBranchBuilder(cfg, { cwd = process.cwd(), capture = captureRun } = {}) {
  const dataRoot = path.resolve(cwd, cfg.dataDir);
  const shotsRoot = path.join(dataRoot, 'branches', 'shots');
  const compareRoot = path.join(dataRoot, 'branches', 'compare');
  const allowed = cfg.branches?.allowed;
  const fp = fingerprint(cfg);

  const state = {
    running: false,
    phase: null,
    done: 0,
    total: 0,
    log: [],
    error: null,
    compareId: null,
    base: null,
    head: null,
    startedAt: null,
    finishedAt: null,
  };
  const note = (line) => {
    state.log.push(line);
    if (state.log.length > 12) state.log.shift();
  };
  const phase = (text) => {
    state.phase = text;
    state.done = 0;
    state.total = 0;
    note(text);
  };

  /** Screenshots of one commit, from the cache when this exact commit and config were captured before. */
  async function shotsFor(sha, label, live) {
    const dir = path.join(shotsRoot, `${sha.slice(0, 12)}-${fp}`);
    const metaFile = path.join(dir, 'meta.json');
    if (fs.existsSync(metaFile)) {
      note(`${label}: ${short(sha)} already captured, reusing`);
      return { dir, entries: JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const wtRoot = path.join(os.tmpdir(), 'kitsune-worktrees', hash(live.root, 10), sha.slice(0, 12));
    const wt = { root: wtRoot, cwd: path.join(wtRoot, live.sub) };
    await git(['worktree', 'remove', '--force', wtRoot], { cwd: live.root }).catch(() => {});
    fs.rmSync(wtRoot, { recursive: true, force: true });
    await git(['worktree', 'prune'], { cwd: live.root }).catch(() => {});

    phase(`${label}: checking out ${short(sha)}`);
    await git(['worktree', 'add', '--detach', wtRoot, sha], { cwd: live.root, timeout: 120_000 });
    try {
      phase(`${label}: preparing dependencies`);
      await ensureDeps({ cfg, wt, live, log: note });

      phase(`${label}: building Storybook`);
      const out = path.resolve(wt.cwd, cfg.branches?.output ?? '.kitsune-storybook');
      const command = (cfg.branches?.buildCommand ?? defaultBuildCommand(wt.cwd)).replaceAll('{out}', quote(out));
      await runShell(command, { cwd: wt.cwd, onLine: note });
      if (!fs.existsSync(out)) throw new Error(`The build finished but ${path.relative(wt.cwd, out)} was not created. Set branches.output or branches.buildCommand.`);

      phase(`${label}: taking screenshots`);
      const branchCfg = { ...cfg, storybook: { ...cfg.storybook, url: null, dir: out } };
      const store = { newFile: (key) => path.join(dir, `${key}.png`) };
      const { captured } = await capture(branchCfg, store, {
        log: note,
        progress: (done, total) => Object.assign(state, { done, total }),
      });
      const entries = captured.map((r) => ({
        key: r.key,
        story: r.story,
        viewport: r.viewport.name,
        browser: r.browser.name,
        ok: r.ok,
        error: r.error,
      }));
      fs.writeFileSync(metaFile, JSON.stringify(entries)); // written last: its presence marks the cache entry complete
      return { dir, entries };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    } finally {
      await git(['worktree', 'remove', '--force', wtRoot], { cwd: live.root }).catch(() => {});
      fs.rmSync(wtRoot, { recursive: true, force: true });
      await git(['worktree', 'prune'], { cwd: live.root }).catch(() => {});
    }
  }

  /** Review store for base vs head: baselines are the base screenshots, "new" the branch's. */
  function compareShots({ id, base, head, baseSha, headSha, baseShots, headShots }) {
    const dir = path.join(compareRoot, id);
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createStore({ dataDir: dir });
    store.resetCurrent();

    const baseByKey = new Map(baseShots.entries.map((e) => [e.key, e]));
    const items = [];
    for (const e of [...headShots.entries].sort((a, b) => a.key.localeCompare(b.key))) {
      const viewport = cfg.viewports.find((v) => v.name === e.viewport);
      const browser = cfg.browsers.find((b) => b.name === e.browser);
      const item = { key: e.key, id: e.story.id, title: e.story.title, name: e.story.name, viewport: e.viewport, browser: e.browser, status: 'unchanged', diffPixels: 0, diffRatio: 0 };
      if (!e.ok) {
        item.status = 'error';
        item.error = e.error;
        items.push(item);
        continue;
      }
      fs.copyFileSync(path.join(headShots.dir, `${e.key}.png`), store.newFile(e.key));
      item.newImage = `/images/new/${e.key}.png`;
      item.baselineImage = `/images/baselines/${e.key}.png`;
      const before = baseByKey.get(e.key);
      if (!before?.ok) {
        // A story the base branch doesn't have (or couldn't render): it is new on this branch.
        fs.copyFileSync(store.newFile(e.key), store.baselineFile(e.key));
        item.status = 'new';
      } else {
        fs.copyFileSync(path.join(baseShots.dir, `${e.key}.png`), store.baselineFile(e.key));
        const rules = resolveRules(cfg, e.story, viewport, browser);
        const res = comparePngs(store.baselineFile(e.key), store.newFile(e.key), store.diffFile(e.key), compareRules(rules), cfg.impact);
        Object.assign(item, { diffPixels: res.diffPixels, diffRatio: res.diffRatio, sizeChanged: res.sizeChanged, impact: res.impact, bboxRatio: res.bboxRatio, regions: res.regions });
        if (exceedsAllowance(res, rules)) {
          item.status = 'changed';
          item.diffImage = `/images/diff/${e.key}.png`;
        }
      }
      items.push(item);
    }

    const headKeys = new Set(headShots.entries.map((e) => e.key));
    const removed = baseShots.entries.filter((e) => e.ok && !headKeys.has(e.key)).length;
    const manifest = {
      buildId: new Date().toISOString().replace(/[:.]/g, '-'),
      createdAt: new Date().toISOString(),
      branch: head,
      base,
      commit: short(headSha),
      baseCommit: short(baseSha),
      browsers: cfg.browsers.map((b) => b.name),
      removed,
      summary: summarize(items),
      stories: items,
    };
    store.writeManifest(manifest);
    store.writeApproved({});
    return manifest;
  }

  async function run(base, head) {
    const root = await repoRoot(cwd);
    const real = fs.realpathSync(cwd);
    const live = { root, cwd: real, sub: path.relative(root, real) };
    const [baseSha, headSha] = await Promise.all([resolveCommit(base, { cwd, allowed }), resolveCommit(head, { cwd, allowed })]);

    const baseShots = await shotsFor(baseSha, `Base (${base})`, live);
    const headShots = await shotsFor(headSha, `Branch (${head})`, live);

    phase('Comparing screenshots');
    const id = `${baseSha.slice(0, 12)}_${headSha.slice(0, 12)}_${fp}`;
    compareShots({ id, base, head, baseSha, headSha, baseShots, headShots });
    state.compareId = id;
  }

  const dirFor = (id) => {
    if (!ID_PATTERN.test(String(id))) throw httpError(400, 'Invalid review id');
    const dir = path.join(compareRoot, id);
    if (!fs.existsSync(path.join(dir, 'current', 'manifest.json'))) throw httpError(404, 'That review no longer exists. Build the branch again.');
    return dir;
  };

  return {
    snapshot: () => ({ ...state, log: [...state.log] }),

    start(base, head) {
      if (state.running) throw httpError(409, 'A branch build is already running');
      if (!base || !head) throw httpError(400, 'Provide base and head');
      if (base === head) throw httpError(400, 'Pick two different branches');
      Object.assign(state, { running: true, phase: 'Starting', done: 0, total: 0, log: [], error: null, compareId: null, base, head, startedAt: new Date().toISOString(), finishedAt: null });
      run(base, head)
        .catch((err) => {
          state.error = err.message;
        })
        .finally(() => Object.assign(state, { running: false, finishedAt: new Date().toISOString() }));
    },

    /** The review manifest, with image URLs pointing at this comparison's own folder. */
    manifest(id) {
      const manifest = createStore({ dataDir: dirFor(id) }).readManifest();
      const prefix = `/branch-images/${id}/`;
      const fix = (u) => (u ? u.replace('/images/', prefix) : u);
      return { ...manifest, stories: manifest.stories.map((s) => ({ ...s, newImage: fix(s.newImage), baselineImage: fix(s.baselineImage), diffImage: fix(s.diffImage) })) };
    },

    review(id, action, keys) {
      review({ dataDir: dirFor(id) }, action, keys);
      return this.manifest(id);
    },

    /** True only when nothing in this review still waits for a decision. */
    isFullyApproved(id) {
      const manifest = createStore({ dataDir: dirFor(id) }).readManifest();
      return manifest.summary.pending === 0;
    },

    /** The branch this review was built from, as the picker listed it. */
    headOf(id) {
      return createStore({ dataDir: dirFor(id) }).readManifest().branch;
    },

    imageRoots(id) {
      const { paths } = createStore({ dataDir: dirFor(id) });
      return { new: paths.newDir, diff: paths.diffDir, baselines: paths.baselines };
    },
  };
}
