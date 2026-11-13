// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useState } from 'react';
import Slider from './Slider.jsx';
import { usePref, useUi } from './ui.jsx';

const MODES = [
  { id: 'side', label: 'Side by side' },
  { id: 'slider', label: 'Slider' },
  { id: 'diff', label: 'Diff' },
  { id: 'new', label: 'New' },
  { id: 'baseline', label: 'Baseline' },
];

export default function Viewer({ story, buildId, busy, onApprove, onReject }) {
  const canDiff = Boolean(story.diffImage);
  const canCompare = Boolean(story.baselineImage && story.newImage && story.status !== 'new');
  const ui = useUi();
  const [savedView, saveView] = usePref('view', null);
  const [zoom, saveZoom] = usePref('zoom', ui.zoom);
  const isAvailable = (id) => !((id === 'diff' && !canDiff) || ((id === 'side' || id === 'slider' || id === 'baseline') && !canCompare));
  // The reviewer's last choice first, then the project's default, then whatever this story can show.
  const firstView = [savedView, ui.view].find((id) => id && isAvailable(id)) ?? (canCompare ? 'side' : 'new');
  const [mode, setMode] = useState(firstView);
  const actualSize = zoom === 'actual'; // otherwise fit to panel
  const setActualSize = (fn) => saveZoom(fn(actualSize) ? 'actual' : 'fit');
  const src = (p) => `${p}?v=${buildId}`;
  const actionable = story.status === 'changed' || story.status === 'rejected';

  return (
    <section className="viewer">
      <div className="viewer-head">
        <div>
          <h2>{story.title} / {story.name}</h2>
          <p className="muted">
            {story.browser} · {story.viewport} · <span className={`status status-${story.status}`}>{story.status}</span>
            {story.diffPixels > 0 && ` · ${story.diffPixels.toLocaleString()} px differ (${(story.diffRatio * 100).toFixed(2)}%)`}
            {story.sizeChanged && ' · page size changed'}
          </p>
        </div>
        <div className="viewer-actions">
          <button className="btn btn-reject" disabled={busy || story.status !== 'changed'} onClick={onReject}>Reject</button>
          <button className="btn btn-primary" disabled={busy || !actionable} onClick={onApprove}>Approve</button>
        </div>
      </div>

      {story.status === 'error' && <div className="banner">Could not render this story: {story.error}</div>}
      {story.status === 'new' && <div className="banner banner-info">First time this story was captured, so it was approved automatically as the baseline.</div>}
      {story.note && story.status !== 'new' && <div className="banner banner-info">{story.note}</div>}

      {story.newImage && (
        <>
          <div className="modes" role="tablist">
            {MODES.map((m) => {
              const disabled = !isAvailable(m.id);
              return (
                <button key={m.id} role="tab" aria-selected={mode === m.id} disabled={disabled} className={`mode ${mode === m.id ? 'mode-active' : ''}`} onClick={() => { setMode(m.id); saveView(m.id); }}>
                  {m.label}
                </button>
              );
            })}
            <button className="mode mode-zoom" aria-pressed={actualSize} onClick={() => setActualSize((v) => !v)} title="Toggle between fitting the panel and 1:1 pixels">
              {actualSize ? '100% (click to fit)' : 'Fit (click for 100%)'}
            </button>
          </div>

          <div className={`canvas ${actualSize ? 'actual' : ''}`}>
            {mode === 'side' && (
              <div className="side">
                <Figure label="Baseline" src={src(story.baselineImage)} />
                <Figure label="New" src={src(story.newImage)} />
              </div>
            )}
            {mode === 'slider' && <Slider before={src(story.baselineImage)} after={src(story.newImage)} diff={story.diffImage ? src(story.diffImage) : null} options={ui.slider} />}
            {mode === 'diff' && <Figure label="Diff (red = changed pixels)" src={src(story.diffImage)} />}
            {mode === 'new' && <Figure label="New" src={src(story.newImage)} />}
            {mode === 'baseline' && <Figure label="Baseline" src={src(story.baselineImage)} />}
          </div>
        </>
      )}
    </section>
  );
}

function Figure({ label, src }) {
  return (
    <figure className="figure">
      <figcaption>{label}</figcaption>
      <img src={src} alt={label} />
    </figure>
  );
}
