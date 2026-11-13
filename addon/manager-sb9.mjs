// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Adds a "Kitsune" tab next to Canvas / Docs that embeds the review dashboard.
// The dashboard is served by `kitsune serve` (default http://127.0.0.1:4455).
//
// Storybook 9+ entry (imports from 'storybook/manager-api'). manager-sb8.mjs is the Storybook 8 twin.
import * as React from 'react';
import { addons, types, experimental_getTestProviderStore } from 'storybook/manager-api';

const ADDON_ID = 'kitsune-review';
const DASHBOARD_URL = (typeof window !== 'undefined' && window.KITSUNE_URL) || 'http://127.0.0.1:4455';

// ---- "Visual tests" entry in the sidebar testing panel (Storybook 10+) ----
// Talks to `kitsune serve`. Pointing the addon at a shared server (no run endpoint, no CORS) degrades
// to a plain "Open Kitsune" link, so nothing breaks there.
const api = (path, init = {}) =>
  fetch(DASHBOARD_URL.replace(/\/$/, '') + path, {
    ...init,
    headers: { 'x-requested-with': 'kitsune', ...(init.headers || {}) },
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 409) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

function useKitsune() {
  const [st, setSt] = React.useState({ status: 'loading' }); // loading | offline | ready
  const refresh = React.useCallback(
    () =>
      api('/api/run')
        .then((run) => setSt({ status: 'ready', run }))
        .catch(() => setSt({ status: 'offline' })),
    [],
  );
  React.useEffect(() => {
    refresh();
  }, [refresh]);
  React.useEffect(() => {
    if (st.status !== 'ready' || !st.run.running) return undefined;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [st, refresh]);
  return { st, refresh };
}

function KitsuneProvider({ store, openTab }) {
  const { st, refresh } = useKitsune();
  const run = st.run;
  const sum = run?.summary;
  const prev = React.useRef(false);

  // Keep Storybook's own run/succeeded/crashed state in step with the real check.
  React.useEffect(() => {
    if (!run) return;
    if (run.running) store.setState('test-provider-state:running');
    else if (prev.current || run.finishedAt) store.setState(run.error ? 'test-provider-state:crashed' : 'test-provider-state:succeeded');
    prev.current = run.running;
  }, [run, store]);

  const [err, setErr] = React.useState('');
  const start = () => {
    setErr('');
    api('/api/run', { method: 'POST' }).then(refresh).catch((e) => setErr(e.message));
  };

  const line = (() => {
    if (st.status === 'loading') return 'Checking for Kitsune...';
    if (st.status === 'offline') return 'Dashboard not reachable. Start it with `npx kitsune serve`.';
    if (run.running) return run.total ? `Capturing ${run.done}/${run.total}...` : 'Starting...';
    if (run.error) return `Last run failed: ${run.error}`;
    if (!sum) return 'No results yet. Run the tests to take the first snapshots.';
    return sum.pending > 0 ? `${sum.pending} to review · ${sum.unchanged + sum.new + sum.accepted} ok` : `All ${sum.total} snapshots match`;
  })();

  const button = { cursor: 'pointer', font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit' };
  return React.createElement(
    'div',
    { style: { padding: '6px 0', fontSize: 12, lineHeight: 1.4 } },
    React.createElement('div', { style: { fontWeight: 600, marginBottom: 2 } }, 'Visual tests (Kitsune)'),
    React.createElement('div', { style: { opacity: 0.8, marginBottom: 8 } }, err || line),
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
      st.status === 'ready' &&
        React.createElement('button', { style: { ...button, opacity: run.running ? 0.5 : 1 }, disabled: run.running, onClick: start }, run.running ? 'Running...' : 'Run visual tests'),
      React.createElement('button', { style: button, onClick: openTab }, sum?.pending > 0 ? 'Review changes' : 'Open Kitsune'),
    ),
  );
}

addons.register(ADDON_ID, (storybookApi) => {
  // Older Storybook 9.x builds have no test-provider slot; the tab below still registers.
  if (types.experimental_TEST_PROVIDER && experimental_getTestProviderStore) {
    const store = experimental_getTestProviderStore(`${ADDON_ID}/test-provider`);
    addons.add(`${ADDON_ID}/test-provider`, {
      type: types.experimental_TEST_PROVIDER,
      id: `${ADDON_ID}/test-provider`,
      render: () =>
        React.createElement(KitsuneProvider, {
          store,
          openTab: () => storybookApi.navigateUrl(`?path=/${ADDON_ID}/tab/${storybookApi.getCurrentStoryData?.()?.id ?? ''}`, { plain: true }),
        }),
    });
  }

  addons.add(`${ADDON_ID}/tab`, {
    type: types.TAB,
    title: 'Kitsune',
    render: ({ active }) =>
      active
        ? React.createElement('iframe', {
            title: 'Kitsune',
            src: DASHBOARD_URL,
            style: { width: '100%', height: '100%', border: 0, display: 'block' },
          })
        : null,
  });
});
