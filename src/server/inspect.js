// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

// Read-only look inside the review server's database. Opens kitsune.db read-only, so it is safe to run while
// the server is running and cannot change anything. Token and session hashes are never printed.
import fs from 'node:fs';
import path from 'node:path';

const SECRET_COLUMNS = new Set(['upload_token_hash', 'review_token_hash', 'id_hash']);

async function openReadOnly(dataDir) {
  const file = path.join(dataDir, 'kitsune.db');
  if (!fs.existsSync(file)) throw new Error(`No database at ${file}. Check --data (or KITSUNE_DATA_DIR).`);
  const original = process.emitWarning;
  process.emitWarning = (w, ...a) => ((typeof a[0] === 'string' ? a[0] : a[0]?.type) === 'ExperimentalWarning' ? undefined : original.call(process, w, ...a));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(file, { readOnly: true });
  } finally {
    process.emitWarning = original;
  }
}

function printTable(rows, title) {
  if (title) console.log(`\n${title}`);
  if (!rows.length) return console.log('  (none)');
  const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, SECRET_COLUMNS.has(k) ? '(hidden)' : v ?? ''])));
  console.table(clean);
}

export async function inspectDatabase({ dataDir, build, branch, approvals, sql, limit = 20 }) {
  const db = await openReadOnly(dataDir);
  const all = (query, ...params) => db.prepare(query).all(...params);
  try {
    if (sql) {
      if (!/^\s*(select|with|pragma\s+table_info)\b/i.test(sql)) throw new Error('--sql only accepts SELECT queries.');
      if (/token_hash|id_hash|\bsessions\b/i.test(sql)) throw new Error('Token and session columns are not available through inspect.');
      printTable(all(sql), null);
      return;
    }

    if (build) {
      const b = all(`SELECT id, branch, commit_sha, status, expected, threshold, created_at, finalized_at, failure FROM builds WHERE id = ?`, build)[0];
      if (!b) throw new Error(`No build "${build}". List builds with: kitsune server inspect`);
      printTable([b], 'Build');
      printTable(
        all(`SELECT key, status, diff_pixels, round(diff_ratio * 100, 2) AS diff_pct, error, note FROM snapshots WHERE build_id = ? ORDER BY (status = 'unchanged'), key`, build),
        'Snapshots (unchanged last)',
      );
      return;
    }

    if (approvals) {
      const rows = branch
        ? all(`SELECT id, approved_at, approved_by, branch, key, substr(image_hash,1,10) AS pixels, auto FROM approvals WHERE branch = ? ORDER BY id DESC LIMIT ?`, branch, limit)
        : all(`SELECT id, approved_at, approved_by, branch, key, substr(image_hash,1,10) AS pixels, auto FROM approvals ORDER BY id DESC LIMIT ?`, limit);
      printTable(rows, `Latest approvals${branch ? ` on ${branch}` : ''} (auto = 1: first capture or merge)`);
      return;
    }

    // Default overview
    printTable(all(`SELECT name, default_branch, github_repo, created_at FROM projects ORDER BY created_at`), 'Projects');
    const builds = branch
      ? all(`SELECT b.id, b.branch, substr(b.commit_sha,1,7) AS sha, b.status, b.created_at,
               COALESCE(SUM(s.status IN ('changed','rejected','error')), 0) AS pending, COUNT(s.key) AS snapshots
             FROM builds b LEFT JOIN snapshots s ON s.build_id = b.id WHERE b.branch = ? GROUP BY b.id ORDER BY b.created_at DESC LIMIT ?`, branch, limit)
      : all(`SELECT b.id, b.branch, substr(b.commit_sha,1,7) AS sha, b.status, b.created_at,
               COALESCE(SUM(s.status IN ('changed','rejected','error')), 0) AS pending, COUNT(s.key) AS snapshots
             FROM builds b LEFT JOIN snapshots s ON s.build_id = b.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT ?`, limit);
    printTable(builds, 'Latest builds (pending = changed + rejected + error)');
    const totals = all(`SELECT (SELECT COUNT(*) FROM builds) AS builds, (SELECT COUNT(*) FROM snapshots) AS snapshots, (SELECT COUNT(*) FROM approvals) AS approvals`)[0];
    console.log(`\nTotals: ${totals.builds} builds, ${totals.snapshots} snapshots, ${totals.approvals} approvals`);
    console.log('More: --build <id> | --approvals [--branch <b>] | --sql "SELECT ..."');
  } finally {
    db.close();
  }
}
