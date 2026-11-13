// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Adds a "Kitsune" tab next to Canvas / Docs that embeds the review dashboard.
// The dashboard is served by `kitsune serve` (default http://127.0.0.1:4455).
//
// Storybook 9+ entry (imports from 'storybook/manager-api'). manager-sb8.mjs is the Storybook 8 twin.
import * as React from 'react';
import { addons, types, experimental_getTestProviderStore } from 'storybook/manager-api';

const ADDON_ID = 'kitsune-review';
// The sign-in cookie is SameSite=Strict, so the dashboard must be on the same *site* as Storybook. The browser
// treats `localhost` and `127.0.0.1` as different sites, so when both are local, use the host Storybook is on.
function sameSiteUrl(url) {
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1'];
    if (typeof window !== 'undefined' && local.includes(u.hostname) && local.includes(window.location.hostname)) u.hostname = window.location.hostname;
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}
const DASHBOARD_URL = sameSiteUrl((typeof window !== 'undefined' && window.KITSUNE_URL) || 'http://127.0.0.1:4455');

// ---- "Visual tests" entry in the sidebar testing panel (Storybook 9.1+/10) ----
// Layout follows Storybook's own "Run component tests" block: title + status + run button, then one
// checkbox row per browser with a status dot. It talks to `kitsune serve`. Pointing the addon at a
// shared review server shows a locked state with a sign-in prompt instead, because checks run on the
// machine that has Storybook, and the shared server only receives uploads from CI.
const BASE = DASHBOARD_URL.replace(/\/$/, '');
const LABELS = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' };
const STORE_KEY = 'kitsune-panel-browsers';

const api = (path, init = {}) =>
  fetch(BASE + path, { ...init, headers: { 'x-requested-with': 'kitsune', 'Content-Type': 'application/json', ...(init.headers || {}) } }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 409) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

function useKitsune() {
  const [st, setSt] = React.useState({ status: 'loading' }); // loading | offline | signin | ready
  const refresh = React.useCallback(
    () =>
      // A plain GET (no custom headers) so it needs no CORS preflight; the shared server answers it for any origin.
      fetch(BASE + '/api/mode').then((r) => r.json())
        .then((m) => (m.mode === 'remote' ? { status: 'signin' } : api('/api/run').then((run) => ({ status: 'ready', run }))))
        .then(setSt)
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

const readChoice = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
};
const saveChoice = (v) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* private mode: the choice just isn't remembered */
  }
};

const h = React.createElement;
const muted = { opacity: 0.7, fontSize: 12 };
const dot = (color) => h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' } });
const textButton = { cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit' };

function Check({ checked, disabled }) {
  return h(
    'span',
    {
      'aria-hidden': true,
      style: { width: 16, height: 16, borderRadius: 4, flex: 'none', display: 'inline-grid', placeItems: 'center', fontSize: 11, lineHeight: 1, color: '#fff', background: checked ? '#6b7a90' : 'transparent', border: `1.5px solid ${checked ? '#6b7a90' : 'rgba(128,128,128,.6)'}`, opacity: disabled ? 0.5 : 1 },
    },
    checked ? '✓' : '',
  );
}

function KitsuneProvider({ store, openTab }) {
  const { st, refresh } = useKitsune();
  const run = st.run;
  const [picked, setPicked] = React.useState(readChoice);
  const [err, setErr] = React.useState('');
  const seen = React.useRef(false);

  // Keep Storybook's own run/succeeded/crashed state in step with the real check.
  React.useEffect(() => {
    if (!run) return;
    if (run.running) store.setState('test-provider-state:running');
    else if (seen.current || run.finishedAt) store.setState(run.error ? 'test-provider-state:crashed' : 'test-provider-state:succeeded');
    seen.current = run.running;
  }, [run, store]);

  const browsers = run?.browsers ?? [];
  const chosen = browsers.filter((b) => (picked ? picked.includes(b) : true));
  const toggle = (b) => {
    const next = chosen.includes(b) ? chosen.filter((x) => x !== b) : [...chosen, b];
    setPicked(next);
    saveChoice(next);
  };
  const start = () => {
    setErr('');
    api('/api/run', { method: 'POST', body: JSON.stringify({ browsers: chosen }) }).then(refresh).catch((e) => setErr(e.message));
  };

  const pending = run?.summary?.pending ?? 0;
  const status = (() => {
    if (st.status === 'loading') return 'Looking for Kitsune...';
    if (st.status === 'offline') return 'Not running. Start it with `npx kitsune serve`.';
    if (st.status === 'signin') return 'Sign in to run visual tests.';
    if (run.running) return run.total ? `Capturing ${run.done}/${run.total}...` : 'Starting...';
    if (run.error) return `Last run failed: ${run.error}`;
    if (!run.summary) return 'Not run';
    return pending > 0 ? `${pending} to review` : `All ${run.summary.total} match`;
  })();

  const canRun = st.status === 'ready' && !run.running && chosen.length > 0;
  const pct = run?.running && run.total ? Math.round((run.done / run.total) * 100) : 0;

  const rows = (browsers.length ? browsers : []).map((b) => {
    const r = run?.byBrowser?.[b];
    const color = !r ? 'rgba(128,128,128,.55)' : r.pending ? '#e8830c' : '#29a35a';
    return h(
      'button',
      {
        key: b,
        type: 'button',
        role: 'checkbox',
        'aria-checked': chosen.includes(b),
        disabled: run?.running,
        onClick: () => toggle(b),
        style: { all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', cursor: run?.running ? 'default' : 'pointer', fontSize: 13 },
      },
      h(Check, { checked: chosen.includes(b), disabled: run?.running }),
      h('span', { style: { flex: 1 } }, LABELS[b] ?? b),
      r && h('span', { style: muted }, r.pending ? `${r.pending} to review` : 'ok'),
      dot(color),
    );
  });

  return h(
    'div',
    { style: { padding: '12px 14px 4px', lineHeight: '18px' } },
    // header: title + status on the left, run button on the right (same spot as "Run component tests")
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Run visual tests'),
        h('div', { style: { ...muted, overflowWrap: 'anywhere' } }, err || status),
      ),
      st.status === 'ready' &&
        h(
          'button',
          { type: 'button', 'aria-label': run.running ? 'Running visual tests' : 'Run visual tests', title: chosen.length ? `Run on ${chosen.map((b) => LABELS[b] ?? b).join(', ')}` : 'Pick at least one browser', disabled: !canRun, onClick: start, style: { all: 'unset', cursor: canRun ? 'pointer' : 'not-allowed', opacity: canRun ? 1 : 0.4, padding: 4, fontSize: 14 } },
          run.running ? '…' : '▶',
        ),
    ),
    // progress
    run?.running && h('div', { style: { height: 3, borderRadius: 2, background: 'rgba(128,128,128,.25)', margin: '8px 0 2px', overflow: 'hidden' } }, h('div', { style: { width: `${pct}%`, height: '100%', background: '#029cfd', transition: 'width .3s' } })),
    // browser rows
    st.status === 'ready' && h('div', { role: 'group', 'aria-label': 'Browsers', style: { margin: '8px 0 0' } }, rows),
    // locked state (shared server) or offline hint
    st.status === 'signin' &&
      h('div', { style: { ...muted, margin: '8px 0', padding: '8px 10px', borderRadius: 6, border: '1px dashed rgba(128,128,128,.5)' } }, 'This address is a shared review server. Sign in there to review. Checks run from CI or from your own `kitsune serve`.'),
    // footer actions
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 0 10px' } },
      st.status === 'signin' && h('button', { type: 'button', style: { ...textButton, background: '#029cfd', borderColor: '#029cfd', color: '#fff' }, onClick: openTab }, 'Sign in'),
      h('button', { type: 'button', style: textButton, onClick: openTab }, pending > 0 && st.status === 'ready' ? 'Review changes' : 'Open Kitsune'),
      st.status === 'offline' && h('button', { type: 'button', style: textButton, onClick: refresh }, 'Retry'),
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
          openTab: () => storybookApi.applyQueryParams({ tab: `${ADDON_ID}/tab` }), // the same switch Storybook's own tab buttons make
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
