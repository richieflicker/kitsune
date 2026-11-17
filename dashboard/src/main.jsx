// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Branches from './Branches.jsx';
import RemoteApp from './RemoteApp.jsx';
import { branchSource, getMode, localSource } from './api.js';
import { UiContext, useTheme, withDefaults } from './ui.jsx';
import './styles.css';

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
  const source = useMemo(() => (view.name === 'branch-review' ? branchSource(view.id) : null), [view.name, view.id]);

  if (view.name === 'branches') return <Branches onBack={() => go('review')} onReview={(id) => go('branch-review', id)} />;
  if (view.name === 'branch-review') {
    return <App key={view.id} source={source} headerExtra={<button className="btn" onClick={() => go('branches')}>← Branches</button>} />;
  }
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
