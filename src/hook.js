// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const HOOK_MARKER = '# kitsune-review pre-push hook';

/** The hook is plain sh so it needs no dependency; Husky runs it the same way git does. */
export function hookScript({ warn = false, command = 'npx --no-install kitsune check' } = {}) {
  return `#!/bin/sh
${HOOK_MARKER} (installed by \`kitsune init-hook\`)
# Skip once:  KITSUNE_SKIP=1 git push    or    git push --no-verify
[ -n "$KITSUNE_SKIP" ] && exit 0

if ${command}; then
  exit 0
fi

echo ""
echo 'Kitsune: visual changes need review.'
echo 'Run "npx kitsune serve", approve the changes, then push again.'
${warn ? 'echo "(warn mode: pushing anyway)"\nexit 0' : 'exit 1'}
`;
}

function usesHusky(cwd) {
  if (fs.existsSync(path.join(cwd, '.husky'))) return true;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return Boolean(pkg.dependencies?.husky || pkg.devDependencies?.husky);
  } catch {
    return false;
  }
}

/** Where the hook goes: .husky/pre-push when the project uses Husky, otherwise git's own hooks folder. */
export function findHookFile(cwd) {
  if (usesHusky(cwd)) return { file: path.join(cwd, '.husky', 'pre-push'), via: 'husky' };
  let hooksDir;
  try {
    hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null; // not a git repository
  }
  return { file: path.resolve(cwd, hooksDir, 'pre-push'), via: 'git' };
}

/**
 * Install, update or remove the pre-push hook. Never overwrites a hook Kitsune did not write unless `force` is set.
 * Returns { status, file, via }: installed | updated | foreign | removed | absent | not-a-git-repo.
 */
export function installHook(cwd, { warn = false, command, force = false, remove = false } = {}) {
  const target = findHookFile(cwd);
  if (!target) return { status: 'not-a-git-repo' };
  const { file, via } = target;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const ours = existing?.includes(HOOK_MARKER);

  if (remove) {
    if (existing === null) return { status: 'absent', file, via };
    if (!ours && !force) return { status: 'foreign', file, via };
    fs.rmSync(file);
    return { status: 'removed', file, via };
  }

  if (existing !== null && !ours && !force) return { status: 'foreign', file, via };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, hookScript({ warn, command }), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { status: existing === null ? 'installed' : 'updated', file, via };
}
