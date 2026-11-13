// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useMemo, useState } from 'react';
import Viewer from './Viewer.jsx';
import { useTheme, useUi } from './ui.jsx';

const FILTERS = [
  { id: 'review', label: 'To review', match: (s) => s.status === 'changed' || s.status === 'rejected' || s.status === 'error' },
  { id: 'new', label: 'New', match: (s) => s.status === 'new' },
  { id: 'accepted', label: 'Accepted', match: (s) => s.status === 'accepted' },
  { id: 'unchanged', label: 'Unchanged', match: (s) => s.status === 'unchanged' },
  { id: 'all', label: 'All', match: () => true },
];

/**
 * The review UI. `source` supplies the data: { loadBuild(): Promise<build>, act(action, payload): Promise<build> }
 * so the same screens serve the local `kitsune serve` and the shared review server.
 */
export default function App({ source, headerExtra = null, onChanged }) {
  const [build, setBuild] = useState(null);
  const [error, setError] = useState(null);
  const ui = useUi();
  const [filter, setFilter] = useState(ui.filter);
  const [theme, setTheme] = useTheme(ui.theme);
  const [selectedKey, setSelectedKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState('all');
  const readOnly = Boolean(source.readOnly);

  useEffect(() => {
    source.loadBuild().then(setBuild).catch((e) => setError(e.message));
  }, [source]);

  const filterDef = FILTERS.find((f) => f.id === filter);
  const inBrowser = useCallback((s) => browser === 'all' || s.browser === browser, [browser]);
  const stories = useMemo(
    () => (build ? build.stories.filter(inBrowser).filter(filterDef.match) : []),
    [build, filterDef, inBrowser],
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, build ? build.stories.filter(inBrowser).filter(f.match).length : 0])),
    [build, inBrowser],
  );
  // Pending (changed/rejected/error) snapshots per browser, so a regression in one engine is obvious.
  const pendingByBrowser = useMemo(() => {
    const out = {};
    for (const s of build?.stories ?? []) {
      if (s.status === 'changed' || s.status === 'rejected' || s.status === 'error') out[s.browser] = (out[s.browser] ?? 0) + 1;
    }
    return out;
  }, [build]);
  const selected = stories.find((s) => s.key === selectedKey) ?? stories[0] ?? null;

  // Start on the first filter that has something in it.
  useEffect(() => {
    if (build && counts[filter] === 0 && filter !== 'all') setFilter(counts.review ? 'review' : counts.new ? 'new' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  const run = useCallback(async (action, payload) => {
    setBusy(true);
    setError(null);
    try {
      setBuild(await source.act(action, payload));
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [source, onChanged]);

  // j/k to move, a to approve, r to reject
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.target.tagName === 'INPUT') return;
      const i = stories.findIndex((s) => s.key === selected?.key);
      if (e.key === 'j' && stories[i + 1]) setSelectedKey(stories[i + 1].key);
      if (e.key === 'k' && stories[i - 1]) setSelectedKey(stories[i - 1].key);
      if (!readOnly && e.key === 'a' && selected && !busy) run('approve', { key: selected.key });
      if (!readOnly && e.key === 'r' && selected && !busy) run('reject', { key: selected.key });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stories, selected, busy, run]);

  if (error && !build) return <Empty title="No build to review" detail={error} />;
  if (!build) return <Empty title="Loading…" />;

  const { summary } = build;
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>🦊 Kitsune Review</h1>
          <p className="muted">
            Build {build.buildId.slice(0, 19)}
            {build.branch ? ` · ${build.branch}` : ''}
            {build.commit ? ` · ${build.commit}` : ''}
          </p>
        </div>
        <div className="topbar-actions">
          {headerExtra}
          <button
            className="btn btn-quiet"
            onClick={() => setTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')}
            title="Switch between automatic, light and dark theme"
            aria-label={`Theme: ${theme}. Click to change.`}
          >
            {theme === 'light' ? '☀ Light' : theme === 'dark' ? '☾ Dark' : '◐ Auto'}
          </button>
          <span className={`badge ${summary.pending ? 'badge-warn' : 'badge-ok'}`}>
            {summary.pending ? `${summary.pending} to review` : 'All approved'}
          </span>
          {!readOnly && (
            <button className="btn btn-primary" disabled={busy || !summary.changed} onClick={() => run('approve', { all: true })}>
              Approve all changes ({summary.changed})
            </button>
          )}
        </div>
      </header>

      {error && <div className="banner">{error}</div>}

      <div className="layout">
        <aside className="sidebar">
          {(build.browsers?.length ?? 0) > 1 && (
            <div className="browser-filter">
              <label htmlFor="browser-select" className="muted">Browser</label>
              <select id="browser-select" value={browser} onChange={(e) => setBrowser(e.target.value)}>
                <option value="all">All browsers</option>
                {build.browsers.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {pendingByBrowser[b] ? ` (${pendingByBrowser[b]} to review)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <nav className="tabs" aria-label="Filter stories">
            {FILTERS.map((f) => (
              <button key={f.id} className={`tab ${filter === f.id ? 'tab-active' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label} <span className="count">{counts[f.id]}</span>
              </button>
            ))}
          </nav>
          <ul className="story-list">
            {stories.length === 0 && <li className="muted pad">Nothing to review. The fox found no changes.</li>}
            {stories.map((s) => (
              <li key={s.key}>
                <button className={`story ${selected?.key === s.key ? 'story-active' : ''}`} onClick={() => setSelectedKey(s.key)}>
                  <span className={`dot dot-${s.status}`} aria-hidden />
                  <span className="story-text">
                    <span className="story-title">{s.title}</span>
                    <span className="story-name">
                      {s.name} · {s.viewport}
                      {build.browsers?.length > 1 ? ` · ${s.browser}` : ''}
                    </span>
                  </span>
                  <span className="story-status">{s.status}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint muted pad">{readOnly ? "j/k move · view only" : "j/k move · a approve · r reject"}</p>
        </aside>

        <main className="main">
          {selected ? (
            <Viewer key={selected.key} story={selected} buildId={build.buildId} busy={busy} readOnly={readOnly} onApprove={() => run('approve', { key: selected.key })} onReject={() => run('reject', { key: selected.key })} />
          ) : (
            <Empty title="Select a story" />
          )}
        </main>
      </div>
      <footer className="footer">🦊 Kitsune Review · MIT</footer>
    </div>
  );
}

function Empty({ title, detail }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {detail && <p className="muted">{detail}</p>}
    </div>
  );
}
