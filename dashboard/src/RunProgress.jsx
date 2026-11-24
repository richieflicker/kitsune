// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useEffect, useState } from 'react';

const ICON = { pending: '○', running: '◐', done: '✓', failed: '✗', skipped: '–' };

export function formatMs(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`;
}

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StageRow({ s, now }) {
  const ms = s.status === 'running' && s.startedAt ? now - s.startedAt : s.ms;
  const counted = s.total != null && (s.status === 'running' || s.status === 'done');
  return (
    <li className={`run-stage run-${s.status}`}>
      <span className="run-icon" aria-hidden="true">{ICON[s.status]}</span>
      <span className="run-label">
        {s.label}
        {s.detail && <span className="muted"> · {s.detail}</span>}
        {counted && s.status === 'done' && <span className="muted"> · {s.total}</span>}
      </span>
      <span className="run-time muted">{ms != null && s.status !== 'pending' ? formatMs(ms) : ''}</span>
      {counted && s.status === 'running' && (
        <span className="run-bar">
          <progress max={s.total || 1} value={s.done ?? 0} aria-label={`${s.label} progress`} />
          <span className="muted">{s.done ?? 0} / {s.total}</span>
        </span>
      )}
    </li>
  );
}

function Summary({ run }) {
  const sm = run.summary ?? {};
  const counts = sm.counts ?? {};
  if (sm.stories == null && !sm.counts) return null;
  const parts = [];
  if (sm.stories != null) parts.push(`${sm.stories} stor${sm.stories === 1 ? 'y' : 'ies'}`);
  if (sm.viewports != null) parts.push(`${sm.viewports} viewport${sm.viewports === 1 ? '' : 's'}`);
  if (sm.browsers != null) parts.push(`${sm.browsers} browser${sm.browsers === 1 ? '' : 's'}`);
  return (
    <div className="run-summary">
      <p>
        {parts.length > 0 && <strong>{parts.join(' × ')}</strong>}
        {sm.screenshots != null && <> = <strong>{sm.screenshots} screenshot{sm.screenshots === 1 ? '' : 's'}</strong> checked</>}
        {run.finishedAt && <span className="muted"> · total {formatMs(run.ms)}</span>}
      </p>
      {sm.counts && (
        <p className="run-counts">
          <span className="pill pill-ok">{counts.unchanged ?? 0} unchanged</span>{' '}
          <span className="pill pill-info">{counts.new ?? 0} new</span>{' '}
          <span className={`pill pill-${counts.changed ? 'warn' : 'plain'}`}>{counts.changed ?? 0} changed</span>{' '}
          <span className={`pill pill-${counts.error ? 'bad' : 'plain'}`}>{counts.error ?? 0} could not render</span>
        </p>
      )}
      {sm.failedStories?.length > 0 && (
        <details open>
          <summary>{sm.failedStories.length} stor{sm.failedStories.length === 1 ? 'y' : 'ies'} could not render</summary>
          <ul className="run-failed-list">
            {sm.failedStories.map((f, i) => (
              <li key={i}>
                <strong>{f.title} / {f.name}</strong> <span className="muted">({f.viewport}, {f.browser})</span>
                <div className="muted">{f.error}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Failure({ run }) {
  const f = run.failure;
  if (!f) return null;
  const stage = run.stages.find((s) => s.id === f.stage);
  return (
    <div className="run-failure" role="alert">
      <h4>What went wrong{stage ? <span className="muted"> · during “{stage.label}”</span> : null}</h4>
      <p><strong>{f.title}</strong></p>
      <p><span className="muted">How to fix it:</span> {f.hint}</p>
      {f.excerpt?.length > 0 && <pre className="req-log">{f.excerpt.join('\n')}</pre>}
    </div>
  );
}

function FullLog({ log }) {
  const [copied, setCopied] = useState(false);
  if (!log?.length) return null;
  const text = log.map((l) => l.line).join('\n');
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  return (
    <details className="run-log">
      <summary>Show full log ({log.length} lines)</summary>
      <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy log'}</button>
      <pre className="req-log">{text}</pre>
    </details>
  );
}

/** The build-and-check of a review request: steps with times, a bar while capturing, the result, and why it failed. */
export default function RunProgress({ run }) {
  const live = run?.status === 'running';
  const now = useNow(live);
  if (!run) return null;
  const groups = [];
  for (const s of run.stages) {
    const last = groups.at(-1);
    if (last && last.name === s.group) last.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }
  const total = live && run.startedAt ? now - run.startedAt : run.ms;
  const heading = live ? 'Working on it' : run.status === 'failed' ? 'Build failed' : 'Build finished';
  return (
    <section className={`br-card run run-state-${run.status}`} aria-label="Build report">
      <div className="run-head">
        <strong>{heading}</strong>
        <span className="muted">{formatMs(total)}</span>
      </div>
      {groups.map((g) => (
        <div key={g.name}>
          <div className="run-group muted">{g.name}</div>
          <ul className="run-stages">{g.items.map((s) => <StageRow key={s.id} s={s} now={now} />)}</ul>
        </div>
      ))}
      <Failure run={run} />
      <Summary run={run} />
      <FullLog log={run.log} />
    </section>
  );
}
