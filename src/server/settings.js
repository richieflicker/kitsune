// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaults, merge, validateUi } from '../config.js';

const FILE_NAMES = ['kitsune.server.json', 'kitsune.server.js', 'kitsune.server.mjs'];
const KNOWN = ['port', 'host', 'dataDir', 'imagesDir', 'diffsDir', 'archiveDir', 'publicUrl', 'trustProxy', 'sessionDays', 'publicProject', 'github', 'retention', 'ui'];

/**
 * Settings of the shared review server, from a file (kitsune.server.json / .js in the working folder, or
 * --server-config). Secrets never live here: tokens stay in environment variables.
 * Precedence for every setting: command-line flag > environment variable > this file > built-in default.
 */
export async function loadServerSettings({ file, cwd = process.cwd() } = {}) {
  let found = null;
  if (file) {
    found = path.resolve(cwd, file);
    if (!fs.existsSync(found)) throw new Error(`Server config file not found: ${file}`);
  } else {
    found = FILE_NAMES.map((n) => path.resolve(cwd, n)).find((p) => fs.existsSync(p)) ?? null;
  }

  let raw = {};
  if (found) {
    raw = found.endsWith('.json') ? JSON.parse(fs.readFileSync(found, 'utf8')) : (await import(pathToFileURL(found).href)).default;
  }
  const where = found ? path.basename(found) : 'server settings';
  const fail = (msg) => {
    throw new Error(`${where}: ${msg}`);
  };

  const unknown = Object.keys(raw).filter((k) => !KNOWN.includes(k));
  if (unknown.length) fail(`"${unknown[0]}" is not a known setting. Allowed: ${KNOWN.join(', ')}`);

  const baseDir = found ? path.dirname(found) : cwd;
  const dir = (v) => (v ? path.resolve(baseDir, v) : undefined);
  const int = (key, v, { min, max }) => {
    if (v == null) return undefined;
    if (!Number.isInteger(v) || v < min || v > max) fail(`${key} must be a whole number between ${min} and ${max} (got ${JSON.stringify(v)})`);
    return v;
  };

  const retention = raw.retention ?? null;
  if (retention) {
    const extra = Object.keys(retention).filter((k) => !['olderThanDays', 'mode', 'everyHours'].includes(k));
    if (extra.length) fail(`retention.${extra[0]} is not a known setting. Allowed: olderThanDays, mode, everyHours`);
    if (!(retention.olderThanDays > 0)) fail('retention.olderThanDays must be a positive number');
    if (retention.mode != null && !['archive', 'delete'].includes(retention.mode)) fail(`retention.mode must be 'archive' or 'delete'`);
    if (retention.everyHours != null && !(retention.everyHours >= 1 && retention.everyHours <= 720)) fail('retention.everyHours must be between 1 and 720');
    if ((retention.mode ?? 'archive') === 'archive' && !raw.archiveDir) fail(`retention.mode 'archive' needs archiveDir (or set mode to 'delete')`);
  }

  const ui = merge(defaults.ui, raw.ui ?? {});
  try {
    validateUi(ui);
  } catch (err) {
    fail(err.message.replace(/^kitsune\.config\.js: /, ''));
  }

  const github = raw.github ?? {};
  if (Object.keys(github).some((k) => k !== 'apiUrl')) fail('github only supports apiUrl (the token must be set in KITSUNE_GITHUB_TOKEN)');

  return {
    file: found,
    port: int('port', raw.port, { min: 0, max: 65535 }),
    host: raw.host,
    dataDir: dir(raw.dataDir),
    imagesDir: dir(raw.imagesDir),
    diffsDir: dir(raw.diffsDir),
    archiveDir: dir(raw.archiveDir),
    publicUrl: raw.publicUrl,
    publicProject: raw.publicProject,
    trustProxy: raw.trustProxy === true,
    sessionDays: int('sessionDays', raw.sessionDays, { min: 1, max: 90 }),
    githubApiUrl: github.apiUrl,
    retention: retention && { olderThanDays: retention.olderThanDays, mode: retention.mode ?? 'archive', everyHours: retention.everyHours ?? 24 },
    ui,
  };
}

/** Real environment variables win over values from the settings file. */
export function effectiveEnv(settings, env = process.env) {
  const fromFile = {
    KITSUNE_PUBLIC_URL: settings.publicUrl,
    KITSUNE_PUBLIC_PROJECT: settings.publicProject,
    KITSUNE_TRUST_PROXY: settings.trustProxy ? '1' : undefined,
    KITSUNE_GITHUB_API_URL: settings.githubApiUrl,
  };
  const out = { ...env };
  for (const [k, v] of Object.entries(fromFile)) if (v !== undefined && out[k] === undefined) out[k] = v;
  return out;
}
