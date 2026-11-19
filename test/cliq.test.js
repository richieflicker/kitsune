import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkWebhookUrl, cliqMessage, maskWebhookUrl, postToCliq } from '../src/server/cliq.js';
import { openDb } from '../src/server/db.js';
import { createService } from '../src/server/service.js';

const URL_OK = 'https://cliq.zoho.in/api/v2/channelsbyname/kitsune/message?zapikey=1001.abcd.efgh1234';
const SHA = 'a'.repeat(40);

test('webhook address rules: only https Zoho hosts with a zapikey', () => {
  assert.equal(checkWebhookUrl(URL_OK), null);
  assert.equal(checkWebhookUrl('https://cliq.zoho.com/api/v2/channelsbyname/x/message?zapikey=k'), null);
  assert.equal(checkWebhookUrl('https://cliq.zoho.com.au/api/v2/channelsbyname/x/message?zapikey=k'), null);
  assert.match(checkWebhookUrl('http://cliq.zoho.com/x?zapikey=k'), /https/);
  assert.match(checkWebhookUrl('https://evil.example.com/x?zapikey=k'), /Zoho Cliq/);
  assert.match(checkWebhookUrl('https://cliq.zoho.com.evil.com/x?zapikey=k'), /Zoho Cliq/); // look-alike host
  assert.match(checkWebhookUrl('https://127.0.0.1/x?zapikey=k'), /Zoho Cliq/);
  assert.match(checkWebhookUrl('https://user:pw@cliq.zoho.com/x?zapikey=k'), /username/);
  assert.match(checkWebhookUrl('https://cliq.zoho.com/x'), /zapikey/);
  assert.match(checkWebhookUrl('nonsense'), /web address/);
});

test('the masked address never shows the key', () => {
  const masked = maskWebhookUrl(URL_OK);
  assert.ok(masked.endsWith('1234'));
  assert.ok(!masked.includes('abcd'));
});

test('messages name the actor and the request; unknown events give nothing', () => {
  const r = { title: 'New button', source: 'feature/x', target: 'main', reason: 'too wide' };
  assert.match(cliqMessage('submitted', r, 'Priya', 'https://k.example/#/requests'), /Priya.*New button.*feature\/x → main\)\nhttps:\/\/k\.example/s);
  assert.match(cliqMessage('requestChanges', r, 'Richie'), /too wide/);
  assert.equal(cliqMessage('nope', r, 'x'), null);
});

test('postToCliq never throws and reports failures', async () => {
  const sent = [];
  const ok = await postToCliq(URL_OK, 'hi', async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { status: 200 }; });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(sent[0].body, { text: 'hi' });
  assert.equal((await postToCliq(URL_OK, 'hi', async () => ({ status: 401 }))).ok, false);
  assert.match((await postToCliq(URL_OK, 'hi', async () => { throw new Error('offline'); })).error, /offline/);
  assert.equal((await postToCliq('https://evil.example.com/?zapikey=k', 'hi', async () => assert.fail('must not call'))).ok, false);
});

async function setup(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-cliq-'));
  const db = await openDb(dir);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body).text); return { status: 200 }; };
  const svc = createService({ db, dataDir: dir, env, fetchImpl });
  const { project } = svc.createProject({ name: 'p' });
  const settle = () => new Promise((r) => setTimeout(r, 20)); // alerts are sent in the background
  return { svc, project, calls, settle };
}

test('requests send alerts to the saved webhook, for the chosen events only', async () => {
  const { svc, project, calls, settle } = await setup();
  const dev = { name: 'Dev', role: 'contributor' };
  const admin = { name: 'Root', role: 'admin' };
  svc.setCliqSettings(project, { url: URL_OK, events: ['submitted', 'approve'] });
  const { id } = svc.createRequest(project, dev, { source: 'b', title: 'T', sha: SHA });
  svc.moveRequest(project, admin, id, 'build'); // not selected, and not an alert event anyway
  svc.moveRequest(project, admin, id, 'built'); // not selected
  svc.moveRequest(project, { name: 'Rev', role: 'reviewer' }, id, 'approve'); // a second person approves
  await settle();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /New review request/);
  assert.match(calls[1], /Approved/);
  assert.equal(svc.getCliqSettings(project).last.ok, true);
});

test('settings: validated, masked on read, test message, env var wins', async () => {
  const { svc, project, calls } = await setup();
  assert.throws(() => svc.setCliqSettings(project, { url: 'https://evil.example.com/?zapikey=k' }), /Zoho Cliq/);
  assert.throws(() => svc.setCliqSettings(project, { events: ['boom'] }), /events must be/);
  const saved = svc.setCliqSettings(project, { url: URL_OK });
  assert.equal(saved.configured, true);
  assert.ok(!JSON.stringify(saved).includes('abcd')); // the key is never returned
  assert.equal((await svc.testCliq(project, 'Root')).ok, true);
  assert.match(calls[0], /test message from Root/);
  svc.setCliqSettings(project, { url: '' });
  assert.equal(svc.getCliqSettings(project).configured, false);
  await assert.rejects(async () => svc.testCliq(project, 'Root'), /No Cliq webhook/);

  const viaEnv = await setup({ KITSUNE_CLIQ_WEBHOOK: URL_OK });
  assert.equal(viaEnv.svc.getCliqSettings(viaEnv.project).fromEnv, true);
});
