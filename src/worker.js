// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// `kitsune worker`: runs next to your repository and does the work the shared server cannot do itself.
// It watches for review requests in the "open" state, fetches the branch, builds Storybook, runs the
// check and uploads it, then moves the request to "in review" (or back to the contributor if it failed).

import { baseAncestors } from './ci.js';
import { fetchRemote, git, listBranches, remoteUrl, repoRoot } from './branches.js';
import { withBuiltStorybook } from './branch-build.js';
import { openRemote } from './publish-remote.js';
import { runRemoteCheck } from './remote.js';
import { createRun, formatMs } from './run-stages.js';

const STALE_MS = 5 * 60_000; // refresh the branch list at least this often
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The last lines of an error, with anything token-shaped removed, short enough to show a contributor. */
export function failureReason(err, secrets = []) {
  let text = String(err?.message ?? err).trim().split('\n').slice(-6).join(' | ');
  for (const s of secrets.filter(Boolean)) text = text.split(s).join('***');
  return text.slice(0, 480) || 'The build failed';
}

async function resolveSha(req, cwd) {
  const root = await repoRoot(cwd);
  await git(['fetch', '--prune', 'origin'], { cwd: root, timeout: 300_000 }).catch(() => {});
  for (const ref of [`origin/${req.source}`, req.source, req.sha]) {
    try {
      const out = await git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root });
      if (out) return String(out).trim();
    } catch {
      /* try the next ref */
    }
  }
  throw new Error(`Branch "${req.source}" was not found on origin. Push it first.`);
}

/** Build and upload one request. Returns the commit that was checked. */
export async function processRequest(req, { cfg, cwd, url, uploadToken, session, log = () => {}, build = withBuiltStorybook, check = runRemoteCheck, resolve = resolveSha, throttleMs = 1000 }) {
  // The run records stages, counts and output. A copy goes to the request page while it happens.
  let chain = Promise.resolve();
  let lastSent = 0;
  const send = (snap) => {
    const lines = run.drainLines();
    const { log: _omit, ...wire } = snap; // log lines travel separately, only the new ones
    chain = chain.then(() => session.progress?.(req.id, { run: wire, lines }).catch(() => {}));
  };
  const run = createRun({
    secrets: [uploadToken],
    onChange: (kind, snap) => {
      if (kind === 'stage') return send(snap);
      if (Date.now() - lastSent < throttleMs) return;
      lastSent = Date.now();
      send(snap);
    },
  });
  const note = (line) => {
    run.note(line);
    log(`${req.title}: ${String(line).split('\n')[0]}`);
  };

  await session.move(req.id, 'build');
  try {
    run.start('fetch');
    note(`Fetching ${req.source} from origin`);
    const sha = await resolve(req, cwd);
    run.finish('fetch', sha.slice(0, 7));
    note(`Building ${req.source} @ ${sha.slice(0, 7)}`);
    await build(cfg, sha, { cwd, label: 'Build', note, phase: note, stage: (id) => run.start(id) }, async ({ out, wt }) => {
      const runCfg = { ...cfg, storybook: { ...cfg.storybook, url: null, dir: out } };
      await check(runCfg, { url, token: uploadToken, branch: req.source, commit: sha, ancestors: baseAncestors(req.target, { cwd: wt.cwd }), log: note, run });
    });
    run.done();
    await chain;
    await session.move(req.id, 'built', { sha }); // tell the server exactly which commit was checked
    log(`${req.title}: ready for review (${formatMs(run.snapshot().ms)})`);
    return sha;
  } catch (err) {
    const failure = run.fail(err);
    log(`${req.title}: failed at "${failure.stage}": ${failure.title}`);
    await chain;
    const where = run.snapshot().stages.find((s) => s.id === failure.stage)?.label ?? failure.stage;
    const reason = `${failure.title} (during "${where}"). Open the request to see the full report.`;
    await session.move(req.id, 'buildFailed', { reason }).catch(() => {});
    return null;
  }
}

/**
 * Tell the server which branches exist, so the request form can offer them. Runs `git fetch` first when someone
 * pressed Fetch (or the list is old). Uses the git access this machine already has: no Bitbucket token needed.
 */
export async function syncBranches(session, { cwd, cfg, log = () => {}, list = listBranches, fetch = fetchRemote, count = aheadOf, remote = remoteUrl }) {
  const state = await session.getBranches();
  const age = state.fetchedAt ? Date.now() - Date.parse(state.fetchedAt) : Infinity;
  if (!state.refreshRequestedAt && age < STALE_MS) {
    await session.putBranches(); // just say we are alive
    return false;
  }
  const allowed = cfg.branches?.allowed;
  try {
    log('Fetching origin...');
    await fetch('origin', { cwd, allowed });
  } catch (err) {
    log(`git fetch failed: ${err.message}`);
  }
  const { remote: refs } = await list({ cwd, allowed });
  const base = state.defaultBranch;
  const out = [];
  for (const b of refs.filter((r) => r.remote === 'origin')) {
    out.push({ name: b.name, sha: b.sha, subject: b.subject, date: b.date, ahead: b.name === base ? 0 : await count(base, b.name, cwd) });
  }
  const url = await Promise.resolve(remote('origin', { cwd })).catch(() => '');
  await session.putBranches({ list: out, remoteUrl: url || undefined, prUrl: cfg.branches?.prUrl || undefined });
  log(`Reported ${out.length} branches`);
  return true;
}

async function aheadOf(base, name, cwd) {
  try {
    return Number(await git(['rev-list', '--count', `origin/${base}..origin/${name}`], { cwd })) || 0;
  } catch {
    return null;
  }
}

/** Poll for open requests. With once=true, handle what is waiting and return. */
export async function runWorker({ server, reviewToken, uploadToken, cfg, cwd = process.cwd(), once = false, interval = 10, log = console.log, signal, open = openRemote, ...deps }) {
  if (!uploadToken) throw new Error('Set KITSUNE_UPLOAD_TOKEN (the project upload token) so the worker can upload builds.');
  const session = await open(server, reviewToken);
  log(`Worker connected to ${server}${once ? '' : `, checking every ${interval}s`}`);
  let handled = 0;
  do {
    await (deps.sync ?? syncBranches)(session, { cwd, cfg, log }).catch((err) => log(`Branch sync failed: ${err.message}`));
    const waiting = (await session.listRequests()).filter((r) => r.state === 'open').reverse();
    for (const req of waiting) {
      if (signal?.aborted) break;
      await processRequest(req, { cfg, cwd, url: server, uploadToken, session, log, ...deps });
      handled += 1;
    }
    if (once || signal?.aborted) break;
    await sleep(interval * 1000);
  } while (!signal?.aborted);
  return handled;
}
