// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// The ONLY file that touches SQL. To move to Postgres/Mongo, re-implement this object's methods.
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL DEFAULT 'main',
  github_repo TEXT,
  upload_token_hash TEXT NOT NULL UNIQUE,
  review_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  branch TEXT NOT NULL,
  commit_sha TEXT,
  browsers TEXT NOT NULL,
  expected INTEGER NOT NULL,
  threshold REAL NOT NULL,
  max_diff_pixels INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading',
  failure TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT
);
CREATE INDEX IF NOT EXISTS builds_by_project ON builds(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS builds_by_commit ON builds(project_id, commit_sha, created_at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  build_id TEXT NOT NULL REFERENCES builds(id),
  key TEXT NOT NULL,
  story_id TEXT NOT NULL,
  title TEXT,
  name TEXT,
  viewport TEXT NOT NULL,
  browser TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  image_hash TEXT,
  baseline_hash TEXT,
  diff_pixels INTEGER NOT NULL DEFAULT 0,
  diff_ratio REAL NOT NULL DEFAULT 0,
  size_changed INTEGER NOT NULL DEFAULT 0,
  has_diff INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  note TEXT,
  PRIMARY KEY (build_id, key)
);

-- Append-only history of what was approved where. The newest row for (project, key, branch) is that
-- branch's baseline; branches without one fall back to the default branch.
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  key TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,
  build_id TEXT
);
CREATE INDEX IF NOT EXISTS approvals_lookup ON approvals(project_id, key, branch, id DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`;

export async function openDb(dataDir) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`The server needs Node 22.13 or newer (found ${process.versions.node}).`);
  }

  // node:sqlite is still flagged experimental and prints a warning on load; keep the server log clean.
  const original = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    if (type === 'ExperimentalWarning') return;
    return original.call(process, warning, ...args);
  };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } finally {
    process.emitWarning = original;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'kitsune.db'));
  db.exec(SCHEMA);
  // Small forward-only migrations for databases created by an older version.
  const columns = db.prepare(`PRAGMA table_info(snapshots)`).all().map((c) => c.name);
  if (!columns.includes('rules')) db.exec(`ALTER TABLE snapshots ADD COLUMN rules TEXT`);

  const p = (sql) => db.prepare(sql);
  const q = {
    insertProject: p(`INSERT INTO projects (id,name,default_branch,github_repo,upload_token_hash,review_token_hash,created_at) VALUES (?,?,?,?,?,?,?)`),
    projectById: p(`SELECT * FROM projects WHERE id = ?`),
    projectByName: p(`SELECT * FROM projects WHERE name = ?`),
    projectByUploadHash: p(`SELECT * FROM projects WHERE upload_token_hash = ?`),
    projectByReviewHash: p(`SELECT * FROM projects WHERE review_token_hash = ?`),
    setTokens: p(`UPDATE projects SET upload_token_hash = ?, review_token_hash = ? WHERE id = ?`),
    deleteProjectSessions: p(`DELETE FROM sessions WHERE project_id = ?`),

    insertBuild: p(`INSERT INTO builds (id,project_id,branch,commit_sha,browsers,expected,threshold,max_diff_pixels,status,created_at) VALUES (?,?,?,?,?,?,?,?, 'uploading', ?)`),
    buildById: p(`SELECT * FROM builds WHERE id = ?`),
    claimFinalize: p(`UPDATE builds SET status = 'finalizing' WHERE id = ? AND status = 'uploading'`),
    setBuildStatus: p(`UPDATE builds SET status = ?, failure = ?, finalized_at = ? WHERE id = ?`),
    listBuilds: p(`SELECT * FROM builds WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`),
    listBuildsByBranch: p(`SELECT * FROM builds WHERE project_id = ? AND branch = ? ORDER BY created_at DESC, id DESC LIMIT ?`),
    latestBuildForCommit: p(`SELECT * FROM builds WHERE project_id = ? AND commit_sha = ? ORDER BY created_at DESC, id DESC LIMIT 1`),

    upsertSnapshot: p(`INSERT INTO snapshots (build_id,key,story_id,title,name,viewport,browser,status,image_hash,error,rules)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(build_id,key) DO UPDATE SET story_id=excluded.story_id, title=excluded.title, name=excluded.name,
        viewport=excluded.viewport, browser=excluded.browser, status=excluded.status, image_hash=excluded.image_hash, error=excluded.error,
        rules=excluded.rules`),
    snapshots: p(`SELECT * FROM snapshots WHERE build_id = ? ORDER BY key`),
    snapshot: p(`SELECT * FROM snapshots WHERE build_id = ? AND key = ?`),
    snapshotCount: p(`SELECT COUNT(*) AS n FROM snapshots WHERE build_id = ?`),
    statusCounts: p(`SELECT status, COUNT(*) AS n FROM snapshots WHERE build_id = ? GROUP BY status`),
    setResult: p(`UPDATE snapshots SET status=?, baseline_hash=?, diff_pixels=?, diff_ratio=?, size_changed=?, has_diff=?, note=?, error=? WHERE build_id=? AND key=?`),
    setStatus: p(`UPDATE snapshots SET status = ?, note = ? WHERE build_id = ? AND key = ?`),
    projectOwnsImage: p(`SELECT 1 AS ok FROM snapshots s JOIN builds b ON b.id = s.build_id
      WHERE b.project_id = ? AND (s.image_hash = ? OR s.baseline_hash = ?) LIMIT 1`),

    insertApproval: p(`INSERT INTO approvals (project_id,branch,key,image_hash,approved_by,approved_at,auto,build_id) VALUES (?,?,?,?,?,?,?,?)`),
    latestApproval: p(`SELECT * FROM approvals WHERE project_id = ? AND key = ? AND branch = ? ORDER BY id DESC LIMIT 1`),
    approvalForHash: p(`SELECT * FROM approvals WHERE project_id = ? AND key = ? AND image_hash = ? ORDER BY id DESC LIMIT 1`),

    oldBuilds: p(`SELECT id FROM builds WHERE created_at < ? AND status IN ('ready','failed')`),
    hashesOfBuild: p(`SELECT image_hash AS h FROM snapshots WHERE build_id = ? AND image_hash IS NOT NULL
      UNION SELECT baseline_hash FROM snapshots WHERE build_id = ? AND baseline_hash IS NOT NULL`),
    hashesInUse: p(`SELECT s.image_hash AS h FROM snapshots s JOIN builds b ON b.id = s.build_id
        WHERE s.image_hash IS NOT NULL AND (b.created_at >= ? OR b.status NOT IN ('ready','failed'))
      UNION SELECT s.baseline_hash FROM snapshots s JOIN builds b ON b.id = s.build_id
        WHERE s.baseline_hash IS NOT NULL AND (b.created_at >= ? OR b.status NOT IN ('ready','failed'))
      UNION SELECT image_hash FROM approvals a WHERE id = (
        SELECT MAX(id) FROM approvals WHERE project_id = a.project_id AND key = a.key AND branch = a.branch)`),

    insertSession: p(`INSERT INTO sessions (id_hash,project_id,name,created_at,expires_at) VALUES (?,?,?,?,?)`),
    session: p(`SELECT * FROM sessions WHERE id_hash = ?`),
    deleteSession: p(`DELETE FROM sessions WHERE id_hash = ?`),
    purgeSessions: p(`DELETE FROM sessions WHERE expires_at < ?`),
  };

  return {
    close: () => db.close(),
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    insertProject: (r) => q.insertProject.run(r.id, r.name, r.defaultBranch, r.githubRepo, r.uploadHash, r.reviewHash, r.createdAt),
    projectById: (id) => q.projectById.get(id),
    projectByName: (name) => q.projectByName.get(name),
    projectByUploadHash: (h) => q.projectByUploadHash.get(h),
    projectByReviewHash: (h) => q.projectByReviewHash.get(h),
    setTokens(id, uploadHash, reviewHash) {
      q.setTokens.run(uploadHash, reviewHash, id);
      q.deleteProjectSessions.run(id); // old review sessions die with the old review token
    },

    insertBuild: (b) => q.insertBuild.run(b.id, b.projectId, b.branch, b.commit, JSON.stringify(b.browsers), b.expected, b.threshold, b.maxDiffPixels, b.createdAt),
    buildById: (id) => q.buildById.get(id),
    claimFinalize: (id) => q.claimFinalize.run(id).changes === 1,
    setBuildStatus: (id, status, failure, finalizedAt) => q.setBuildStatus.run(status, failure ?? null, finalizedAt ?? null, id),
    listBuilds: (projectId, { branch, limit }) =>
      branch ? q.listBuildsByBranch.all(projectId, branch, limit) : q.listBuilds.all(projectId, limit),
    latestBuildForCommit: (projectId, sha) => q.latestBuildForCommit.get(projectId, sha),

    upsertSnapshot: (s) => q.upsertSnapshot.run(s.buildId, s.key, s.storyId, s.title ?? null, s.name ?? null, s.viewport, s.browser, s.status, s.imageHash ?? null, s.error ?? null, s.rules ? JSON.stringify(s.rules) : null),
    snapshots: (buildId) => q.snapshots.all(buildId),
    snapshot: (buildId, key) => q.snapshot.get(buildId, key),
    snapshotCount: (buildId) => q.snapshotCount.get(buildId).n,
    statusCounts: (buildId) => q.statusCounts.all(buildId),
    setResult: (buildId, key, r) =>
      q.setResult.run(r.status, r.baselineHash ?? null, r.diffPixels ?? 0, r.diffRatio ?? 0, r.sizeChanged ? 1 : 0, r.hasDiff ? 1 : 0, r.note ?? null, r.error ?? null, buildId, key),
    setStatus: (buildId, key, status, note) => q.setStatus.run(status, note ?? null, buildId, key),
    projectOwnsImage: (projectId, hash) => Boolean(q.projectOwnsImage.get(projectId, hash, hash)),

    insertApproval: (a) => q.insertApproval.run(a.projectId, a.branch, a.key, a.imageHash, a.approvedBy, a.approvedAt, a.auto ? 1 : 0, a.buildId ?? null),
    latestApproval: (projectId, key, branch) => q.latestApproval.get(projectId, key, branch),
    approvalForHash: (projectId, key, hash) => q.approvalForHash.get(projectId, key, hash),

    // retention: what can be retired, and what must stay
    oldBuildIds: (cutoffIso) => q.oldBuilds.all(cutoffIso).map((r) => r.id),
    hashesOfBuild: (buildId) => q.hashesOfBuild.all(buildId, buildId).map((r) => r.h),
    hashesInUse: (cutoffIso) => new Set(q.hashesInUse.all(cutoffIso, cutoffIso).map((r) => r.h)),

    insertSession: (s) => q.insertSession.run(s.idHash, s.projectId, s.name, s.createdAt, s.expiresAt),
    session: (idHash) => q.session.get(idHash),
    deleteSession: (idHash) => q.deleteSession.run(idHash),
    purgeSessions: (nowIso) => q.purgeSessions.run(nowIso),
  };
}
