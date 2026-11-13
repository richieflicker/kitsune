// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the review server keeps PNG files. Metadata lives in the database; this only deals with files.
 *
 *   imagesDir  captured screenshots, named by content hash (default <data>/images)
 *   diffsDir   diff images, one folder per build (default <data>/diffs)
 *   archiveDir optional cold storage: old images/diffs are moved here by `kitsune server prune`
 *              and are still served from here if a reviewer opens an old build.
 *
 * Every path is a plain folder, so a mounted volume or a synced folder works. The same method set is
 * what an S3 adapter would implement later.
 */
export function createFsStorage({ dataDir, imagesDir, diffsDir, archiveDir } = {}) {
  const dirs = {
    images: path.resolve(imagesDir || path.join(dataDir, 'images')),
    diffs: path.resolve(diffsDir || path.join(dataDir, 'diffs')),
    archive: archiveDir ? path.resolve(archiveDir) : null,
  };
  fs.mkdirSync(dirs.images, { recursive: true });
  fs.mkdirSync(dirs.diffs, { recursive: true });
  if (dirs.archive) fs.mkdirSync(dirs.archive, { recursive: true });

  const imageFile = (hash) => path.join(dirs.images, `${hash}.png`);
  const diffFile = (buildId, key) => path.join(dirs.diffs, buildId, `${key}.png`);
  const archivedImage = (hash) => (dirs.archive ? path.join(dirs.archive, 'images', `${hash}.png`) : null);
  const archivedDiff = (buildId, key) => (dirs.archive ? path.join(dirs.archive, 'diffs', buildId, `${key}.png`) : null);
  const exists = (file) => Boolean(file) && fs.existsSync(file);

  /** rename, falling back to copy + delete when the archive is on another disk. */
  function move(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.renameSync(from, to);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      const tmp = `${to}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.copyFileSync(from, tmp);
      fs.renameSync(tmp, to);
      fs.rmSync(from);
    }
  }

  return {
    dirs,
    imagePath: imageFile,
    diffPath: diffFile,

    hasImage: (hash) => exists(imageFile(hash)),

    putImage(hash, buffer) {
      const file = imageFile(hash);
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, file);
    },

    /** The file to serve for an image: the live folder first, then the archive. */
    findImage(hash) {
      if (exists(imageFile(hash))) return imageFile(hash);
      return exists(archivedImage(hash)) ? archivedImage(hash) : null;
    },

    findDiff(buildId, key) {
      if (exists(diffFile(buildId, key))) return diffFile(buildId, key);
      return exists(archivedDiff(buildId, key)) ? archivedDiff(buildId, key) : null;
    },

    /**
     * Move (when an archive folder is set) or delete (when `remove` is true) the files of retired builds.
     * Returns what it did; nothing is touched when `dryRun` is true.
     */
    retire({ hashes = [], buildIds = [], remove = false, dryRun = false }) {
      const out = { images: 0, diffs: 0, bytes: 0, mode: dirs.archive && !remove ? 'archive' : 'delete' };
      if (!dirs.archive && !remove) throw new Error('No archive folder is configured; pass remove to delete instead.');
      const retireFile = (from, to) => {
        out.bytes += fs.statSync(from).size;
        if (dryRun) return;
        if (out.mode === 'archive') move(from, to);
        else fs.rmSync(from);
      };

      for (const hash of hashes) {
        if (exists(imageFile(hash))) {
          retireFile(imageFile(hash), archivedImage(hash));
          out.images += 1;
        }
      }
      for (const buildId of buildIds) {
        const folder = path.join(dirs.diffs, buildId);
        if (!fs.existsSync(folder)) continue;
        for (const name of fs.readdirSync(folder)) {
          if (!name.endsWith('.png')) continue;
          retireFile(path.join(folder, name), path.join(dirs.archive ?? '', 'diffs', buildId, name));
          out.diffs += 1;
        }
        if (!dryRun) fs.rmSync(folder, { recursive: true, force: true });
      }
      return out;
    },
  };
}
