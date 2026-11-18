// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { useCallback, useEffect, useState } from 'react';
import { remote } from './api.js';
import { ago } from './Branches.jsx';

const ROLES = [
  ['viewer', 'Viewer', 'Can look at builds'],
  ['contributor', 'Contributor', 'Can send review requests'],
  ['reviewer', 'Reviewer', 'Can approve or reject changes'],
  ['admin', 'Admin', 'Everything, including users and settings'],
];

/** Admin page: who can sign in, with which role. A new person's token is shown once, right after adding. */
export default function Users({ me }) {
  const [users, setUsers] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('contributor');
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => remote.users().then((r) => setUsers(r.users)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      setIssued(await remote.addUser(name.trim(), role));
      setName('');
      await load();
    });
  };

  return (
    <div className="settings users">
      <h2>People</h2>
      <p className="muted">Everyone who can sign in to this server. Roles take effect on their next click.</p>
      {error && <div className="banner">{error}</div>}

      {issued && (
        <div className="token-box" role="status">
          <strong>Token for {issued.name}</strong> <span className="muted">(shown once — copy it now and send it privately)</span>
          <code>{issued.token}</code>
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(issued.token)}>Copy</button>
            <button className="btn" onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      )}

      <form className="user-add" onSubmit={add}>
        <input placeholder="Name, e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required aria-label="Name" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>Add person</button>
      </form>
      <p className="muted">{ROLES.find(([id]) => id === role)?.[2]}.</p>

      {users === null ? <p className="muted">Loading…</p> : (
        <table className="user-table">
          <thead><tr><th>Name</th><th>Role</th><th>Added</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.name}>
                <td>{u.name}{u.name === me.name && <span className="muted"> (you)</span>}</td>
                <td>
                  <select value={u.role} disabled={busy} aria-label={`Role of ${u.name}`} onChange={(e) => run(async () => { await remote.setUserRole(u.name, e.target.value); await load(); })}>
                    {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </td>
                <td className="muted">{ago(u.createdAt)}</td>
                <td>
                  {u.name !== me.name && (
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => { if (window.confirm(`Remove ${u.name}? Their token stops working immediately.`)) run(async () => { await remote.revokeUser(u.name); await load(); }); }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
