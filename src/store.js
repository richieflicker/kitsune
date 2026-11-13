// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import path from 'node:path';

/** Turn story id + viewport + browser into a safe file stem. Each browser keeps its own baseline. */
export function storyKey(id, viewportName, browserName) {
  return `${id}__${viewportName}__${browserName}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * All state lives in plain files under cfg.dataDir:
 *   baselines/<key>.png   approved images (commit this folder to git)
 *   approved.json         key -> who/when/which build approved it
 *   current/manifest.json result of the latest `kitsune check`
 *   current/new|diff/     screenshots + diffs of the latest run
 */
export function createStore(cfg) {
  const root = cfg.dataDir;
  const paths = {
    root,
    baselines: path.join(root, 'baselines'),
    current: path.join(root, 'current'),
    newDir: path.join(root, 'current', 'new'),
    diffDir: path.join(root, 'current', 'diff'),
    manifest: path.join(root, 'current', 'manifest.json'),
    approved: path.join(root, 'approved.json'),
  };

  const readJson = (p, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const writeJson = (p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  };

  return {
    paths,
    baselineFile: (key) => path.join(paths.baselines, `${key}.png`),
    newFile: (key) => path.join(paths.newDir, `${key}.png`),
    diffFile: (key) => path.join(paths.diffDir, `${key}.png`),

    resetCurrent() {
      fs.rmSync(paths.current, { recursive: true, force: true });
      fs.mkdirSync(paths.newDir, { recursive: true });
      fs.mkdirSync(paths.diffDir, { recursive: true });
      fs.mkdirSync(paths.baselines, { recursive: true });
    },

    hasBaseline(key) {
      return fs.existsSync(path.join(paths.baselines, `${key}.png`));
    },

    readManifest: () => readJson(paths.manifest, null),
    writeManifest: (m) => writeJson(paths.manifest, m),
    readApproved: () => readJson(paths.approved, {}),
    writeApproved: (a) => writeJson(paths.approved, a),
  };
}

export function summarize(stories) {
  const s = { total: stories.length, new: 0, unchanged: 0, changed: 0, accepted: 0, rejected: 0, error: 0 };
  for (const st of stories) s[st.status] += 1;
  s.pending = s.changed + s.rejected + s.error;
  return s;
}
