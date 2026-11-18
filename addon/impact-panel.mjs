// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// The "Visual changes" panel under a story: how much did this story change against its baseline?
// Shared by the Storybook 8 and 9 manager entries; each passes in its own React and manager-api hooks.
const COLORS = { none: '#29a35a', minor: '#6b9a2f', moderate: '#e8830c', major: '#d9363e', new: '#029cfd', unknown: '#6b7a90' };
const LABELS = { none: 'No change', minor: 'Minor', moderate: 'Moderate', major: 'Major', new: 'New story', unknown: 'Changed' };
const RANK = ['none', 'minor', 'moderate', 'major'];

export function createImpactPanel({ React, useStorybookState, base, openTab }) {
  const h = React.createElement;
  const muted = { opacity: 0.7, fontSize: 12 };

  const get = (path) => fetch(base + path, { headers: { 'x-requested-with': 'kitsune' } }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

  const badge = (level) =>
    h('span', { style: { background: COLORS[level] ?? COLORS.unknown, color: '#fff', borderRadius: 10, padding: '1px 9px', fontSize: 12, fontWeight: 600 } }, LABELS[level] ?? level);

  const pct = (n) => (n > 0 && n < 0.001 ? '<0.1%' : `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`);

  const thumb = (src, label) =>
    h('figure', { style: { margin: 0, flex: '1 1 0', minWidth: 0 } },
      h('div', { style: { ...muted, marginBottom: 3 } }, label),
      src ? h('img', { src: base + src, alt: label, style: { width: '100%', maxHeight: 150, objectFit: 'contain', objectPosition: 'top left', border: '1px solid rgba(128,128,128,.35)', borderRadius: 4, background: '#fff' } }) : h('div', { style: { ...muted, padding: '24px 0' } }, 'none'));

  return function ImpactPanel({ active }) {
    const { storyId } = useStorybookState();
    const [state, setState] = React.useState({ status: 'loading' });
    const [pick, setPick] = React.useState(0);

    React.useEffect(() => {
      if (!active || !storyId) return undefined;
      let alive = true;
      setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
      setPick(0);
      get('/api/mode')
        .then((m) => {
          if (m.mode === 'remote') return { status: 'remote' };
          return get(`/api/impact?story=${encodeURIComponent(storyId)}`).then((data) => ({ status: 'ready', data }));
        })
        .catch(() => ({ status: 'offline' }))
        .then((next) => alive && setState(next));
      return () => {
        alive = false;
      };
    }, [active, storyId]);

    if (!active) return null;
    const box = { padding: '12px 14px', fontSize: 13, lineHeight: '18px' };
    const button = { cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit' };

    if (state.status === 'loading') return h('div', { style: box }, 'Checking visual changes...');
    if (state.status === 'offline') return h('div', { style: box }, 'Kitsune is not running. Start it with `npx kitsune serve`, then run a check.');
    if (state.status === 'remote') return h('div', { style: box }, h('div', null, 'This address is a shared review server.'), h('button', { type: 'button', style: { ...button, marginTop: 8 }, onClick: openTab }, 'Open Kitsune'));

    const { data } = state;
    if (!data.found) return h('div', { style: box }, 'No results for this story yet. Run a visual check (Testing panel in the sidebar, or `kitsune check`).');

    const row = data.results[Math.min(pick, data.results.length - 1)];
    const changed = row.status === 'changed';
    const sorted = RANK.indexOf(data.worst) >= 0 || data.worst === 'new';

    return h('div', { style: box },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        badge(data.worst),
        data.results.length > 1 && h('select', { value: pick, onChange: (e) => setPick(Number(e.target.value)), 'aria-label': 'Viewport and browser', style: { font: 'inherit', fontSize: 12 } },
          data.results.map((r, i) => h('option', { key: r.key, value: i }, `${r.viewport} · ${r.browser} · ${LABELS[r.impact] ?? r.impact}`))),
        h('span', { style: { flex: 1 } }),
        h('button', { type: 'button', style: button, onClick: openTab }, changed ? 'Review changes' : 'Open Kitsune')),
      sorted && row.status !== 'new' && h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0 8px' } },
        h('span', null, h('b', null, pct(row.diffRatio)), h('span', { style: muted }, ' of the page changed')),
        h('span', null, h('b', null, row.regions), h('span', { style: muted }, row.regions === 1 ? ' area' : ' areas')),
        h('span', null, h('b', null, pct(row.bboxRatio)), h('span', { style: muted }, ' spread')),
        row.sizeChanged && h('span', { style: { color: COLORS.major, fontWeight: 600 } }, 'Page size changed')),
      row.status === 'new' && h('div', { style: { ...muted, margin: '10px 0 8px' } }, 'No baseline yet, so there is nothing to compare with.'),
      row.status !== 'new' && h('div', { style: { display: 'flex', gap: 10 } },
        thumb(row.baselineImage, 'Before'), thumb(row.newImage, 'After'), changed && thumb(row.diffImage, 'Difference')));
  };
}
