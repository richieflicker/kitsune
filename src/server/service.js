// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { comparePngs } from '../compare.js';
import { describeManifest, postStatusSafely } from '../github.js';
import { reviewTransition } from '../review-rules.js';
import { exceedsAllowance } from '../rules.js';
import { summarize } from '../store.js';
import { createFsStorage } from './storage.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const KEY_RE = /^[A-Za-z0-9_.-]{1,200}$/;
export const HASH_RE = /^[a-f0-9]{64}$/;
export const BUILD_ID_RE = /^b_[0-9]{14}-[a-f0-9]{6}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KNOWN_STATUSES = ['new', 'unchanged', 'changed', 'accepted', 'rejected', 'error'];
const SESSION_DAYS = 7;

/** Per-story comparison rules sent by the client; anything missing falls back to the build's settings. */
function cleanRules(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'rules must be an object');
  const num = (key, { max = Infinity, int = false, nullable = false } = {}) => {
    const v = input[key];
    if (v == null) {
      if (nullable || v === undefined) return null;
    }
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > max || (int && !Number.isInteger(v))) {
      throw new HttpError(400, `rules.${key} must be ${int ? 'an integer' : 'a number'} between 0 and ${max === Infinity ? 'infinity' : max}`);
    }
    return v;
  };
  return {
    threshold: num('threshold', { max: 1 }),
    maxDiffPixels: num('maxDiffPixels', { int: true }),
    maxDiffRatio: num('maxDiffRatio', { max: 1, nullable: true }),
    includeAA: input.includeAA === true,
    allowSizeChange: input.allowSizeChange === true,
  };
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const newToken = (prefix) => `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
const cleanText = (v, max, label) => {
  const s = String(v ?? '').trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > max || /[\u0000-\u001f]/.test(s)) throw new HttpError(400, `${label} must be 1-${max} characters, no control characters`);
  return s;
};

export function createService({ db, dataDir, storage = createFsStorage({ dataDir }), env = process.env, sessionDays = SESSION_DAYS }) {
  const publicUrl = (env.KITSUNE_PUBLIC_URL || '').replace(/\/$/, '');
  const { imagePath, diffPath } = storage;

  // ---- GitHub status (posted by the server, so approving in the dashboard updates the PR live) ----
  async function notify(project, build, state, description) {
    const token = env.KITSUNE_GITHUB_TOKEN;
    if (!project.github_repo || !build.commit_sha || !token) return;
    // Several builds can exist for one commit; only the newest one speaks for it.
    const latest = db.latestBuildForCommit(project.id, build.commit_sha);
    if (latest && latest.id !== build.id) return;
    await postStatusSafely(
      {
        token,
        repo: project.github_repo,
        sha: build.commit_sha,
        apiUrl: (env.KITSUNE_GITHUB_API_URL || env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
        reviewUrl: publicUrl ? `${publicUrl}/#/builds/${build.id}` : null,
      },
      { state, description },
    );
  }

  function toManifest(project, build) {
    const rows = db.snapshots(build.id);
    const stories = rows.map((r) => ({
      key: r.key,
      id: r.story_id,
      title: r.title,
      name: r.name,
      viewport: r.viewport,
      browser: r.browser,
      status: r.status,
      diffPixels: r.diff_pixels,
      diffRatio: r.diff_ratio,
      sizeChanged: Boolean(r.size_changed),
      error: r.error ?? undefined,
      note: r.note ?? undefined,
      newImage: r.image_hash ? `/api/v1/images/${r.image_hash}.png` : undefined,
      baselineImage: r.baseline_hash ? `/api/v1/images/${r.baseline_hash}.png` : undefined,
      diffImage: r.has_diff ? `/api/v1/diffs/${build.id}/${r.key}.png` : undefined,
    }));
    return {
      buildId: build.id,
      project: project.name,
      branch: build.branch,
      commit: build.commit_sha,
      createdAt: build.created_at,
      finalizedAt: build.finalized_at,
      status: build.status,
      failure: build.failure ?? undefined,
      expected: build.expected,
      browsers: JSON.parse(build.browsers),
      summary: summarize(stories.filter((s) => KNOWN_STATUSES.includes(s.status))),
      stories,
    };
  }

  const ownedBuild = (project, id) => {
    const build = BUILD_ID_RE.test(id) ? db.buildById(id) : null;
    if (!build || build.project_id !== project.id) throw new HttpError(404, 'Build not found');
    return build;
  };

  return {
    storage,

    // ---------- projects & auth ----------
    createProject({ name, defaultBranch = 'main', githubRepo = null }) {
      name = cleanText(name, 60, 'Project name');
      if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) throw new HttpError(400, 'GitHub repo must look like owner/repo');
      if (db.projectByName(name)) throw new HttpError(409, `Project "${name}" already exists`);
      const uploadToken = newToken('kitsune_up');
      const reviewToken = newToken('kitsune_rv');
      const id = `p_${crypto.randomBytes(6).toString('hex')}`;
      db.insertProject({
        id,
        name,
        defaultBranch: cleanText(defaultBranch, 200, 'Default branch'),
        githubRepo,
        uploadHash: sha256(uploadToken),
        reviewHash: sha256(reviewToken),
        createdAt: new Date().toISOString(),
      });
      return { project: db.projectById(id), uploadToken, reviewToken };
    },

    rotateTokens(name) {
      const project = db.projectByName(name);
      if (!project) throw new HttpError(404, `No project named "${name}"`);
      const uploadToken = newToken('kitsune_up');
      const reviewToken = newToken('kitsune_rv');
      db.setTokens(project.id, sha256(uploadToken), sha256(reviewToken));
      return { project, uploadToken, reviewToken };
    },

    authUpload(token) {
      return token ? db.projectByUploadHash(sha256(token)) ?? null : null;
    },

    /** The project to act on: the named one, or the only one when there is exactly one. */
    projectNameOrOnly(name) {
      if (name) return name;
      const all = db.allProjects();
      if (all.length === 1) return all[0].name;
      if (!all.length) throw new HttpError(404, 'No project yet. Create one with: kitsune server create-project <name>');
      throw new HttpError(400, `Several projects exist (${all.map((p) => p.name).join(', ')}). Pick one with --project <name>.`);
    },

    // ---------- per-person review tokens ----------
    addReviewer(projectName, personName) {
      const project = db.projectByName(projectName);
      if (!project) throw new HttpError(404, `No project named "${projectName}"`);
      const name = cleanText(personName, 60, 'Name');
      if (db.reviewerByName(project.id, name)) throw new HttpError(409, `"${name}" already has an active token. Revoke it first to issue a new one.`);
      const token = newToken('kitsune_rv');
      db.insertReviewer({ id: `r_${crypto.randomBytes(6).toString('hex')}`, projectId: project.id, name, tokenHash: sha256(token), createdAt: new Date().toISOString() });
      return { project, name, token };
    },

    listReviewers(projectName) {
      const project = db.projectByName(projectName);
      if (!project) throw new HttpError(404, `No project named "${projectName}"`);
      return db.listReviewers(project.id);
    },

    revokeReviewer(projectName, personName) {
      const project = db.projectByName(projectName);
      if (!project) throw new HttpError(404, `No project named "${projectName}"`);
      const row = db.reviewerByName(project.id, personName);
      if (!row) throw new HttpError(404, `No active token for "${personName}"`);
      db.revokeReviewer(row.id, new Date().toISOString());
      return { project, name: row.name };
    },

    /** Turn the shared review token off so only personal tokens can sign in. */
    disableSharedReview(projectName) {
      const project = db.projectByName(projectName);
      if (!project) throw new HttpError(404, `No project named "${projectName}"`);
      db.disableSharedReview(project.id, sha256(newToken('kitsune_off')));
      return { project };
    },

    login(token, name) {
      const hash = token ? sha256(String(token)) : null;
      const person = hash ? db.reviewerByHash(hash) : null;
      const project = person ? db.projectById(person.project_id) : hash ? db.projectByReviewHash(hash) : null;
      if (!project) throw new HttpError(401, 'Invalid token');
      // A personal token carries its own name, so nobody can approve under someone else's. The shared token
      // still asks for a name, because it cannot tell its holders apart.
      name = person ? person.name : cleanText(name, 60, 'Name');
      db.purgeSessions(new Date().toISOString());
      const sessionId = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      db.insertSession({
        idHash: sha256(sessionId),
        projectId: project.id,
        name,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + sessionDays * 864e5).toISOString(),
        reviewerId: person?.id ?? null,
      });
      return { sessionId, maxAgeSeconds: sessionDays * 86400, project, name };
    },

    authSession(sessionId) {
      if (!sessionId) return null;
      const row = db.session(sha256(sessionId));
      if (!row || row.expires_at < new Date().toISOString()) return null;
      if (row.reviewer_id && db.reviewerById(row.reviewer_id)?.revoked_at) return null;
      const project = db.projectById(row.project_id);
      return project ? { project, name: row.name } : null;
    },

    logout: (sessionId) => sessionId && db.deleteSession(sha256(sessionId)),

    // ---------- builds ----------
    async createBuild(project, input) {
      const branch = cleanText(input.branch, 200, 'branch');
      const commit = input.commit ? String(input.commit) : null;
      if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) throw new HttpError(400, 'commit must be a 7-40 character hex SHA');
      const browsers = Array.isArray(input.browsers) && input.browsers.length ? input.browsers.map((b) => cleanText(b, 60, 'browser')) : ['chromium'];
      const expected = Number(input.expected);
      if (!Number.isInteger(expected) || expected < 1 || expected > 100000) throw new HttpError(400, 'expected must be an integer between 1 and 100000');
      const threshold = input.threshold == null ? 0.05 : Number(input.threshold);
      if (!(threshold >= 0 && threshold <= 1)) throw new HttpError(400, 'threshold must be between 0 and 1');
      const maxDiffPixels = input.maxDiffPixels == null ? 0 : Number(input.maxDiffPixels);
      if (!Number.isInteger(maxDiffPixels) || maxDiffPixels < 0) throw new HttpError(400, 'maxDiffPixels must be a non-negative integer');

      const now = new Date();
      const id = `b_${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
      db.insertBuild({ id, projectId: project.id, branch, commit, browsers, expected, threshold, maxDiffPixels, createdAt: now.toISOString() });
      const build = db.buildById(id);
      await notify(project, build, 'pending', 'Capturing snapshots...');
      return { id, url: publicUrl ? `${publicUrl}/#/builds/${id}` : null };
    },

    putSnapshot(project, buildId, key, meta, buffer) {
      const build = ownedBuild(project, buildId);
      if (build.status !== 'uploading') throw new HttpError(409, `Build is ${build.status}; uploads are closed`);
      if (!KEY_RE.test(key)) throw new HttpError(400, 'Invalid snapshot key');
      if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, 'Body is not a PNG image');
      const hash = sha256(buffer);
      if (!storage.hasImage(hash)) storage.putImage(hash, buffer);
      db.upsertSnapshot({
        buildId,
        key,
        storyId: cleanText(meta.storyId, 300, 'storyId'),
        title: meta.title,
        name: meta.name,
        viewport: cleanText(meta.viewport, 60, 'viewport'),
        browser: cleanText(meta.browser, 60, 'browser'),
        status: 'uploaded',
        imageHash: hash,
        rules: cleanRules(meta.rules),
      });
      return { hash };
    },

    putSnapshotError(project, buildId, key, meta, message) {
      const build = ownedBuild(project, buildId);
      if (build.status !== 'uploading') throw new HttpError(409, `Build is ${build.status}; uploads are closed`);
      if (!KEY_RE.test(key)) throw new HttpError(400, 'Invalid snapshot key');
      db.upsertSnapshot({
        buildId,
        key,
        storyId: cleanText(meta.storyId, 300, 'storyId'),
        title: meta.title,
        name: meta.name,
        viewport: cleanText(meta.viewport, 60, 'viewport'),
        browser: cleanText(meta.browser, 60, 'browser'),
        status: 'error',
        error: String(message ?? 'Story failed to render').slice(0, 500),
      });
      return { ok: true };
    },

    /** Compare every uploaded snapshot against its branch baseline and decide the build's fate. */
    async finalize(project, buildId) {
      const build = ownedBuild(project, buildId);
      if (build.status === 'ready') return toManifest(project, build); // idempotent retry
      const received = db.snapshotCount(buildId);
      if (build.status !== 'uploading') throw new HttpError(409, `Build is ${build.status}`);
      if (received !== build.expected) {
        throw new HttpError(400, `Expected ${build.expected} snapshots but received ${received}. Upload is incomplete; nothing was finalized.`);
      }
      if (!db.claimFinalize(buildId)) throw new HttpError(409, 'Build is already being finalized');

      try {
        const now = new Date().toISOString();
        for (const snap of db.snapshots(buildId)) {
          if (snap.status === 'error') continue;
          const result = this._decide(project, build, snap);
          db.setResult(buildId, snap.key, result.row);
          for (const approval of result.approvals) db.insertApproval({ ...approval, projectId: project.id, buildId, approvedAt: now });
        }
        db.setBuildStatus(buildId, 'ready', null, new Date().toISOString());
      } catch (err) {
        db.setBuildStatus(buildId, 'failed', `Finalize failed: ${err.message}`, new Date().toISOString());
        throw new HttpError(500, 'Finalize failed');
      }

      const done = db.buildById(buildId);
      const manifest = toManifest(project, done);
      await notify(project, done, manifest.summary.pending > 0 ? 'failure' : 'success', describeManifest(manifest));
      return manifest;
    },

    /** Pure decision for one snapshot: its new status plus any approvals to record. */
    _decide(project, build, snap) {
      const key = snap.key;
      const branchBaseline = db.latestApproval(project.id, key, build.branch);
      const baseline = branchBaseline ?? (build.branch !== project.default_branch ? db.latestApproval(project.id, key, project.default_branch) : null);

      if (!baseline) {
        return {
          row: { status: 'new', note: 'First capture of this snapshot: approved automatically as the baseline.' },
          approvals: [{ branch: build.branch, key, imageHash: snap.image_hash, approvedBy: 'auto (first capture)', auto: true }],
        };
      }

      if (baseline.image_hash === snap.image_hash) {
        return { row: { status: 'unchanged', baselineHash: baseline.image_hash }, approvals: [] };
      }

      const diffFile = diffPath(build.id, key);
      fs.mkdirSync(path.dirname(diffFile), { recursive: true });
      const own = snap.rules ? JSON.parse(snap.rules) : {};
      const rules = {
        threshold: own.threshold ?? build.threshold,
        maxDiffPixels: own.maxDiffPixels ?? build.max_diff_pixels,
        maxDiffRatio: own.maxDiffRatio ?? null,
        includeAA: own.includeAA ?? false,
        allowSizeChange: own.allowSizeChange ?? false,
      };
      let res;
      try {
        res = comparePngs(imagePath(baseline.image_hash), imagePath(snap.image_hash), diffFile, rules);
      } catch (err) {
        return { row: { status: 'error', baselineHash: baseline.image_hash, error: `Could not compare images: ${err.message}` }, approvals: [] };
      }

      const base = { baselineHash: baseline.image_hash, diffPixels: res.diffPixels, diffRatio: res.diffRatio, sizeChanged: res.sizeChanged };
      if (!exceedsAllowance(res, rules)) {
        if (fs.existsSync(diffFile)) fs.rmSync(diffFile);
        return { row: { ...base, status: 'unchanged' }, approvals: [] };
      }

      // On the default branch, pixels that someone already approved on a PR branch are a merged change.
      if (build.branch === project.default_branch) {
        const earlier = db.approvalForHash(project.id, key, snap.image_hash);
        if (earlier) {
          return {
            row: { ...base, status: 'accepted', hasDiff: true, note: `Already approved on "${earlier.branch}" by ${earlier.approved_by}.` },
            approvals: [{ branch: build.branch, key, imageHash: snap.image_hash, approvedBy: `auto (approved on ${earlier.branch})`, auto: true }],
          };
        }
      }
      return { row: { ...base, status: 'changed', hasDiff: true }, approvals: [] };
    },

    async failBuild(project, buildId, message) {
      const build = ownedBuild(project, buildId);
      if (build.status === 'ready') return { ok: true };
      db.setBuildStatus(buildId, 'failed', String(message ?? 'Build failed').slice(0, 300), new Date().toISOString());
      await notify(project, build, 'error', `Visual check could not run: ${String(message ?? '').slice(0, 90)}`);
      return { ok: true };
    },

    getBuild: (project, buildId) => toManifest(project, ownedBuild(project, buildId)),

    listBuilds(project, { branch, limit = 30 } = {}) {
      const rows = db.listBuilds(project.id, { branch, limit: Math.min(Math.max(Number(limit) || 30, 1), 100) });
      return rows.map((b) => {
        const counts = Object.fromEntries(db.statusCounts(b.id).map((r) => [r.status, r.n]));
        const pending = (counts.changed ?? 0) + (counts.rejected ?? 0) + (counts.error ?? 0);
        return { id: b.id, branch: b.branch, commit: b.commit_sha, createdAt: b.created_at, status: b.status, failure: b.failure ?? undefined, pending, total: b.expected };
      });
    },

    // ---------- review ----------
    async review(project, buildId, action, keys, reviewer) {
      const build = ownedBuild(project, buildId);
      if (build.status !== 'ready') throw new HttpError(409, `Build is ${build.status}, not ready for review`);
      const rows = db.snapshots(buildId);
      let targets;
      if (keys === 'all') {
        // Bulk approve only touches stories still awaiting a decision, never ones explicitly rejected.
        targets = rows.filter((r) => r.status === 'changed');
      } else {
        const unknown = keys.filter((k) => !rows.some((r) => r.key === k));
        if (unknown.length) throw new HttpError(404, `Unknown snapshot key(s): ${unknown.join(', ')}`);
        targets = rows.filter((r) => keys.includes(r.key));
      }

      const now = new Date().toISOString();
      db.tx(() => {
        for (const r of targets) {
          const next = reviewTransition(r.status, action);
          if (!next) continue;
          if (action === 'approve') {
            db.insertApproval({ projectId: project.id, branch: build.branch, key: r.key, imageHash: r.image_hash, approvedBy: reviewer, approvedAt: now, auto: false, buildId });
            db.setStatus(buildId, r.key, next, `Approved by ${reviewer}`);
          } else {
            db.setStatus(buildId, r.key, next, `Rejected by ${reviewer}`);
          }
        }
      });

      const manifest = toManifest(project, build);
      await notify(project, build, manifest.summary.pending > 0 ? 'failure' : 'success', describeManifest(manifest));
      return manifest;
    },

    imageForProject(project, hash) {
      if (!HASH_RE.test(hash) || !db.projectOwnsImage(project.id, hash)) return null;
      return storage.findImage(hash);
    },

    diffForProject(project, buildId, key) {
      const build = ownedBuild(project, buildId);
      if (!KEY_RE.test(key)) return null;
      const snap = db.snapshot(build.id, key);
      return snap?.has_diff ? storage.findDiff(build.id, key) : null;
    },
  };
}
