// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useState } from 'react';
import { remote } from './api.js';
import { ago } from './Branches.jsx';

const EVENT_LABEL = {
  submitted: 'A new request is submitted',
  built: 'A build is ready to review',
  approve: 'A request is approved',
  requestChanges: 'Changes are requested',
  reject: 'A request is rejected',
  resubmit: 'A request is resubmitted',
  pr: 'A pull request is created',
  publish: 'A package is published',
};

/** Admin settings. For now: Zoho Cliq alerts. */
export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = (c) => {
    setCfg(c);
    setEvents(c.events);
    setUrl('');
  };
  const load = useCallback(() => remote.cliq().then(apply).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="settings">{error ? <div className="banner">{error}</div> : <p className="muted">Loading…</p>}</div>;

  const toggle = (e) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);
  const save = () => run(async () => apply(await remote.saveCliq({ events, ...(url.trim() ? { url: url.trim() } : {}) })), 'Saved.');
  const test = () => run(async () => {
    const r = await remote.testCliq();
    apply(r.settings);
    if (!r.ok) throw new Error(r.error);
  }, 'Test message sent. Check your Cliq channel.');
  const clear = () => run(async () => apply(await remote.saveCliq({ url: '' })), 'Webhook removed.');

  return (
    <div className="settings">
      <h3>Zoho Cliq alerts</h3>
      <p className="muted">
        Kitsune posts a short message to a Cliq channel when a request moves. In Cliq, open the channel, add an incoming webhook, and paste the full address here.
      </p>

      {cfg.fromEnv ? (
        <p className="banner">The webhook is set by the server's <code>KITSUNE_CLIQ_WEBHOOK</code> setting, so it cannot be changed here.</p>
      ) : (
        <label className="set-field">
          Webhook address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={cfg.configured ? `Saved: ${cfg.webhook} (paste a new one to replace it)` : 'https://cliq.zoho.com/api/v2/channelsbyname/…/message?zapikey=…'} autoComplete="off" spellCheck={false} />
          <span className="muted">Only Zoho Cliq addresses are accepted. The key is stored on the server and never shown again.</span>
        </label>
      )}

      <fieldset className="set-events">
        <legend>Send a message when</legend>
        {cfg.allEvents.map((e) => (
          <label key={e}><input type="checkbox" checked={events.includes(e)} onChange={() => toggle(e)} /> {EVENT_LABEL[e] ?? e}</label>
        ))}
      </fieldset>

      {error && <div className="banner">{error}</div>}
      {msg && <p className="muted">{msg}</p>}
      {cfg.last && <p className="muted">Last alert: {cfg.last.ok ? 'sent' : `failed (${cfg.last.error})`} · {cfg.last.event} · {ago(cfg.last.at)}</p>}

      <div className="req-buttons">
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
        <button className="btn" disabled={busy || !cfg.configured} onClick={test}>Send test message</button>
        {cfg.configured && !cfg.fromEnv && <button className="btn btn-reject" disabled={busy} onClick={clear}>Remove webhook</button>}
      </div>
    </div>
  );
}
