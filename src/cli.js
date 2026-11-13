// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Richie Flicker

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { detectRun } from './ci.js';
import { review, runCheck } from './check.js';
import { loadConfig } from './config.js';
import { describeManifest, githubContext, postStatusSafely } from './github.js';
import { runRemoteCheck } from './remote.js';
import { startServer } from './server.js';
import { createStore } from './store.js';

const COLORS = { new: '\x1b[36m', unchanged: '\x1b[32m', changed: '\x1b[33m', accepted: '\x1b[32m', rejected: '\x1b[31m', error: '\x1b[31m' };
const paint = (status, text) => (process.stdout.isTTY ? `${COLORS[status] ?? ''}${text}\x1b[0m` : text);

function printSummary(manifest) {
  const { summary: s } = manifest;
  console.log('');
  for (const st of manifest.stories) {
    if (st.status === 'unchanged') continue;
    const extra = st.status === 'error' ? ` - ${st.error}` : st.diffPixels ? ` (${st.diffPixels} px differ)` : '';
    console.log(`  ${paint(st.status, st.status.padEnd(9))} ${st.key}${extra}`);
  }
  console.log(
    `\n${s.total} snapshots: ${s.unchanged} unchanged, ${s.new} new (auto-approved), ${s.changed} changed, ${s.accepted} accepted, ${s.rejected} rejected, ${s.error} errors`,
  );
}

// Single updating line in a terminal; silent in CI logs.
const terminalProgress = (n, total) => {
  if (process.stdout.isTTY) process.stdout.write(`\r  captured ${n}/${total}${n === total ? '\n' : ''}`);
};

function printTokens({ project, uploadToken, reviewToken }) {
  console.log(`Project "${project.name}" (${project.id})`);
  console.log(`  default branch : ${project.default_branch}`);
  console.log(`  GitHub repo    : ${project.github_repo ?? '(none: no PR status will be posted)'}`);
  console.log('\nSave these now. They are stored hashed and cannot be shown again.\n');
  console.log(`  KITSUNE_UPLOAD_TOKEN (CI secret, lets CI upload snapshots) : ${uploadToken}`);
  console.log(`  Review token (give to reviewers to sign in)            : ${reviewToken}`);
}

export async function main(argv) {
  const program = new Command();
  program.name('kitsune').description('Visual regression review for Storybook').addHelpText('after', '\nKitsune Review, Copyright (c) 2026 Richie Flicker. Licensed under the MIT licence.\n').option('-c, --config <file>', 'path to kitsune.config.js');

  const cfgOf = () => loadConfig({ configPath: program.opts().config });

  program
    .command('init')
    .description('Create a starter kitsune.config.js')
    .action(() => {
      const file = path.resolve('kitsune.config.js');
      if (fs.existsSync(file)) throw new Error('kitsune.config.js already exists');
      fs.writeFileSync(
        file,
        `export default {
  storybook: { dir: './storybook-static' }, // run \`storybook build\` first, or use { url: 'http://localhost:6006' }
  viewports: [
    { name: 'desktop', width: 1280, height: 720 },
    // { name: 'mobile', width: 390, height: 844 },
  ],
  browsers: ['chromium'], // add 'firefox', 'webkit' after \`npx playwright install firefox webkit\`
  threshold: 0.05,
  maxDiffPixels: 0,

  // More you can set (all optional, see COMMANDS.md):
  // hide: ['.clock'],              // hide changing parts before the screenshot
  // overrides: [{ match: 'charts-', threshold: 0.2 }, { match: 'legacy-', skip: true }],
  // ui: { view: 'slider', theme: 'auto' },
};
`,
      );
      console.log('Created kitsune.config.js');
    });

  program
    .command('check')
    .description('Capture every story, compare with approved baselines, exit 1 if anything needs review')
    .option('--no-fail', 'always exit 0 (the GitHub status, if enabled, still reflects the real result)')
    .option('--github', 'post a "visual-review" commit status to GitHub (needs GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA)')
    .option('--sha <sha>', 'commit to attach the GitHub status to (default: PR head, else GITHUB_SHA)')
    .option('--review-url <url>', 'link shown as "Details" on the GitHub status (default: $KITSUNE_REVIEW_URL)')
    .option('--remote', 'upload to the shared review server (KITSUNE_URL + KITSUNE_UPLOAD_TOKEN) instead of comparing locally')
    .option('--branch <name>', 'branch name for --remote (default: detected from CI/git)')
    .option('--commit <sha>', 'commit SHA for --remote (default: PR head / GITHUB_SHA / git)')
    .action(async (opts) => {
      const cfg = await cfgOf();

      if (opts.remote) {
        if (opts.github) console.warn('note: --github is ignored with --remote; the server posts the GitHub status itself.');
        const url = process.env.KITSUNE_URL || cfg.remote.url;
        const token = process.env.KITSUNE_UPLOAD_TOKEN;
        if (!url) throw new Error('--remote needs the server address: set KITSUNE_URL (or remote.url in kitsune.config.js).');
        if (!token) throw new Error('--remote needs KITSUNE_UPLOAD_TOKEN in the environment (it is never read from the config file).');

        const run = detectRun(process.env, { branch: opts.branch, commit: opts.commit ?? opts.sha });
        const { manifest, build } = await runRemoteCheck(cfg, { url, token, ...run, log: (m) => console.log(m), progress: terminalProgress });
        printSummary(manifest);
        if (build.url) console.log(`\nReview: ${build.url}`);
        if (manifest.summary.pending > 0 && opts.fail) process.exitCode = 1;
        return;
      }

      // Validate GitHub settings before the slow capture work, so a missing token fails immediately.
      const gh = opts.github ? githubContext(process.env, { sha: opts.sha, reviewUrl: opts.reviewUrl }) : null;
      if (gh) await postStatusSafely(gh, { state: 'pending', description: 'Capturing snapshots...' });

      let manifest;
      try {
        manifest = await runCheck(cfg, { log: (m) => console.log(m), progress: terminalProgress });
      } catch (err) {
        // The check itself broke (browser missing, Storybook unreachable...): don't leave the PR stuck on "pending".
        if (gh) await postStatusSafely(gh, { state: 'error', description: `Visual check could not run: ${err.message}` });
        throw err;
      }

      if (gh) {
        await postStatusSafely(gh, {
          state: manifest.summary.pending > 0 ? 'failure' : 'success',
          description: describeManifest(manifest),
        });
      }
      printSummary(manifest);
      if (manifest.summary.pending > 0) {
        console.log(`\nReview changes with: kitsune serve`);
        if (opts.fail) process.exitCode = 1;
      }
    });

  program
    .command('serve')
    .description('Open the local review dashboard')
    .option('-p, --port <port>', 'port')
    .action(async (opts) => {
      const cfg = await cfgOf();
      const { url } = await startServer(cfg, { port: opts.port ? Number(opts.port) : undefined });
      console.log(`Review dashboard: ${url}`);
    });

  program
    .command('approve [keys...]')
    .option('--all', 'approve every changed story')
    .description('Approve changed stories (new screenshot becomes the baseline)')
    .action(async (keys, opts) => {
      const manifest = review(await cfgOf(), 'approve', opts.all ? 'all' : keys);
      printSummary(manifest);
    });

  program
    .command('reject <keys...>')
    .description('Mark changed stories as rejected (the check keeps failing)')
    .action(async (keys) => {
      const manifest = review(await cfgOf(), 'reject', keys);
      printSummary(manifest);
    });

  program
    .command('status')
    .description('Show the result of the last check')
    .action(async () => {
      const manifest = createStore(await cfgOf()).readManifest();
      if (!manifest) return console.log('No results yet. Run `kitsune check`.');
      console.log(`Build ${manifest.buildId}${manifest.branch ? ` on ${manifest.branch}` : ''}`);
      printSummary(manifest);
    });

  // ---------------------------------------------------------------- shared review server
  const server = program.command('server').description('Run or administer the shared review server');
  // No defaults on these options: resolveServer() applies flag > environment > settings file > built-in default.
  const dataOption = ['--data <dir>', 'data folder (database + images); default ./kitsune-data'];
  const imagesOption = ['--images-dir <dir>', 'where screenshots are stored (default <data>/images)'];
  const diffsOption = ['--diffs-dir <dir>', 'where diff images are stored (default <data>/diffs)'];
  const archiveOption = ['--archive-dir <dir>', 'cold storage for old images and diffs (see `server prune`)'];
  const settingsOption = ['--server-config <file>', 'server settings file (default: kitsune.server.json / .js in this folder, if present)'];

  async function resolveServer(opts) {
    const { loadServerSettings, effectiveEnv } = await import('./server/settings.js');
    const file = await loadServerSettings({ file: opts.serverConfig });
    const env = process.env;
    const pick = (flag, envName, fromFile, fallback) => path.resolve(flag ?? env[envName] ?? fromFile ?? fallback);
    const optional = (flag, envName, fromFile) => {
      const v = flag ?? env[envName] ?? fromFile;
      return v ? path.resolve(v) : undefined;
    };
    return {
      file,
      env: effectiveEnv(file, env),
      dataDir: pick(opts.data, 'KITSUNE_DATA_DIR', file.dataDir, './kitsune-data'),
      imagesDir: optional(opts.imagesDir, 'KITSUNE_IMAGES_DIR', file.imagesDir),
      diffsDir: optional(opts.diffsDir, 'KITSUNE_DIFFS_DIR', file.diffsDir),
      archiveDir: optional(opts.archiveDir, 'KITSUNE_ARCHIVE_DIR', file.archiveDir),
    };
  }

  async function withService(opts, fn) {
    const { openDb } = await import('./server/db.js');
    const { createService } = await import('./server/service.js');
    const r = await resolveServer(opts);
    const db = await openDb(r.dataDir);
    try {
      return await fn(createService({ db, dataDir: r.dataDir, env: r.env }));
    } finally {
      db.close();
    }
  }

  const withFolders = (cmd) => cmd.option(...dataOption).option(...imagesOption).option(...diffsOption).option(...archiveOption).option(...settingsOption);

  withFolders(
    server
      .command('start')
      .description('Start the shared review server (dashboard + API)')
      .option('-p, --port <port>', 'port (default 4456)')
      .option('--host <host>', 'interface to listen on (default 127.0.0.1; keep it behind a reverse proxy)')
      .option('--public-project <name>', 'let anyone view this project read-only without signing in (approving and uploading still need tokens)'),
  ).action(async (opts) => {
    const { startRemoteServer } = await import('./server/app.js');
    const r = await resolveServer(opts);
    const { file } = r;
    const port = Number(opts.port ?? process.env.KITSUNE_PORT ?? file.port ?? 4456);
    const host = opts.host ?? process.env.KITSUNE_HOST ?? file.host ?? '127.0.0.1';
    const srv = await startRemoteServer({
      dataDir: r.dataDir,
      imagesDir: r.imagesDir,
      diffsDir: r.diffsDir,
      archiveDir: r.archiveDir,
      port,
      host,
      env: r.env,
      ui: file.ui,
      sessionDays: file.sessionDays,
      publicProject: opts.publicProject ?? r.env.KITSUNE_PUBLIC_PROJECT,
      retention: file.retention,
    });
    console.log(`Review server listening on ${srv.url}`);
    if (file.file) console.log(`  settings    : ${file.file}`);
    console.log(`  data folder : ${r.dataDir}`);
    const pub = opts.publicProject ?? r.env.KITSUNE_PUBLIC_PROJECT;
    console.log(`  viewing     : ${pub ? `anyone can view "${pub}" read-only; sign-in needed to approve` : 'sign-in required'}`);
    console.log(`  images      : ${r.imagesDir ?? 'inside the data folder'}`);
    console.log(`  diffs       : ${r.diffsDir ?? 'inside the data folder'}`);
    if (r.archiveDir) console.log(`  archive     : ${r.archiveDir}`);
    if (file.retention) {
      console.log(`  retention   : every ${file.retention.everyHours}h, ${file.retention.mode} files of builds older than ${file.retention.olderThanDays} day(s)`);
    }
    console.log(`  GitHub      : ${r.env.KITSUNE_GITHUB_TOKEN ? 'statuses enabled' : 'KITSUNE_GITHUB_TOKEN not set, no PR statuses will be posted'}`);
    if (!r.env.KITSUNE_PUBLIC_URL) console.log('  note        : set KITSUNE_PUBLIC_URL (or publicUrl in the settings file) so PR statuses link to the dashboard and cookies are marked Secure on https');
    const stop = async () => {
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });

  withFolders(
    server
      .command('create-project <name>')
      .description('Create a project and print its tokens (shown once)')
      .option('--repo <owner/repo>', 'GitHub repository to post commit statuses to')
      .option('--default-branch <branch>', 'branch whose baselines everything else falls back to', 'main'),
  ).action(async (name, opts) => {
    const { openDb } = await import('./server/db.js');
    const { createService } = await import('./server/service.js');
    const r = await resolveServer(opts);
    const db = await openDb(r.dataDir);
    try {
      printTokens(createService({ db, dataDir: r.dataDir, env: r.env }).createProject({ name, defaultBranch: opts.defaultBranch, githubRepo: opts.repo }));
    } finally {
      db.close();
    }
  });

  withFolders(server.command('add-reviewer <project> <name>').description('Issue a personal review token (shown once). Approvals are recorded under that name.')).action(async (project, name, opts) => {
    await withService(opts, (svc) => {
      const r = svc.addReviewer(project, name);
      console.log(`Reviewer "${r.name}" on project "${r.project.name}"\n\nSave this now. It is stored hashed and cannot be shown again.\n`);
      console.log(`  Personal review token : ${r.token}`);
    });
  });

  withFolders(server.command('list-reviewers <project>').description('Show who has a personal review token')).action(async (project, opts) => {
    await withService(opts, (svc) => {
      const rows = svc.listReviewers(project);
      if (!rows.length) return console.log('No personal tokens yet. Add one with: kitsune server add-reviewer <project> <name>');
      for (const r of rows) console.log(`${r.revoked_at ? 'revoked' : 'active '}  ${r.name}  (added ${r.created_at.slice(0, 10)}${r.revoked_at ? `, revoked ${r.revoked_at.slice(0, 10)}` : ''})`);
    });
  });

  withFolders(server.command('revoke-reviewer <project> <name>').description("Revoke one person's token and sign them out; nobody else is affected")).action(async (project, name, opts) => {
    await withService(opts, (svc) => {
      const r = svc.revokeReviewer(project, name);
      console.log(`Revoked "${r.name}" on "${r.project.name}". Their sessions are signed out.`);
    });
  });

  withFolders(server.command('disable-shared-token <project>').description('Turn off the shared review token so only personal tokens can sign in')).action(async (project, opts) => {
    await withService(opts, (svc) => {
      svc.disableSharedReview(project);
      console.log(`The shared review token for "${project}" no longer works. Only personal tokens can sign in.`);
    });
  });

  // Short form: `kitsune user add "Asha"`. The project is optional when the server has only one.
  const user = program.command('user').description('Manage who can sign in to the shared review server (personal review tokens)');
  const projectOption = ['--project <name>', 'project (optional when there is only one)'];

  withFolders(user.command('add <name>').description('Give a person a personal review token (shown once)').option(...projectOption)).action(async (name, opts) => {
    await withService(opts, (svc) => {
      const r = svc.addReviewer(svc.projectNameOrOnly(opts.project), name);
      console.log(`Added "${r.name}" to project "${r.project.name}".\n\nSend them this token privately. It is stored hashed and cannot be shown again.\n`);
      console.log(`  Personal review token : ${r.token}`);
      console.log('\nThey sign in at your review server address and paste it into "Review token".');
    });
  });

  withFolders(user.command('list').description('Show who has a personal token').option(...projectOption)).action(async (opts) => {
    await withService(opts, (svc) => {
      const rows = svc.listReviewers(svc.projectNameOrOnly(opts.project));
      if (!rows.length) return console.log('Nobody yet. Add someone with: kitsune user add "<name>"');
      for (const r of rows) console.log(`${r.revoked_at ? 'revoked' : 'active '}  ${r.name}  (added ${r.created_at.slice(0, 10)}${r.revoked_at ? `, revoked ${r.revoked_at.slice(0, 10)}` : ''})`);
    });
  });

  withFolders(user.command('revoke <name>').description("Remove one person's access and sign them out").option(...projectOption)).action(async (name, opts) => {
    await withService(opts, (svc) => {
      const r = svc.revokeReviewer(svc.projectNameOrOnly(opts.project), name);
      console.log(`Revoked "${r.name}". Their sessions are signed out.`);
    });
  });

  withFolders(
    server
      .command('prune')
      .description('Move (or delete) the images and diffs of old builds. Current baselines and recent builds are never touched.')
      .option('--older-than <days>', 'retire files of builds older than this many days (default: retention.olderThanDays from the settings file)')
      .option('--delete', 'delete instead of moving to the archive folder (needed when no archive folder is set)')
      .option('--dry-run', 'show what would happen without changing anything'),
  ).action(async (opts) => {
    const { openDb } = await import('./server/db.js');
    const { createFsStorage } = await import('./server/storage.js');
    const { pruneStorage } = await import('./server/prune.js');
    const r = await resolveServer(opts);
    const days = Number(opts.olderThan ?? r.file.retention?.olderThanDays);
    if (!(days > 0)) throw new Error('Say how old: --older-than <days> (or set retention.olderThanDays in the settings file).');
    const remove = Boolean(opts.delete) || (!opts.olderThan && r.file.retention?.mode === 'delete');
    if (!r.archiveDir && !remove) throw new Error('Set an archive folder (--archive-dir) to move old files there, or pass --delete to remove them.');
    const db = await openDb(r.dataDir);
    try {
      const storage = createFsStorage({ dataDir: r.dataDir, imagesDir: r.imagesDir, diffsDir: r.diffsDir, archiveDir: r.archiveDir });
      const res = pruneStorage({ db, storage, olderThanDays: days, remove, dryRun: Boolean(opts.dryRun) });
      const verb = res.dryRun ? `Would ${res.mode === 'archive' ? 'move' : 'delete'}` : res.mode === 'archive' ? 'Moved' : 'Deleted';
      console.log(`${verb} ${res.images} image(s) and ${res.diffs} diff(s) (${(res.bytes / 1048576).toFixed(1)} MB) from ${res.builds} build(s) older than ${days} day(s).`);
      console.log(`Kept ${res.protectedImages} image(s) in use by current baselines or recent builds.`);
    } finally {
      db.close();
    }
  });

  withFolders(
    server
      .command('inspect')
      .description('Read-only look inside the database: projects, builds, snapshots, approvals (safe while the server runs)')
      .option('--build <id>', 'show every snapshot of one build')
      .option('--branch <name>', 'only this branch')
      .option('--approvals', 'show the approval history')
      .option('--limit <n>', 'rows to show', '20')
      .option('--sql <query>', 'run your own SELECT query (read-only)'),
  ).action(async (opts) => {
    const { inspectDatabase } = await import('./server/inspect.js');
    const r = await resolveServer(opts);
    await inspectDatabase({ dataDir: r.dataDir, build: opts.build, branch: opts.branch, approvals: opts.approvals, sql: opts.sql, limit: Number(opts.limit) || 20 });
  });

  withFolders(
    server.command('rotate-tokens <name>').description('Issue new upload and review tokens (old ones stop working, review sessions are signed out)'),
  ).action(async (name, opts) => {
    const { openDb } = await import('./server/db.js');
    const { createService } = await import('./server/service.js');
    const r = await resolveServer(opts);
    const db = await openDb(r.dataDir);
    try {
      printTokens(createService({ db, dataDir: r.dataDir, env: r.env }).rotateTokens(name));
    } finally {
      db.close();
    }
  });

  await program.parseAsync(argv);
}
