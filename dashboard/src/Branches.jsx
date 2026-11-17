// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useMemo, useState } from 'react';
import { compareBranches, fetchBranches, getBranches } from './api.js';
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
export default function Branches({ onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [cmp, setCmp] = useState(null);
  const [comparing, setComparing] = useState(false);

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
