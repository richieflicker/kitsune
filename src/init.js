// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';

/** Scripts `kitsune init` adds to the project's package.json. */
export const PROJECT_SCRIPTS = {
  'kitsune:check': 'kitsune check',
  'kitsune:serve': 'kitsune serve',
  'kitsune:browsers': 'kitsune browsers',
};

/**
 * Add the Kitsune scripts to a package.json without touching anything else.
 * Existing scripts with the same name are left as they are. Returns what happened.
 */
export function addProjectScripts(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) return { status: 'no-package-json', added: [], kept: [] };
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { status: 'unreadable', added: [], kept: [] };
  }
  pkg.scripts ??= {};
  const added = [];
  const kept = [];
  for (const [name, cmd] of Object.entries(PROJECT_SCRIPTS)) {
    if (pkg.scripts[name] === undefined) {
      pkg.scripts[name] = cmd;
      added.push(name);
    } else if (pkg.scripts[name] !== cmd) {
      kept.push(name);
    }
  }
  if (added.length) {
    // Keep the file's own indentation and trailing newline.
    const indent = /^\{\n( +|\t)/.exec(raw)?.[1] ?? '  ';
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, indent)}${raw.endsWith('\n') ? '\n' : ''}`);
  }
  return { status: 'ok', added, kept };
}

const MAIN_FILES = ['main.js', 'main.mjs', 'main.cjs', 'main.ts', 'main.mts'];
export const ADDON_SNIPPET = "{ name: 'kitsune-review', options: { url: 'http://127.0.0.1:4455' } }";

/**
 * Add the Kitsune addon to .storybook/main.* when there is exactly one plain `addons: [ ... ]` array.
 * Anything else (computed lists, several matches, already present) is left alone and reported.
 */
export function addStorybookAddon(dir) {
  const name = MAIN_FILES.find((f) => fs.existsSync(`${dir}/.storybook/${f}`));
  if (!name) return { status: 'no-config' };
  const file = `${dir}/.storybook/${name}`;
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('kitsune-review')) return { status: 'present', file: name };
  const matches = [...src.matchAll(/(["']?)addons\1\s*:\s*\[/g)];
  if (matches.length !== 1) return { status: 'manual', file: name };
  const m = matches[0];
  const at = m.index + m[0].length;
  // Match the indentation of the line the array starts on, plus two spaces.
  const lineStart = src.lastIndexOf('\n', m.index) + 1;
  const indent = `${/^[ \t]*/.exec(src.slice(lineStart))[0]}  `;
  const rest = src.slice(at);
  const empty = /^\s*\]/.test(rest);
  const insert = empty ? `\n${indent}${ADDON_SNIPPET},\n${indent.slice(2)}` : `\n${indent}${ADDON_SNIPPET},`;
  fs.writeFileSync(file, src.slice(0, at) + insert + (empty ? rest.replace(/^\s*/, '') : rest));
  return { status: 'added', file: name };
}
