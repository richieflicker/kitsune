import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRemoteUrl, pullRequestLink } from '../src/pr-link.js';

const link = (remote, source = 'feature/x', target = 'main', opts) => pullRequestLink(remote, source, target, opts);

test('parseRemoteUrl: https, ssh:// and scp-style addresses', () => {
  assert.deepEqual(parseRemoteUrl('git@bitbucket.org:acme/ds.git'), { host: 'bitbucket.org', segments: ['acme', 'ds'], origin: 'https://bitbucket.org', viaHttp: false });
  assert.equal(parseRemoteUrl('ssh://git@bitbucket.acme.com:7999/DS/ds.git').origin, 'https://bitbucket.acme.com'); // ssh port is not the web port
  assert.equal(parseRemoteUrl('https://git.acme.com:8443/scm/DS/ds.git').origin, 'https://git.acme.com:8443');
  assert.equal(parseRemoteUrl('not a url at all'), null);
});

test('Bitbucket Cloud', () => {
  const expected = 'https://bitbucket.org/acme/ds/pull-requests/new?source=feature%2Fx&dest=main';
  assert.equal(link('git@bitbucket.org:acme/ds.git').url, expected);
  assert.equal(link('https://priya@bitbucket.org/acme/ds.git').url, expected);
  assert.equal(link('https://bitbucket.org/acme/ds').provider, 'Bitbucket');
});

test('Bitbucket Server / Data Center', () => {
  const expected = 'https://git.acme.com/projects/DS/repos/ds/pull-requests?create&sourceBranch=refs%2Fheads%2Ffeature%2Fx&targetBranch=refs%2Fheads%2Fmain';
  assert.equal(link('https://git.acme.com/scm/DS/ds.git').url, expected);
  assert.equal(link('https://git.acme.com/scm/DS/ds.git').provider, 'Bitbucket Server');
  assert.equal(link('https://git.acme.com/bitbucket/scm/DS/ds.git').url, expected.replace('git.acme.com/', 'git.acme.com/bitbucket/'));
  assert.equal(link('ssh://git@bitbucket.acme.com:7999/DS/ds.git').url, expected.replace('git.acme.com', 'bitbucket.acme.com'));
  assert.match(link('https://git.acme.com/scm/~priya/ds.git').url, /\/users\/priya\/repos\/ds\//);
});

test('GitHub and GitLab', () => {
  assert.equal(link('https://github.com/richieflicker/kitsune').url, 'https://github.com/richieflicker/kitsune/compare/main...feature/x?expand=1');
  assert.equal(
    link('git@gitlab.com:acme/group/ds.git').url,
    'https://gitlab.com/acme/group/ds/-/merge_requests/new?merge_request[source_branch]=feature%2Fx&merge_request[target_branch]=main',
  );
});

test('template override, and a clear error for unknown hosts', () => {
  assert.equal(link('https://git.example.com/a/b.git', 'f/x', 'dev', { template: 'https://h/new?from={source}&to={target}' }).url, 'https://h/new?from=f%2Fx&to=dev');
  assert.throws(() => link('https://git.example.com/a/b.git'), (e) => e.status === 400 && /branches\.prUrl/.test(e.message));
  assert.throws(() => link('???'), /Could not read the remote address/);
});
