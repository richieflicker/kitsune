// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Builds the "create pull request" page address for a branch, with source and target already filled in.
// Kitsune never creates the pull request itself here: you review the page and press Create.

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Split a git remote URL (https, ssh:// or scp-style) into host, path segments and a web origin. */
export function parseRemoteUrl(remoteUrl) {
  const url = String(remoteUrl ?? '').trim();
  let match;
  let host;
  let pathname;
  let origin = null;

  if ((match = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url)) && !/^[a-z]+:\/\//i.test(url)) {
    // scp-style: git@host:owner/repo.git
    [, host, pathname] = match;
  } else {
    try {
      const u = new URL(url);
      host = u.hostname;
      pathname = u.pathname;
      // Only an http(s) address carries the web port. An ssh port (7999 on Bitbucket Server) is not the web port.
      if (u.protocol === 'http:' || u.protocol === 'https:') origin = `${u.protocol}//${u.host}`;
    } catch {
      return null;
    }
  }
  const segments = pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  return { host: host.toLowerCase(), segments, origin: origin ?? `https://${host}`, viaHttp: Boolean(origin) };
}

const enc = encodeURIComponent;
const encPath = (name) => name.split('/').map(enc).join('/');

/**
 * Where to open a pull request from `source` into `target` (plain branch names, no remote prefix).
 * `template` overrides detection: any {source}, {target} in it are replaced (percent-encoded).
 */
export function pullRequestLink(remoteUrl, source, target, { template } = {}) {
  if (template) {
    return { provider: 'custom', url: template.replaceAll('{source}', enc(source)).replaceAll('{target}', enc(target)) };
  }
  const r = parseRemoteUrl(remoteUrl);
  if (!r) throw httpError(400, `Could not read the remote address: ${remoteUrl}`);
  const { host, segments, origin } = r;

  if (host === 'bitbucket.org' && segments.length >= 2) {
    const [ws, repo] = segments;
    return { provider: 'Bitbucket', url: `https://bitbucket.org/${ws}/${repo}/pull-requests/new?source=${enc(source)}&dest=${enc(target)}` };
  }

  if (host === 'github.com' && segments.length >= 2) {
    const [owner, repo] = segments;
    return { provider: 'GitHub', url: `https://github.com/${owner}/${repo}/compare/${encPath(target)}...${encPath(source)}?expand=1` };
  }

  if (host.includes('gitlab') && segments.length >= 2) {
    const project = segments.map(enc).join('/');
    return { provider: 'GitLab', url: `${origin}/${project}/-/merge_requests/new?merge_request[source_branch]=${enc(source)}&merge_request[target_branch]=${enc(target)}` };
  }

  if (host.includes('bitbucket') || segments.includes('scm')) {
    // Bitbucket Server / Data Center: https://host[/context]/scm/PROJ/repo.git  or  ssh://git@host:7999/PROJ/repo.git
    const scm = segments.indexOf('scm');
    const tail = scm >= 0 ? segments.slice(scm + 1) : segments.slice(-2);
    const context = scm > 0 ? `/${segments.slice(0, scm).join('/')}` : '';
    if (tail.length >= 2) {
      const [project, repo] = tail;
      const area = project.startsWith('~') ? `users/${enc(project.slice(1))}` : `projects/${enc(project)}`;
      const refs = (b) => enc(`refs/heads/${b}`);
      return { provider: 'Bitbucket Server', url: `${origin}${context}/${area}/repos/${enc(repo)}/pull-requests?create&sourceBranch=${refs(source)}&targetBranch=${refs(target)}` };
    }
  }

  throw httpError(400, `Kitsune doesn't know how to open a pull request on ${host}. Set branches.prUrl in the config, e.g. 'https://git.example.com/org/repo/pulls/new?from={source}&to={target}'.`);
}
