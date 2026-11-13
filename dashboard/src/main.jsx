// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import RemoteApp from './RemoteApp.jsx';
import { getMode, localSource } from './api.js';
import { UiContext, useTheme, withDefaults } from './ui.jsx';
import './styles.css';

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
  return <UiContext.Provider value={ui}>{info.mode === 'remote' ? <RemoteApp /> : <App source={localSource} />}</UiContext.Provider>;
}

createRoot(document.getElementById('root')).render(<Root />);
