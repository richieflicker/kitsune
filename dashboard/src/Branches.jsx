// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareBranches, fetchBranches, getBranchBuild, getBranches, startBranchBuild } from './api.js';
import { readPref, writePref } from './ui.jsx';

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 hours ago" from an ISO date. */
export function ago(iso, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/**
 * Pick a local base branch and a remote branch, fetch, and see how they differ.
 * Fetching only updates remote-tracking refs: nothing is merged or checked out.
 */
export default function Branches({ onBack, onReview }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [cmp, setCmp] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [build, setBuild] = useState(null);
  const watching = useRef(null); // true once this page started a build, so we only jump to the review for that one

  const apply = useCallback((listing) => {
    setData(listing);
    // Keep the previous choice when it still exists, otherwise fall back to sensible defaults.
    setBase((cur) => {
      const wanted = cur || readPref('branchBase');
      return listing.local.some((b) => b.ref === wanted) ? wanted : listing.suggestedBase ?? '';
    });
    setHead((cur) => {
      const wanted = cur || readPref('branchHead');
      return listing.remote.some((b) => b.ref === wanted) ? wanted : '';
    });
  }, []);

  useEffect(() => {
    getBranches().then(apply).catch((err) => setError(err.message));
  }, [apply]);

  useEffect(() => {
    if (base) writePref('branchBase', base);
    if (head) writePref('branchHead', head);
  }, [base, head]);

  useEffect(() => {
    if (!base || !head) {
      setCmp(null);
      return undefined;
    }
    let stale = false;
    setComparing(true);
    compareBranches(base, head)
      .then((res) => !stale && (setCmp(res), setError(null)))
      .catch((err) => !stale && (setCmp(null), setError(err.message)))
      .finally(() => !stale && setComparing(false));
    return () => {
      stale = true;
    };
  }, [base, head, fetchedAt]);

  // Pick up a build that is already running (or finished) when the page opens, and follow it while it runs.
  useEffect(() => {
    getBranchBuild().then(setBuild).catch(() => {});
  }, []);

  useEffect(() => {
    if (!build?.running) return undefined;
    const timer = setInterval(() => getBranchBuild().then(setBuild).catch((err) => setError(err.message)), 1000);
    return () => clearInterval(timer);
  }, [build?.running]);

  // Open the review of the build this page started, as soon as that one finishes (others keep running in the list).
  useEffect(() => {
    const mine = watching.current && build?.jobs?.find((j) => j.id === watching.current);
    if (mine && (mine.status === 'done' || mine.status === 'failed')) {
      watching.current = null;
      if (mine.status === 'done' && mine.compareId) onReview(mine.compareId);
    }
  }, [build, onReview]);

  async function doBuild() {
    setError(null);
    try {
      const started = await startBranchBuild(base, head);
      watching.current = started.id;
      setBuild(started);
    } catch (err) {
      watching.current = null;
      setError(err.message);
    }
  }

  const remoteName = useMemo(() => data?.remote.find((b) => b.ref === head)?.remote ?? data?.remotes[0] ?? null, [data, head]);

  const byRemote = useMemo(() => {
    const groups = new Map();
    for (const b of data?.remote ?? []) groups.set(b.remote, [...(groups.get(b.remote) ?? []), b]);
    return [...groups];
  }, [data]);

  async function doFetch() {
    setFetching(true);
    setError(null);
    try {
      const res = await fetchBranches(remoteName);
      apply(res);
      setFetchedAt(res.fetchedAt);
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  }

  const header = (
    <header className="topbar">
      <div>
        <h1>🦊 Branches</h1>
        <p className="muted">Pick your base branch and a remote branch, fetch, and compare. Nothing is merged or checked out.</p>
      </div>
      <div className="topbar-actions">
        <button className="btn" onClick={onBack}>← Back to review</button>
      </div>
    </header>
  );

  if (!data) {
    return (
      <div className="app">
        {header}
        {error ? <div className="banner">{error}</div> : <div className="empty"><h2>Loading branches…</h2></div>}
      </div>
    );
  }

  const noRemote = data.remotes.length === 0;

  return (
    <div className="app">
      {header}
      {error && <div className="banner">{error}</div>}
      <main className="main br-main">
        {noRemote && <div className="banner banner-info">This repository has no git remote, so there is nothing to fetch. Add one with <code>git remote add origin &lt;url&gt;</code>.</div>}

        <section className="br-card br-picker" aria-label="Choose branches">
          <label className="br-field">
            <span className="br-label">Base branch <small className="muted">your local branch</small></span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {data.local.map((b) => (
                <option key={b.ref} value={b.ref}>{b.name}{b.current ? '  (current)' : ''}</option>
              ))}
            </select>
          </label>

          <span className="br-arrow" aria-hidden="true">←</span>

          <label className="br-field">
            <span className="br-label">Remote branch <small className="muted">from your last fetch</small></span>
            <select value={head} onChange={(e) => setHead(e.target.value)} disabled={noRemote}>
              <option value="">Select a remote branch…</option>
              {byRemote.map(([remote, branches]) => (
                <optgroup key={remote} label={remote}>
                  {branches.map((b) => <option key={b.ref} value={b.ref}>{b.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <button className="btn btn-primary br-fetch" disabled={fetching || noRemote} onClick={doFetch}>
            {fetching ? 'Fetching…' : `Fetch ${remoteName ?? ''}`.trim()}
          </button>
        </section>

        <p className="muted br-note">
          {fetchedAt ? `Fetched ${ago(fetchedAt)}.` : 'The remote list shows what your last fetch saw.'} Fetch only downloads; your branches and files stay as they are.
        </p>

        {!head && !noRemote && (
          <div className="br-card br-empty">
            <h2>Choose a remote branch</h2>
            <p className="muted">Fetch to see the latest branches, then pick one to compare against <strong>{base || 'your base'}</strong>.</p>
          </div>
        )}

        {head && (
          <section className="br-card br-build">
            <div>
              <strong>Build and review screenshots</strong>
              <p className="muted">Builds Storybook for <code>{base}</code> and <code>{head}</code> in temporary worktrees (your folder is untouched), then shows what changed visually.</p>
            </div>
            <button className="btn btn-primary" disabled={!base || base === head || build?.jobs?.some((j) => (j.status === 'running' || j.status === 'queued') && j.base === base && j.head === head)} onClick={doBuild}>
              Build & review
            </button>
          </section>
        )}

        {build?.jobs?.length > 0 && (
          <section className="br-card br-jobs" aria-live="polite">
            <strong>Builds</strong>
            <p className="muted">Up to two builds run at the same time; the rest wait. Open any finished one to review it.</p>
            <ul>
              {build.jobs.map((j) => (
                <li key={j.id} className="br-job">
                  <div className="br-job-head">
                    <span><code>{j.head}</code> vs <code>{j.base}</code></span>
                    <span className={`pill pill-${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'running' ? 'info' : 'plain'}`}>
                      {{ queued: 'Waiting', running: 'Building', done: 'Ready', failed: 'Failed' }[j.status]}
                    </span>
                    {j.status === 'done' && <button className="btn" onClick={() => onReview(j.compareId)}>Open review</button>}
                  </div>
                  {(j.status === 'running' || j.status === 'queued') && (
                    <>
                      <span className="muted">{j.phase}</span>
                      {j.total > 0 && (
                        <div className="br-bar" role="progressbar" aria-valuemin={0} aria-valuemax={j.total} aria-valuenow={j.done}>
                          <div style={{ width: `${Math.round((j.done / j.total) * 100)}%` }} />
                        </div>
                      )}
                    </>
                  )}
                  {j.status === 'failed' && <pre className="br-log">{j.error}</pre>}
                  {j.status === 'done' && j.finishedAt && <span className="muted">Finished {ago(j.finishedAt)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {head && (
          <section className="br-card" aria-live="polite">
            {comparing && !cmp && <p className="muted">Comparing…</p>}
            {cmp && (
              <>
                <div className="br-stats">
                  <span className="badge badge-ok">{cmp.ahead} new on {cmp.head}</span>
                  <span className={`badge ${cmp.behind ? 'badge-warn' : 'badge-ok'}`}>{cmp.behind} new on {cmp.base}</span>
                  <span className="badge">{cmp.filesChanged} {cmp.filesChanged === 1 ? 'file' : 'files'} changed</span>
                  {cmp.mergeBase && <span className="muted">branched from <code>{cmp.mergeBase}</code></span>}
                </div>

                {cmp.commits.length === 0 ? (
                  <p className="muted br-none">{cmp.head} has nothing that {cmp.base} doesn’t already have.</p>
                ) : (
                  <ul className="br-commits">
                    {cmp.commits.map((c) => (
                      <li key={c.sha}>
                        <code>{c.sha}</code>
                        <span className="br-subject">{c.subject}</span>
                        <span className="muted">{c.author} · {ago(c.date)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {cmp.ahead > cmp.commits.length && <p className="muted">Showing the newest {cmp.commits.length} of {cmp.ahead} commits.</p>}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
