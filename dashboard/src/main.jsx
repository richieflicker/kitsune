// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Branches from './Branches.jsx';
import CreatePr from './CreatePr.jsx';
import RemoteApp from './RemoteApp.jsx';
import { branchSource, getMode, localSource } from './api.js';
import { UiContext, useTheme, withDefaults } from './ui.jsx';
import './styles.css';

/** Review of one branch comparison: the normal review screen plus "Create PR" once everything is approved. */
function BranchReview({ id, onBack }) {
  const source = useMemo(() => branchSource(id), [id]);
  const [pending, setPending] = useState(null);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(() => source.loadBuild().then((b) => setPending(b.summary.pending)).catch(() => {}), [source]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const ready = pending === 0;
  return (
    <>
      <App
        key={id}
        source={source}
        onChanged={refresh}
        headerExtra={
          <>
            <button className="btn" onClick={onBack}>← Branches</button>
            {pending > 0 && <span className="muted">Approve {pending} more to create a PR</span>}
            <button className={`btn ${ready ? 'btn-primary' : ''}`} disabled={!ready} onClick={() => setOpen(true)}>Create PR…</button>
          </>
        }
      />
      {open && <CreatePr id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Local mode: the review screen plus the Branches view, switched by the URL hash so a refresh keeps your place. */
function LocalShell() {
  // '#branches' = the Branches view, '#branches/review/<id>' = the review of one branch comparison.
  const parse = () => {
    const m = /^#branches\/review\/([0-9a-f_]+)$/.exec(location.hash);
    if (m) return { name: 'branch-review', id: m[1] };
    return { name: location.hash === '#branches' ? 'branches' : 'review' };
  };
  const [view, setView] = useState(parse);
  const go = (next, id) => {
    const hash = next === 'branches' ? '#branches' : next === 'branch-review' ? `#branches/review/${id}` : '';
    history.replaceState(null, '', location.pathname + location.search + hash);
    setView({ name: next, id });
  };
  if (view.name === 'branches') return <Branches onBack={() => go('review')} onReview={(id) => go('branch-review', id)} />;
  if (view.name === 'branch-review') return <BranchReview id={view.id} onBack={() => go('branches')} />;
  return (
    <App
      source={localSource}
      headerExtra={<button className="btn" onClick={() => go('branches')} title="Pick a remote branch, fetch and compare">⎇ Branches</button>}
    />
  );
}

function Root() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    // Older `kitsune serve` builds have no /api/mode: treat any failure as local mode.
    getMode().then(setInfo).catch(() => setInfo({ mode: 'local' }));
  }, []);

  const ui = useMemo(() => withDefaults(info?.ui), [info]);
  // Theme is applied here so it also covers the login page.
  useTheme(ui.theme);

  if (!info) return <div className="empty"><h2>Loading…</h2></div>;
  return <UiContext.Provider value={ui}>{info.mode === 'remote' ? <RemoteApp /> : <LocalShell />}</UiContext.Provider>;
}

createRoot(document.getElementById('root')).render(<Root />);
