// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

/**
 * Retire the files of old builds. Database rows are never deleted (history stays complete); only PNGs move
 * to the archive folder or are deleted.
 *
 * Never retired: the current baseline of every (project, story, branch), and every image used by a build
 * newer than the cutoff or still uploading/finalizing. An archived file is still served if someone opens
 * the old build; a deleted one shows as a missing image.
 */
export function pruneStorage({ db, storage, olderThanDays, remove = false, dryRun = false, now = new Date() }) {
  if (!(olderThanDays > 0)) throw new Error('olderThanDays must be a positive number');
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000).toISOString();
  const buildIds = db.oldBuildIds(cutoff);
  const inUse = db.hashesInUse(cutoff);

  const hashes = new Set();
  for (const id of buildIds) for (const h of db.hashesOfBuild(id)) if (!inUse.has(h)) hashes.add(h);

  const result = storage.retire({ hashes: [...hashes], buildIds, remove, dryRun });
  return { cutoff, builds: buildIds.length, protectedImages: inUse.size, ...result, dryRun };
}
