// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useMemo, useState } from 'react';
import App from './App.jsx';
import { remote } from './api.js';

const buildIdFromHash = () => /^#\/builds\/([^/]+)/.exec(window.location.hash)?.[1] ?? null;

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildLabel(b) {
  const state = b.status === 'ready' ? (b.pending ? `${b.pending} to review` : 'approved') : b.status;
  return `${b.branch} · ${b.commit ? b.commit.slice(0, 7) : 'no commit'} · ${ago(b.createdAt)} · ${state}`;
}

export default function RemoteApp() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [builds, setBuilds] = useState([]);
  const [selectedId, setSelectedId] = useState(buildIdFromHash());
  const [error, setError] = useState(null);

  useEffect(() => {
    remote.session().then(setSession).catch(() => setSession(null));
  }, []);

  const loadBuilds = useCallback(async () => {
    try {
      const { builds: list } = await remote.builds();
      setBuilds(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    } catch (e) {
      if (e.status === 401) setSession(null);
      else setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (session) loadBuilds();
  }, [session, loadBuilds]);

  useEffect(() => {
    const onHash = () => setSelectedId(buildIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id) => {
    window.location.hash = `#/builds/${id}`;
    setSelectedId(id);
  };

  const source = useMemo(() => (selectedId ? remote.sourceFor(selectedId) : null), [selectedId]);

  if (session === undefined) return <div className="empty"><h2>Loading…</h2></div>;
  if (!session) return <Login onDone={setSession} />;

  const header = (
    <div className="remote-bar">
      <select aria-label="Build" value={selectedId ?? ''} onChange={(e) => select(e.target.value)}>
        {!builds.some((b) => b.id === selectedId) && selectedId && <option value={selectedId}>{selectedId}</option>}
        {builds.map((b) => (
          <option key={b.id} value={b.id}>{buildLabel(b)}</option>
        ))}
      </select>
      <button className="btn" onClick={loadBuilds} title="Refresh the build list">Refresh</button>
      <span className="muted">{session.project} · {session.name}</span>
      <button
        className="btn"
        onClick={async () => {
          await remote.logout().catch(() => {});
          setSession(null);
        }}
      >
        Sign out
      </button>
    </div>
  );

  if (!source) {
    return (
      <div className="app">
        <header className="topbar"><h1>🦊 Kitsune Review</h1>{header}</header>
        <div className="empty">
          <h2>{error ? 'Could not load builds' : 'No builds yet'}</h2>
          <p className="muted">{error ?? 'Run `kitsune check --remote` from CI to upload the first build.'}</p>
        </div>
      </div>
    );
  }

  // key={selectedId}: a different build starts with fresh filters/selection.
  return <App key={selectedId} source={source} headerExtra={header} onChanged={loadBuilds} />;
}

function Login({ onDone }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('kitsune-name') ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await remote.login(token.trim(), name.trim());
      localStorage.setItem('kitsune-name', name.trim());
      onDone(await remote.session());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="empty">
      <form className="login" onSubmit={submit}>
        <h2>🦊 Kitsune Review</h2>
        <p className="muted">Sign in with your project's review token. Approvals are recorded under your name.</p>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} />
        </label>
        <label>
          Review token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        </label>
        {error && <div className="banner">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !token || !name}>Sign in</button>
      </form>
    </div>
  );
}
