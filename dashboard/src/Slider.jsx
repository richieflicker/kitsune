// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (n) => Math.min(100, Math.max(0, n));

/**
 * Before/after comparison. Drag anywhere on the image (or use the arrow keys) to move the divider.
 * Left of the divider is the baseline, right is the new screenshot.
 */
export default function Slider({ before, after, diff, options = {} }) {
  const { start = 50, blinkMs = 700, highlight = false, highlightOpacity = 0.85 } = options;
  const [pos, setPos] = useState(clamp(start));
  const [dragging, setDragging] = useState(false);
  const [blink, setBlink] = useState(false);
  const [showDiff, setShowDiff] = useState(Boolean(highlight));
  const stage = useRef(null);

  const moveTo = useCallback((clientX) => {
    const rect = stage.current?.getBoundingClientRect();
    if (rect?.width) setPos(clamp(((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setBlink(false);
    moveTo(e.clientX);
  };
  const onPointerMove = (e) => dragging && moveTo(e.clientX);
  const endDrag = () => setDragging(false);

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 10 : 2;
    const keys = {
      ArrowLeft: () => setPos((p) => clamp(p - step)),
      ArrowRight: () => setPos((p) => clamp(p + step)),
      Home: () => setPos(0),
      End: () => setPos(100),
    };
    if (keys[e.key]) {
      e.preventDefault();
      setBlink(false);
      keys[e.key]();
    }
  };

  // Blink flips between the two images, which is the fastest way to spot a 1px shift.
  useEffect(() => {
    if (!blink) return undefined;
    setPos(100);
    const id = setInterval(() => setPos((p) => (p > 50 ? 0 : 100)), blinkMs);
    return () => clearInterval(id);
  }, [blink, blinkMs]);

  const preset = (value) => {
    setBlink(false);
    setPos(value);
  };

  return (
    <div className="cmp">
      <div className="cmp-toolbar">
        <div className="cmp-group" role="group" aria-label="Jump to">
          <button className={`chip ${pos === 100 && !blink ? 'chip-on' : ''}`} onClick={() => preset(100)}>Baseline</button>
          <button className={`chip ${pos === 50 && !blink ? 'chip-on' : ''}`} onClick={() => preset(50)}>50 / 50</button>
          <button className={`chip ${pos === 0 && !blink ? 'chip-on' : ''}`} onClick={() => preset(0)}>New</button>
        </div>
        <div className="cmp-group">
          <button className={`chip ${blink ? 'chip-on' : ''}`} aria-pressed={blink} onClick={() => setBlink((v) => !v)} title={`Flip between baseline and new every ${(blinkMs / 1000).toFixed(1)} seconds`}>
            Blink
          </button>
          {diff && (
            <button className={`chip ${showDiff ? 'chip-on' : ''}`} aria-pressed={showDiff} onClick={() => setShowDiff((v) => !v)} title="Outline the pixels that differ">
              Highlight changes
            </button>
          )}
        </div>
        <span className="cmp-hint muted">Drag the image or use ← → (Shift = bigger steps)</span>
      </div>

      <div className="cmp-legend" aria-hidden>
        <span><i className="cmp-key cmp-key-before" /> Baseline (left of the divider)</span>
        <span>New (right of the divider) <i className="cmp-key cmp-key-after" /></span>
      </div>

      <div
        ref={stage}
        className={`cmp-stage ${dragging ? 'cmp-dragging' : ''} ${blink ? 'cmp-blink' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img className="cmp-img" src={before} alt="Baseline" draggable={false} />
        <img className="cmp-img cmp-after" src={after} alt="New" draggable={false} style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
        {showDiff && diff && <img className="cmp-img cmp-diff" src={diff} alt="Changed pixels" draggable={false} style={{ opacity: highlightOpacity }} />}

        <div
          className="cmp-handle"
          style={{ left: `${pos}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Compare baseline and new"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% baseline visible`}
          onKeyDown={onKeyDown}
        >
          <span className="cmp-grip" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M6 4 2 9l4 5M12 4l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </div>
      </div>
    </div>
  );
}
