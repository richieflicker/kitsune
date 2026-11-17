// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Branches from './Branches.jsx';
import RemoteApp from './RemoteApp.jsx';
import { getMode, localSource } from './api.js';
import { UiContext, useTheme, withDefaults } from './ui.jsx';
import './styles.css';

/** Local mode: the review screen plus the Branches view, switched by the URL hash so a refresh keeps your place. */
function LocalShell() {
  const [view, setView] = useState(() => (location.hash === '#branches' ? 'branches' : 'review'));
  const go = (next) => {
    history.replaceState(null, '', next === 'branches' ? '#branches' : location.pathname + location.search);
    setView(next);
  };

  if (view === 'branches') return <Branches onBack={() => go('review')} />;
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
