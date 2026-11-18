import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDb } from '../src/server/db.js';
import { ACTIONS, can, permissions, ROLES } from '../src/server/roles.js';
import { createService } from '../src/server/service.js';

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-roles-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  svc.createProject({ name: 'p' });
  return { svc };
}

test('permission table', () => {
  assert.deepEqual(permissions('viewer'), ['view']);
  assert.ok(can('contributor', 'request') && !can('contributor', 'review'));
  assert.ok(can('reviewer', 'review') && !can('reviewer', 'build'));
  for (const a of ACTIONS) assert.ok(can('admin', a), `admin can ${a}`);
  assert.equal(can('nobody', 'view'), false); // unknown role
  assert.equal(can('admin', 'launch-rockets'), false); // unknown action
  assert.deepEqual(ROLES, ['viewer', 'contributor', 'reviewer', 'admin']);
});

test('personal tokens carry a role, default reviewer, and login reports it', async () => {
  const { svc } = await setup();
  assert.equal(svc.addReviewer('p', 'Asha').role, 'reviewer');
  const dev = svc.addReviewer('p', 'Dev', 'contributor');
  assert.equal(svc.login(dev.token).role, 'contributor');
  assert.throws(() => svc.addReviewer('p', 'X', 'boss'), /Role must be one of/);
});

test('role changes apply to existing sessions immediately', async () => {
  const { svc } = await setup();
  svc.addReviewer('p', 'Root', 'admin');
  const dev = svc.addReviewer('p', 'Dev', 'reviewer');
  const { sessionId } = svc.login(dev.token);
  assert.equal(svc.authSession(sessionId).role, 'reviewer');
  svc.setRole('p', 'Dev', 'viewer');
  assert.equal(svc.authSession(sessionId).role, 'viewer');
  svc.revokeReviewer('p', 'Dev');
  assert.equal(svc.authSession(sessionId), null);
});

test('the last admin cannot be revoked or demoted', async () => {
  const { svc } = await setup();
  svc.addReviewer('p', 'Root', 'admin');
  assert.throws(() => svc.revokeReviewer('p', 'Root'), /last admin/);
  assert.throws(() => svc.setRole('p', 'Root', 'viewer'), /last admin/);
  svc.addReviewer('p', 'Second', 'admin');
  svc.setRole('p', 'Root', 'viewer'); // fine now
});

import { startRemoteServer } from '../src/server/app.js';

test('over HTTP: a viewer cannot approve, a reviewer passes the role check, session reports the role', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-roles-http-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  svc.createProject({ name: 'p' });
  const viewer = svc.addReviewer('p', 'Vi', 'viewer');
  const reviewer = svc.addReviewer('p', 'Re', 'reviewer');
  db.close?.();

  const server = await startRemoteServer({ dataDir: dir, port: 0, env: {}, onRetention: () => {} });
  try {
    const base = server.url ?? `http://127.0.0.1:${server.port}`;
    const hdr = { 'x-requested-with': 'kitsune', 'content-type': 'application/json' };
    const signIn = async (token) => {
      const r = await fetch(`${base}/api/v1/login`, { method: 'POST', headers: hdr, body: JSON.stringify({ token }) });
      assert.equal(r.status, 200);
      return r.headers.get('set-cookie').split(';')[0];
    };
    const approve = (cookie) => fetch(`${base}/api/v1/builds/b_nope/approve`, { method: 'POST', headers: { ...hdr, cookie }, body: JSON.stringify({ all: true }) });

    const vCookie = await signIn(viewer.token);
    assert.equal((await approve(vCookie)).status, 403);
    const me = await (await fetch(`${base}/api/v1/session`, { headers: { cookie: vCookie } })).json();
    assert.equal(me.role, 'viewer');
    assert.deepEqual(me.can, ['view']);

    const rCookie = await signIn(reviewer.token);
    assert.notEqual((await approve(rCookie)).status, 403); // passes the role check, then "no such build"
  } finally {
    await server.close?.();
  }
});

test('over HTTP: only admins manage users; token shown once; cannot lock out the last admin or yourself', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-users-http-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  svc.createProject({ name: 'p' });
  const admin = svc.addReviewer('p', 'Ad', 'admin');
  const reviewer = svc.addReviewer('p', 'Re', 'reviewer');
  db.close?.();

  const server = await startRemoteServer({ dataDir: dir, port: 0, env: {}, onRetention: () => {} });
  try {
    const base = server.url ?? `http://127.0.0.1:${server.port}`;
    const hdr = { 'x-requested-with': 'kitsune', 'content-type': 'application/json' };
    const signIn = async (token) => {
      const r = await fetch(`${base}/api/v1/login`, { method: 'POST', headers: hdr, body: JSON.stringify({ token }) });
      return r.headers.get('set-cookie').split(';')[0];
    };
    const call = (cookie, method, url, body) => fetch(`${base}${url}`, { method, headers: { ...hdr, cookie }, body: body ? JSON.stringify(body) : undefined });

    const rCookie = await signIn(reviewer.token);
    assert.equal((await call(rCookie, 'GET', '/api/v1/users')).status, 403);
    assert.equal((await call(rCookie, 'POST', '/api/v1/users', { name: 'X', role: 'viewer' })).status, 403);

    const aCookie = await signIn(admin.token);
    const added = await call(aCookie, 'POST', '/api/v1/users', { name: 'Priya', role: 'contributor' });
    assert.equal(added.status, 201);
    assert.match((await added.json()).token, /^kitsune_rv_/);

    const list = await (await call(aCookie, 'GET', '/api/v1/users')).json();
    assert.deepEqual(list.users.map((u) => u.name).sort(), ['Ad', 'Priya', 'Re']);
    assert.ok(!JSON.stringify(list).includes('token'));

    assert.equal((await call(aCookie, 'PUT', '/api/v1/users/Priya/role', { role: 'reviewer' })).status, 200);
    assert.equal((await call(aCookie, 'PUT', '/api/v1/users/Ad/role', { role: 'viewer' })).status, 409); // last admin
    assert.equal((await call(aCookie, 'DELETE', '/api/v1/users/Ad')).status, 409); // yourself
    assert.equal((await call(aCookie, 'DELETE', '/api/v1/users/Priya')).status, 200);
    const after = await (await call(aCookie, 'GET', '/api/v1/users')).json();
    assert.ok(!after.users.some((u) => u.name === 'Priya'));
  } finally {
    await server.close?.();
  }
});

test('overview: admin-only numbers for the dashboard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-overview-'));
  const db = await openDb(dir);
  const svc = createService({ db, dataDir: dir, env: {} });
  const { project } = svc.createProject({ name: 'p' });
  const admin = svc.addReviewer('p', 'Ad', 'admin');
  const contributor = svc.addReviewer('p', 'Co', 'contributor');
  svc.createRequest(project, { name: 'Co', role: 'contributor' }, { source: 'f/x', target: 'main', title: 'Thing', sha: 'a'.repeat(40) });
  const o = svc.overview(project);
  assert.equal(o.requests.total, 1);
  assert.equal(o.requests.byState.open, 1);
  assert.deepEqual(o.people.byRole, { admin: 1, contributor: 1 });
  assert.equal(o.activity[0].title, 'Thing');
  assert.equal(o.cliq.configured, false);
  db.close?.();
  void admin; void contributor;
});
