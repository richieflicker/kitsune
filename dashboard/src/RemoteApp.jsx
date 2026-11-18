// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useMemo, useState } from 'react';
import App from './App.jsx';
import Requests from './Requests.jsx';
import Settings from './Settings.jsx';
import { remote } from './api.js';

const viewFromHash = () => (window.location.hash === '#/requests' ? 'requests' : window.location.hash === '#/settings' ? 'settings' : 'builds');
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
  const [signingIn, setSigningIn] = useState(false);
  const [view, setView] = useState(viewFromHash());

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
    const onHash = () => {
      setView(viewFromHash());
      setSelectedId(buildIdFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id) => {
    window.location.hash = `#/builds/${id}`;
    setSelectedId(id);
  };

  // Signed out = view only. Signed in but without the reviewer role (viewer, contributor) = also no approve buttons.
  const readOnly = Boolean(session?.readOnly) || (session ? !(session.can ?? ['review']).includes('review') : false);
  const source = useMemo(() => (selectedId ? { ...remote.sourceFor(selectedId), readOnly } : null), [selectedId, readOnly]);

  if (session === undefined) return <div className="empty"><h2>Loading…</h2></div>;
  if (!session || signingIn) return <Login onDone={(s) => { setSigningIn(false); setSession(s); }} onCancel={session ? () => setSigningIn(false) : null} />;

  const header = (
    <div className="remote-bar">
      {view === 'builds' && (
        <>
          <select aria-label="Build" value={selectedId ?? ''} onChange={(e) => select(e.target.value)}>
            {!builds.some((b) => b.id === selectedId) && selectedId && <option value={selectedId}>{selectedId}</option>}
            {builds.map((b) => (
              <option key={b.id} value={b.id}>{buildLabel(b)}</option>
            ))}
          </select>
          <button className="btn" onClick={loadBuilds} title="Refresh the build list">Refresh</button>
        </>
      )}
      {!session.readOnly && (
        <button className={`btn ${view === 'requests' ? 'btn-primary' : ''}`} onClick={() => { window.location.hash = view === 'requests' ? '' : '#/requests'; }}>
          {view === 'requests' ? 'Back to builds' : 'Requests'}
        </button>
      )}
      {(session.can ?? []).includes('manageUsers') && (
        <button className={`btn ${view === 'settings' ? 'btn-primary' : ''}`} onClick={() => { window.location.hash = view === 'settings' ? '' : '#/settings'; }}>
          {view === 'settings' ? 'Back to builds' : 'Settings'}
        </button>
      )}
      <span className="muted">{session.project} · {session.readOnly ? 'view only' : `${session.name}${session.role ? ` (${session.role})` : ''}`}</span>
      {session.readOnly ? (
        <button className="btn btn-primary" onClick={() => setSigningIn(true)}>Sign in to review</button>
      ) : (
        <button
          className="btn"
          onClick={async () => {
            await remote.logout().catch(() => {});
            remote.session().then(setSession).catch(() => setSession(null));
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );

  if (view === 'settings' && (session.can ?? []).includes('manageUsers')) {
    return (
      <div className="app">
        <header className="topbar"><h1>🦊 Kitsune Review</h1>{header}</header>
        <Settings />
      </div>
    );
  }

  if (view === 'requests' && !session.readOnly) {
    return (
      <div className="app">
        <header className="topbar"><h1>🦊 Kitsune Review</h1>{header}</header>
        <Requests session={session} />
      </div>
    );
  }

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

function Login({ onDone, onCancel }) {
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
        <p className="muted">Sign in with your review token. Approvals are recorded under your name.</p>
        <label>
          Review token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        </label>
        <label>
          Your name <span className="muted">(only for a shared team token; personal tokens already carry your name)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
        </label>
        {error && <div className="banner">{error}</div>}
        <button className="btn btn-primary" disabled={busy || !token}>Sign in</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Keep viewing only</button>}
      </form>
    </div>
  );
}
