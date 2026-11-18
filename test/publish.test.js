import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { npmrcLine, publishPackage } from '../src/publish.js';

const SHA = 'c'.repeat(40);

function pkgDir(pkg = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-pub-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ds', version: '1.2.3', ...pkg }));
  return dir;
}

/** A fake git + npm. `over` replaces the answer for one command, e.g. { 'npm view': { code: 0, stdout: '1.2.3' } }. */
function fakeExec(over = {}) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    const key = cmd === 'npm' ? `npm ${args[0]}` : `git ${args[0]}`;
    calls.push({ key, args, rc: args.includes('--userconfig') ? fs.readFileSync(args[args.indexOf('--userconfig') + 1], 'utf8') : null });
    if (over[key]) return { stdout: '', stderr: '', ...over[key] };
    const defaults = {
      'git rev-parse': { code: 0, stdout: `${SHA}\n`, stderr: '' },
      'git status': { code: 0, stdout: '', stderr: '' },
      'npm whoami': { code: 0, stdout: 'richie\n', stderr: '' },
      'npm view': { code: 1, stdout: '', stderr: 'E404' },
      'npm publish': { code: 0, stdout: '+ ds@1.2.3', stderr: '' },
    };
    return defaults[key];
  };
  return { exec, calls };
}

const base = { registry: 'http://localhost:4873', log: () => {} };

test('npmrcLine builds the registry-scoped token line', () => {
  assert.equal(npmrcLine('http://localhost:4873', 'T'), '//localhost:4873/:_authToken=T\n');
  assert.equal(npmrcLine('https://reg.example.com/npm', 'T'), '//reg.example.com/npm/:_authToken=T\n');
});

test('rehearsal by default: runs npm publish --dry-run on the right registry and tag', async () => {
  const { exec, calls } = fakeExec();
  const r = await publishPackage({ ...base, cwd: pkgDir(), exec });
  assert.equal(r.dryRun, true);
  const pub = calls.find((c) => c.key === 'npm publish');
  assert.ok(pub.args.includes('--dry-run'));
  assert.deepEqual(pub.args.slice(pub.args.indexOf('--tag'), pub.args.indexOf('--tag') + 2), ['--tag', 'next']);
  assert.equal(pub.args[pub.args.indexOf('--registry') + 1], 'http://localhost:4873');
});

test('a real publish has no --dry-run; the registry may come from package.json', async () => {
  const { exec, calls } = fakeExec();
  const r = await publishPackage({ log: () => {}, cwd: pkgDir({ publishConfig: { registry: 'http://verdaccio.local:4873' } }), dryRun: false, tag: 'latest', exec });
  assert.equal(r.dryRun, false);
  assert.ok(!calls.find((c) => c.key === 'npm publish').args.includes('--dry-run'));
  assert.equal(r.registry, 'http://verdaccio.local:4873');
});

test('a token goes into a temporary npmrc that is removed afterwards, and is scrubbed from errors', async () => {
  const { exec, calls } = fakeExec({ 'npm publish': { code: 1, stderr: 'E401 bad token SECRET123' } });
  await assert.rejects(publishPackage({ ...base, cwd: pkgDir(), token: 'SECRET123', dryRun: false, exec }), (err) => {
    assert.ok(!err.message.includes('SECRET123'));
    return /E401/.test(err.message);
  });
  const withRc = calls.find((c) => c.key === 'npm publish');
  assert.equal(withRc.rc, '//localhost:4873/:_authToken=SECRET123\n');
  const rcPath = withRc.args[withRc.args.indexOf('--userconfig') + 1];
  assert.equal(fs.existsSync(rcPath), false);
});

test('refuses: wrong commit, dirty tree, private package, taken version, not signed in, odd tag, no registry', async () => {
  const dir = pkgDir();
  await assert.rejects(publishPackage({ ...base, cwd: dir, expectedSha: 'd'.repeat(40), exec: fakeExec().exec }), /approved commit/);
  await assert.rejects(publishPackage({ ...base, cwd: dir, exec: fakeExec({ 'git status': { code: 0, stdout: ' M a.js\n' } }).exec }), /uncommitted/);
  await publishPackage({ ...base, cwd: dir, allowDirty: true, exec: fakeExec({ 'git status': { code: 0, stdout: ' M a.js\n' } }).exec });
  await assert.rejects(publishPackage({ ...base, cwd: pkgDir({ private: true }), exec: fakeExec().exec }), /private/);
  await assert.rejects(publishPackage({ ...base, cwd: dir, exec: fakeExec({ 'npm view': { code: 0, stdout: '1.2.3\n' } }).exec }), /already exists/);
  await assert.rejects(publishPackage({ ...base, cwd: dir, exec: fakeExec({ 'npm whoami': { code: 1, stderr: 'E401' } }).exec }), /Not signed in/);
  await assert.rejects(publishPackage({ ...base, cwd: dir, tag: 'a b', exec: fakeExec().exec }), /tag may only/);
  await assert.rejects(publishPackage({ log: () => {}, cwd: dir, exec: fakeExec().exec }), /Say which registry/);
});

test('an approved commit given as a short sha still matches', async () => {
  const r = await publishPackage({ ...base, cwd: pkgDir(), expectedSha: SHA.slice(0, 9), exec: fakeExec().exec });
  assert.equal(r.sha, SHA);
});
