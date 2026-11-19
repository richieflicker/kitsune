// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useState } from 'react';
import { remote } from './api.js';
import { ago } from './Branches.jsx';

const STATE_LABEL = {
  open: 'Waiting', building: 'Building', in_review: 'In review', approved: 'Approved', pr_created: 'PR created',
  published: 'Published', rejected: 'Rejected', changes_requested: 'Changes requested',
};
const FLOW = ['open', 'building', 'in_review', 'approved', 'pr_created', 'published'];
const EVENT = {
  submitted: 'submitted', build: 'started the build for', built: 'finished the build for', buildFailed: 'reported a failed build for', approve: 'approved',
  requestChanges: 'asked for changes on', reject: 'rejected', resubmit: 'resubmitted', pr: 'created the PR for', publish: 'published',
};

const Card = ({ label, value, hint, href, tone }) => {
  const body = (
    <>
      <span className="ov-value">{value}</span>
      <span className="ov-label">{label}</span>
      {hint && <span className="ov-hint">{hint}</span>}
    </>
  );
  return href ? <a className={`ov-card ov-${tone ?? 'plain'}`} href={href}>{body}</a> : <div className={`ov-card ov-${tone ?? 'plain'}`}>{body}</div>;
};

/** Admin home: what is waiting, who is on the team, what just happened. */
export default function Overview({ session }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => remote.overview().then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="overview"><div className="banner">{error}</div></div>;
  if (!data) return <div className="overview"><p className="muted">Loading…</p></div>;

  const { requests, builds, people, cliq, activity } = data;
  const inReview = requests.byState.in_review ?? 0;
  const needsAction = (requests.byState.open ?? 0) + (requests.byState.building ?? 0) + inReview + (requests.byState.approved ?? 0);

  return (
    <div className="overview">
      <div className="ov-head">
        <h2>Hello, {session.name}</h2>
        <button className="btn" onClick={load}>Refresh</button>
      </div>

      <div className="ov-cards">
        <Card label="Requests need action" value={needsAction} href="#/requests" tone={needsAction ? 'warn' : 'ok'} hint={inReview ? `${inReview} in review` : 'nothing in review'} />
        <Card label="Builds to review" value={builds.toReview} href="#/builds" tone={builds.toReview ? 'warn' : 'ok'} hint="with changes waiting" />
        <Card label="People" value={people.total} href="#/users" hint={Object.entries(people.byRole).map(([r, n]) => `${n} ${r}`).join(' · ')} />
        <Card label="Zoho Cliq alerts" value={cliq.configured ? 'On' : 'Off'} href="#/settings" tone={cliq.configured ? 'ok' : 'plain'} hint={cliq.configured ? 'team is notified' : 'set up in Settings'} />
      </div>

      <section>
        <h3>Request pipeline</h3>
        <div className="ov-flow">
          {FLOW.map((st) => (
            <a key={st} href="#/requests" className="ov-step">
              <strong>{requests.byState[st] ?? 0}</strong>
              <span>{STATE_LABEL[st]}</span>
            </a>
          ))}
        </div>
        {(requests.byState.changes_requested || requests.byState.rejected) ? (
          <p className="muted">
            {requests.byState.changes_requested ?? 0} waiting for the contributor to change · {requests.byState.rejected ?? 0} rejected
          </p>
        ) : null}
      </section>

      <div className="ov-cols">
        <section>
          <h3>Needs action</h3>
          {requests.waiting.length === 0 ? <p className="muted">All clear. 🎉</p> : (
            <ul className="ov-list">
              {requests.waiting.map((r) => (
                <li key={r.id}>
                  <a href="#/requests"><strong>{r.title}</strong></a>
                  <span className="muted">{r.requester} · {STATE_LABEL[r.state]} · {ago(r.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>Recent activity</h3>
          {activity.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ul className="ov-list">
              {activity.map((e, i) => (
                <li key={i}>
                  <span><strong>{e.actor}</strong> {EVENT[e.kind] ?? e.kind} “{e.title}”</span>
                  <span className="muted">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h3>Latest builds</h3>
        {builds.recent.length === 0 ? <p className="muted">No builds uploaded yet.</p> : (
          <ul className="ov-list">
            {builds.recent.slice(0, 5).map((b) => (
              <li key={b.id}>
                <a href={`#/builds/${b.id}`}><strong>{b.branch}</strong> <code>{b.commit ? b.commit.slice(0, 7) : ''}</code></a>
                <span className="muted">{b.status === 'ready' ? (b.pending ? `${b.pending} to review` : 'approved') : b.status} · {ago(b.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
