// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// A "run" is one build-and-check, broken into stages (Fetch, Checkout, Install, Build Storybook, Capture, Upload).
// The worker, `kitsune check` and the dashboard all describe a run the same way, so progress and failures
// look the same everywhere. Plain data in, plain data out: easy to send over the wire and easy to test.

export const STAGES = {
  fetch: { label: 'Fetch', group: 'Build' },
  checkout: { label: 'Checkout', group: 'Build' },
  install: { label: 'Install dependencies', group: 'Build' },
  build: { label: 'Build Storybook', group: 'Build' },
  capture: { label: 'Capture screenshots', group: 'Check' },
  upload: { label: 'Upload', group: 'Check' },
};

export const WORKER_STAGES = ['fetch', 'checkout', 'install', 'build', 'capture', 'upload'];

const MAX_LOG = 300; // lines kept per run
const MAX_LINE = 300; // characters kept per line
const MAX_FAILED_STORIES = 50;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Remove colour codes, credentials in URLs, and any secret the caller names. */
export function redact(text, secrets = []) {
  let out = String(text ?? '').replace(ANSI, '').replace(/\r/g, '');
  out = out.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***@'); // https://user:pass@host
  out = out.replace(/\b(kitsune_(?:up|rv)_[A-Za-z0-9_-]+)/g, 'kitsune_***');
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***');
  for (const s of secrets.filter((x) => x && String(x).length >= 6)) out = out.split(String(s)).join('***');
  return out;
}

/**
 * Turn "what failed, where" into words a person can act on.
 * `text` is the error message plus the last lines of that stage's output.
 */
export function diagnose(stage, text) {
  const t = String(text ?? '');
  const has = (re) => re.test(t);
  const out = (kind, title, hint) => ({ kind, title, hint });

  if (has(/was not found on origin|unknown revision|couldn't find remote ref|not a valid object name/i)) {
    return out('branch-missing', 'The branch is not on the remote', 'Push the branch first (git push -u origin <branch>), then press Retry build.');
  }
  if (has(/Authentication failed|Permission denied \(publickey\)|could not read (Username|Password)|Host key verification failed|HTTP Basic: Access denied/i)) {
    return out('git-auth', 'Git could not log in to the repository', 'On the worker machine run "git fetch" by hand. Set up an SSH key or a saved credential for the repository there.');
  }
  if (stage === 'upload' || has(/Review server request failed|Unauthorized|status 40[13]|HTTP 40[13]/i)) {
    if (has(/40[13]|Unauthorized|invalid token|token/i)) {
      return out('upload-token', 'The review server rejected the upload', 'Check that KITSUNE_UPLOAD_TOKEN on the worker is the upload token of this project.');
    }
    if (has(/ECONNREFUSED|ENOTFOUND|fetch failed|ETIMEDOUT|EAI_AGAIN/i)) {
      return out('server-unreachable', 'The review server could not be reached', 'Check the --server address and that the server is running and reachable from the worker machine.');
    }
  }
  if (has(/Executable doesn't exist|browserType\.launch|playwright install|Failed to launch|error while loading shared libraries/i)) {
    return out('browser-missing', 'The browser is not installed on this machine', 'Run "npx playwright install chromium" on the machine that runs the check, the worker machine for review requests (on Linux also "npx playwright install-deps chromium"), or set KITSUNE_BROWSER_PATH to an installed Chrome.');
  }
  if (has(/No stories found/i)) {
    return out('no-stories', 'No stories were found', 'Check include / exclude / excludeTags in kitsune.config.js, and that the built Storybook has an index.json.');
  }
  if (has(/Every story is skipped/i)) {
    return out('all-skipped', 'Every story is skipped', 'Your overrides skip everything. Check "overrides" in kitsune.config.js.');
  }
  if (has(/was not created|output folder/i)) {
    return out('no-output', 'The build finished but produced no output folder', 'Set branches.output (and branches.buildCommand) in kitsune.config.js so they agree on where Storybook is written.');
  }
  if (stage === 'install' || has(/npm ERR!|ERESOLVE|ERR_PNPM|yarn error|lockfile/i)) {
    if (has(/ERESOLVE/)) {
      return out('install-peer', 'Dependencies conflict (peer dependencies)', 'Fix the conflict in the branch, or set branches.install to "npm ci --legacy-peer-deps" in kitsune.config.js.');
    }
    if (has(/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|registry/i)) {
      return out('install-network', 'The package registry could not be reached', 'Check that the worker machine can reach your npm registry (Verdaccio or npm), and its login if it needs one.');
    }
    return out('install-failed', 'Installing dependencies failed', 'The error lines are shown below. Try the install command by hand in a clean clone of the branch.');
  }
  if (stage === 'build') {
    if (has(/command not found|not recognized as|ENOENT|Missing script|could not determine executable/i)) {
      return out('build-command', 'The Storybook build command could not run', 'Set branches.buildCommand in kitsune.config.js, for example "npx storybook build -o {out}".');
    }
    return out('build-failed', "Storybook's own build failed", 'The error from Storybook is shown below. Run the same build command locally on this branch to fix it.');
  }
  if (stage === 'capture' && has(/Timeout|timed out/i)) {
    return out('capture-timeout', 'A story took too long to render', 'Open that story in Storybook: it may wait for data or never settle. Raise the timeout or add a mock.');
  }
  if (has(/ECONNREFUSED|net::ERR|not reachable|ERR_CONNECTION/i)) {
    return out('storybook-unreachable', 'Storybook could not be opened', 'The built Storybook did not respond. Check the build output and the storybook settings in kitsune.config.js.');
  }
  if (has(/timed out|ETIMEDOUT|Timeout/i)) {
    return out('timeout', 'This step took too long', 'It was stopped by a time limit. Retry; if it keeps happening, check the machine is not overloaded.');
  }
  const label = STAGES[stage]?.label ?? 'the run';
  return out('unknown', `Something went wrong in "${label}"`, 'The last lines of its output are shown below. Open the full log for everything.');
}

const stageOf = (id) => ({
  id,
  label: STAGES[id]?.label ?? id,
  group: STAGES[id]?.group ?? 'Run',
  status: 'pending', // pending | running | done | failed | skipped
  startedAt: null,
  ms: null,
  done: null,
  total: null,
  detail: null,
});

/**
 * Track one run. `onChange(kind, snapshot)` fires on every change: kind is "stage" (a stage started, finished
 * or failed), "progress" (a counter moved, may be frequent) or "log".
 */
export function createRun({ stages = WORKER_STAGES, secrets = [], onChange = () => {}, now = Date.now } = {}) {
  const list = stages.map((id) => stageOf(id));
  const byId = new Map(list.map((s) => [s.id, s]));
  const log = [];
  let drained = 0;
  const startedAt = now();
  let finishedAt = null;
  let failure = null;
  let summary = {};
  let current = null;

  const clean = (x) => redact(x, secrets);
  const snapshot = () => ({
    startedAt,
    finishedAt,
    ms: (finishedAt ?? now()) - startedAt,
    status: failure ? 'failed' : finishedAt ? 'done' : 'running',
    stages: list.map((s) => ({ ...s, ms: s.status === 'running' ? now() - s.startedAt : s.ms })),
    summary,
    failure,
    log: [...log],
  });
  const emit = (kind) => onChange(kind, snapshot());
  const stage = (id) => {
    if (!byId.has(id)) {
      const s = stageOf(id);
      list.push(s);
      byId.set(id, s);
    }
    return byId.get(id);
  };
  const close = (s, status) => {
    if (s.status !== 'running') return;
    s.status = status;
    s.ms = now() - s.startedAt;
  };

  const run = {
    /** Begin a stage. Whatever was running before is marked done. */
    start(id, { total = null, detail = null } = {}) {
      if (current && current !== id) close(stage(current), 'done');
      const s = stage(id);
      s.status = 'running';
      s.startedAt = now();
      s.done = total == null ? null : 0;
      s.total = total;
      s.detail = detail;
      current = id;
      emit('stage');
    },
    progress(id, done, total, detail) {
      const s = stage(id);
      s.done = done;
      if (total != null) s.total = total;
      if (detail !== undefined) s.detail = detail;
      emit('progress');
    },
    finish(id = current, detail) {
      if (!id) return;
      const s = stage(id);
      if (detail !== undefined) s.detail = detail;
      if (s.total != null && s.done != null) s.done = s.total;
      close(s, 'done');
      if (current === id) current = null;
      emit('stage');
    },
    skip(id, detail = null) {
      const s = stage(id);
      s.status = 'skipped';
      s.detail = detail;
      emit('stage');
    },
    /** One line of output, attached to the stage that is running. */
    note(line) {
      for (const part of String(line ?? '').split('\n')) {
        const text = clean(part).trimEnd();
        if (!text) continue;
        log.push({ t: now() - startedAt, stage: current, line: text.slice(0, MAX_LINE) });
        if (log.length > MAX_LOG) {
          log.shift();
          drained = Math.max(0, drained - 1);
        }
      }
      emit('log');
    },
    setSummary(patch) {
      summary = { ...summary, ...patch };
      if (Array.isArray(summary.failedStories)) summary.failedStories = summary.failedStories.slice(0, MAX_FAILED_STORIES);
      emit('stage');
    },
    /** The run broke. The running stage (or `id`) is marked failed and explained. */
    fail(err, id = current) {
      const sid = id ?? list.find((s) => s.status === 'pending')?.id ?? list[0]?.id;
      const s = stage(sid);
      close(s, 'failed');
      s.status = 'failed';
      // "<long command> failed (exit 1)" is noise to a reader; keep just the fact that it failed.
      const message = clean(err?.message ?? err).trim().split('\n').map((l) => l.replace(/^.*\sfailed \(exit (\S+)\)$/, 'Command failed (exit $1)')).join('\n');
      const own = log.filter((l) => l.stage === sid).slice(-12).map((l) => l.line);
      const excerpt = [...new Set([...own, ...message.split('\n').slice(-6)])].slice(-14);
      failure = { stage: sid, message: message.slice(0, 600), excerpt, ...diagnose(sid, `${message}\n${own.join('\n')}`) };
      finishedAt = now();
      current = null;
      emit('stage');
      return failure;
    },
    /** Everything went through. */
    done() {
      if (current) close(stage(current), 'done');
      current = null;
      finishedAt = now();
      emit('stage');
    },
    /** Log lines not yet sent anywhere. Lets a sender post only what is new. */
    drainLines() {
      const fresh = log.slice(drained);
      drained = log.length;
      return fresh;
    },
    snapshot,
  };
  return run;
}

/** Make an untrusted snapshot (from the worker) safe to store and show. */
export function cleanRun(input) {
  if (!input || typeof input !== 'object') return null;
  const str = (v, n) => (v == null ? null : String(v).slice(0, n));
  const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Math.max(0, Math.round(Number(v))) : null);
  const stages = (Array.isArray(input.stages) ? input.stages : []).slice(0, 12).map((s) => ({
    id: str(s.id, 30),
    label: str(s.label, 60),
    group: str(s.group, 20),
    status: ['pending', 'running', 'done', 'failed', 'skipped'].includes(s.status) ? s.status : 'pending',
    startedAt: num(s.startedAt),
    ms: num(s.ms),
    done: num(s.done),
    total: num(s.total),
    detail: str(s.detail, 200),
  }));
  const f = input.failure;
  const summary = input.summary && typeof input.summary === 'object' ? input.summary : {};
  return {
    startedAt: num(input.startedAt),
    finishedAt: num(input.finishedAt),
    ms: num(input.ms),
    status: ['running', 'done', 'failed'].includes(input.status) ? input.status : 'running',
    stages,
    summary: {
      stories: num(summary.stories),
      screenshots: num(summary.screenshots),
      viewports: num(summary.viewports),
      browsers: num(summary.browsers),
      counts: summary.counts && typeof summary.counts === 'object' ? Object.fromEntries(Object.entries(summary.counts).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), num(v)])) : null,
      failedStories: (Array.isArray(summary.failedStories) ? summary.failedStories : []).slice(0, MAX_FAILED_STORIES).map((x) => ({
        title: str(x?.title, 150),
        name: str(x?.name, 100),
        viewport: str(x?.viewport, 40),
        browser: str(x?.browser, 40),
        error: str(x?.error, 300),
      })),
    },
    failure: f && typeof f === 'object'
      ? { stage: str(f.stage, 30), message: str(f.message, 600), excerpt: (Array.isArray(f.excerpt) ? f.excerpt : []).slice(0, 14).map((l) => str(l, MAX_LINE)), kind: str(f.kind, 40), title: str(f.title, 160), hint: str(f.hint, 400) }
      : null,
  };
}

/** What a person wants to know when a run is over: how many, how they came out, which ones broke. */
export function summaryOf(manifest, captured = []) {
  const s = manifest?.summary ?? {};
  return {
    counts: { unchanged: s.unchanged ?? 0, new: s.new ?? 0, changed: s.changed ?? 0, error: s.error ?? 0 },
    failedStories: captured.filter((r) => !r.ok).map((r) => ({ title: r.story.title, name: r.story.name, viewport: r.viewport.name, browser: r.browser.name, error: r.error })),
  };
}

/** "850 ms", "12.3 s", "2 min 04 s". */
export function formatMs(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`;
}
