// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useState } from 'react';
import { remote } from './api.js';
import { ago } from './Branches.jsx';

const STATE_LABEL = {
  open: 'Waiting',
  building: 'Building',
  in_review: 'In review',
  approved: 'Approved',
  pr_created: 'PR created',
  published: 'Published',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
};
const STATE_TONE = { approved: 'ok', pr_created: 'ok', published: 'ok', rejected: 'bad', changes_requested: 'warn', building: 'info', in_review: 'info', open: 'plain' };
const EVENT_LABEL = {
  submitted: 'submitted the request', build: 'started the build', built: 'finished the build', buildFailed: 'reported a failed build', approve: 'approved',
  requestChanges: 'asked for changes', reject: 'rejected', resubmit: 'resubmitted', pr: 'created the pull request', publish: 'published',
};

// What each state offers. The server checks every move again; this only decides which buttons to show.
const MOVES = [
  { action: 'build', label: 'Start build', from: ['open'], needs: 'build', primary: true },
  { action: 'built', label: 'Build finished, ready to review', from: ['building'], needs: 'build', primary: true },
  { action: 'approve', label: 'Approve', from: ['in_review'], needs: 'review', primary: true },
  { action: 'requestChanges', label: 'Ask for changes', from: ['in_review'], needs: 'review', reason: true },
  { action: 'reject', label: 'Reject', from: ['open', 'building', 'in_review', 'changes_requested'], needs: 'review', reason: true, danger: true },
  { action: 'pr', label: 'Mark PR created', from: ['approved'], needs: 'createPr' },
  { action: 'publish', label: 'Mark published', from: ['approved', 'pr_created'], needs: 'publish' },
  { action: 'resubmit', label: 'Resubmit', from: ['changes_requested'], needs: 'request', owner: true, sha: true, primary: true },
];

const Pill = ({ state }) => <span className={`pill pill-${STATE_TONE[state] ?? 'plain'}`}>{STATE_LABEL[state] ?? state}</span>;

function NewRequest({ onDone }) {
  const [f, setF] = useState({ source: '', target: '', title: '', sha: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await remote.submitRequest({ ...f, target: f.target.trim() || undefined, sha: f.sha.trim() });
      onDone(made.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="req-form" onSubmit={submit}>
      <h3>New review request</h3>
      <label>Title<input value={f.title} onChange={set('title')} maxLength={120} required /></label>
      <label>Your branch<input value={f.source} onChange={set('source')} placeholder="feature/new-button" required /></label>
      <label>Merge into <span className="muted">(blank = the project's default branch)</span><input value={f.target} onChange={set('target')} placeholder="main" /></label>
      <label>Commit <span className="muted">(git rev-parse HEAD; the exact version you want reviewed)</span><input value={f.sha} onChange={set('sha')} placeholder="a1b2c3d" required pattern="[0-9a-fA-F]{7,40}" /></label>
      <label>Note <span className="muted">(optional)</span><textarea value={f.note} onChange={set('note')} rows={3} maxLength={2000} /></label>
      {error && <div className="banner">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>Submit request</button>
    </form>
  );
}

function Detail({ id, session, onChanged }) {
  const [req, setReq] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [sha, setSha] = useState('');
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState(null); // the uploaded build for this commit, if there is one

  const load = useCallback(() => remote.request(id).then(setReq).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setReq(null); setError(null); setReason(''); setSha(''); load(); }, [load]);

  useEffect(() => {
    if (!req) return;
    remote.builds().then(({ builds }) => {
      // Newest first; the request's commit may be a short prefix of the build's.
      setBuild(builds.find((b) => b.commit && (b.commit.startsWith(req.sha) || req.sha.startsWith(b.commit))) ?? null);
    }).catch(() => setBuild(null));
  }, [req?.sha]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner">{error}</div>;
  if (!req) return <p className="muted">Loading…</p>;

  const can = new Set(session.can ?? []);
  const blocked = req.blockedActions ?? [];
  const moves = MOVES.filter((m) => m.from.includes(req.state) && can.has(m.needs) && !blocked.includes(m.action) && (!m.owner || req.requester === session.name));
  const mustWait = blocked.includes('approve') && req.state === 'in_review' && can.has('review');
  const needsReason = moves.some((m) => m.reason);

  const go = async (m) => {
    setBusy(true);
    setError(null);
    try {
      setReq(await remote.moveRequest(id, m.action, { reason: reason.trim() || undefined, sha: m.sha && sha.trim() ? sha.trim() : undefined }));
      setReason('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="req-detail">
      <div className="req-head">
        <h3>{req.title}</h3>
        <Pill state={req.state} />
      </div>
      <p className="muted">
        {req.requester} · <code>{req.source}</code> → <code>{req.target}</code> · commit <code>{req.sha.slice(0, 12)}</code> · {ago(req.updatedAt)}
      </p>
      {req.note && <p className="req-note">{req.note}</p>}
      <p>
        {build ? (
          <a className="btn btn-primary" href={`#/builds/${build.id}`}>
            See the changes{build.pending ? ` (${build.pending} to review)` : ''}
          </a>
        ) : (
          <span className="muted">No build for this commit has been uploaded yet.</span>
        )}
      </p>
      {req.reason && (req.state === 'rejected' || req.state === 'changes_requested') && <div className="banner">{req.reason}</div>}
      {error && <div className="banner">{error}</div>}

      {moves.length > 0 && (
        <div className="req-actions">
          {needsReason && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (needed to reject or ask for changes)" maxLength={500} />}
          {moves.some((m) => m.sha) && <input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="New commit (optional, if you pushed again)" pattern="[0-9a-fA-F]{7,40}" />}
          {mustWait && <p className="muted">You sent or built this request, so another reviewer or admin has to approve it.</p>}
          <div className="req-buttons">
            {moves.map((m) => (
              <button key={m.action} className={`btn ${m.primary ? 'btn-primary' : ''} ${m.danger ? 'btn-reject' : ''}`} disabled={busy || (m.reason && !reason.trim())} onClick={() => go(m)}>{m.label}</button>
            ))}
          </div>
        </div>
      )}
      {req.state === 'building' && can.has('build') && (
        <p className="muted">Building happens on your own machine for now: run <code>kitsune serve</code> there, open Branches, build this branch, then come back and press "Build finished".</p>
      )}

      <h4>History</h4>
      <ul className="req-events">
        {req.events.map((e, i) => (
          <li key={i}><b>{e.actor}</b> {EVENT_LABEL[e.kind] ?? e.kind}{e.detail ? <span className="muted"> — {e.detail}</span> : null} <span className="muted">· {ago(e.at)}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** The request queue: contributors see their own requests and their status, reviewers and admins see everyone's. */
export default function Requests({ session }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState(null); // null = pick a sensible start once the list has loaded

  const load = useCallback(() => remote.requests().then((r) => setList(r.requests)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const can = session.can ?? [];
  const canSubmit = can.includes('request');
  const isAdmin = can.includes('manageUsers');
  const done = (s) => ['published', 'rejected'].includes(s);
  // "Needs me": what this role is expected to act on next.
  const needsMe = (r) => {
    if (isAdmin) return ['open', 'building', 'in_review', 'approved', 'pr_created'].includes(r.state);
    if (can.includes('review')) return r.state === 'in_review';
    return r.state === 'changes_requested';
  };
  const attention = (list ?? []).filter(needsMe).length;
  const counts = {};
  for (const r of list ?? []) counts[r.state] = (counts[r.state] ?? 0) + 1;

  const current = filter ?? (list ? (attention > 0 ? 'attention' : 'active') : 'active');
  const matches = (r) => {
    if (current === 'all') return true;
    if (current === 'active') return !done(r.state);
    if (current === 'done') return done(r.state);
    if (current === 'attention') return needsMe(r);
    return r.state === current.replace('state:', '');
  };
  const shown = (list ?? []).filter(matches);
  const mine = !can.includes('review') && !isAdmin; // contributors only ever see their own requests
  const SUMMARY = ['open', 'building', 'in_review', 'approved', 'changes_requested'];

  return (
    <div className="requests">
      <div className="req-list">
        <h2 className="req-heading">{mine ? 'My requests' : isAdmin ? 'Review queue' : 'Needs review'}</h2>
        {!mine && list && (
          <div className="req-summary">
            {SUMMARY.map((st) => (
              <button key={st} className={`req-count ${current === `state:${st}` ? 'is-on' : ''}`} onClick={() => setFilter(`state:${st}`)}>
                <strong>{counts[st] ?? 0}</strong> {STATE_LABEL[st]}
              </button>
            ))}
          </div>
        )}
        <div className="req-toolbar">
          <select aria-label="Filter" value={current.startsWith('state:') ? 'all' : current} onChange={(e) => setFilter(e.target.value)}>
            <option value="attention">{mine ? 'Needs my changes' : 'Needs my attention'} ({attention})</option>
            <option value="active">Open requests</option>
            <option value="done">Finished</option>
            <option value="all">All</option>
          </select>
          <button className="btn" onClick={load}>Refresh</button>
          {canSubmit && <button className="btn btn-primary" onClick={() => { setCreating(true); setSelected(null); }}>New request</button>}
        </div>
        {error && <div className="banner">{error}</div>}
        {list && shown.length === 0 && <p className="muted req-empty">{current === 'attention' ? 'Nothing is waiting for you. 🎉' : canSubmit ? 'Nothing here yet. Press "New request" to ask for a review.' : 'Nothing here.'}</p>}
        <ul>
          {shown.map((r) => (
            <li key={r.id}>
              <button className={`req-row ${selected === r.id ? 'is-on' : ''}`} onClick={() => { setSelected(r.id); setCreating(false); }}>
                <span className="req-title">{r.title}</span>
                <Pill state={r.state} />
                <span className="muted">{r.requester} · {r.source} · {ago(r.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="req-main">
        {creating && <NewRequest onDone={(id) => { setCreating(false); setSelected(id); load(); }} />}
        {!creating && selected && <Detail key={selected} id={selected} session={session} onChanged={load} />}
        {!creating && !selected && <p className="muted req-empty">Pick a request to see where it stands.</p>}
      </div>
    </div>
  );
}
