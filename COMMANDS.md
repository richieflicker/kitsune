# 🦊 Kitsune commands

A plain-English guide to every command. Run them with `npx kitsune <command>` (or the npm scripts in your project).
Add `-c path/to/kitsune.config.js` before the command if your config is not in the current folder:

```bash
npx kitsune -c ./kitsune.config.js check
```

**The idea in one paragraph.** `check` opens every story of your *built* Storybook, takes screenshots, and compares
them with the approved ones (the "baselines"). The very first screenshot of a story is approved automatically. If a
story looks different later, it is marked **changed** and the check fails until a person approves or fixes it.

```
build-storybook  →  kitsune check  →  kitsune serve (review)  →  approve  →  next check passes
```

---

## Everyday commands (local, no server)

| Command | What it does |
|---|---|
| `kitsune init [--no-scripts] [--no-storybook]` | Creates a starter `kitsune.config.js`, adds `kitsune:check`, `kitsune:serve` and `kitsune:browsers` scripts to `package.json` (existing scripts are never overwritten) and adds the `kitsune-review` addon to `.storybook/main.*` when it is a plain `addons: [ ... ]` array (otherwise it prints the line). Safe to run again. |
| `kitsune browsers [names...]` | Installs Playwright browsers using the Playwright that Kitsune itself uses. Default: `firefox webkit`. |
| `kitsune check` | Captures every story, compares with baselines, prints a summary. **Exits with code 1 if anything needs review**, which is what makes CI fail. |
| `kitsune serve` | Opens the review dashboard (default http://127.0.0.1:4455): before/after, slider, diff, approve/reject. |
| `kitsune approve [keys…]` | Approves changed stories; the new screenshot becomes the baseline. |
| `kitsune reject <keys…>` | Marks changed stories as rejected. The check keeps failing for them. |
| `kitsune status` | Shows the result of the last check without running it again. |
| `kitsune init-hook [--warn] [--command <cmd>] [--force] [--remove]` | Installs a git **pre-push** hook that runs `kitsune check`. While changes are unapproved the push is blocked: review with `kitsune serve`, approve, push again. Uses `.husky/pre-push` when the project uses Husky, otherwise git's own hooks folder. Skip once with `KITSUNE_SKIP=1 git push` or `git push --no-verify`. `--warn` prints instead of blocking. A hook Kitsune did not write is never overwritten without `--force`. |

### `kitsune check`
Build Storybook first (`npm run build-storybook`), because Kitsune reads the static build.

| Option | Meaning |
|---|---|
| `--no-fail` | Always exit 0, even with changes. Useful for a first look. |
| `--github` | Post a `visual-review` commit status to GitHub (needs `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_SHA`). |
| `--sha <sha>` | Commit to attach the GitHub status to (default: PR head, else `GITHUB_SHA`). |
| `--review-url <url>` | Link shown as "Details" on the GitHub status (or set `KITSUNE_REVIEW_URL`). |
| `--remote` | Upload to the shared review server instead of comparing locally (see *Shared server*). |
| `--branch <name>` | Branch name for `--remote` (default: detected from CI/git). |
| `--commit <sha>` | Commit for `--remote` (default: PR head / `GITHUB_SHA` / git). |

Result words you will see:

| Status | Meaning |
|---|---|
| `new` | First capture of a story. Approved automatically as its baseline. |
| `unchanged` | Same as the baseline (within `threshold` / `maxDiffPixels`). |
| `changed` | Differs from the baseline. Needs a decision. |
| `accepted` | Was changed, then approved. |
| `rejected` | Was changed, then rejected. Still fails. |
| `error` | The story could not render (the message says why). Fix the story. |

### `kitsune serve`
`-p, --port <port>`: port for the dashboard (default 4455).
Keyboard: `j`/`k` next/previous, `a` approve, `r` reject.

### `kitsune approve` / `reject`
```bash
npx kitsune approve --all                      # approve every changed story
npx kitsune approve atoms-button--primary__desktop__chromium
npx kitsune reject  atoms-button--primary__desktop__chromium
```
A *key* is `<story id>__<viewport>__<browser>`, as printed by `check`. The dashboard is usually easier.

### `kitsune status`
Prints the build and the summary counts from the last `check`.

### `kitsune init-hook`
For teams without CI access. The hook runs the full check on every push, so for big Storybooks consider `--warn` or `--command` with a faster check. Remove it with `kitsune init-hook --remove`.

---

### Local server API

`kitsune serve` exposes a small JSON API that the dashboard and the Storybook testing panel use:

| Call | What it does |
| --- | --- |
| `GET /api/build` | Result of the last check. |
| `POST /api/run` | Start a check in the background (409 if one is already running). Optional body `{"browsers": ["chromium"]}` limits it to those configured browsers (400 for an unknown name). |
| `GET /api/run` | Progress (`running`, `done`, `total`, `error`), the configured `browsers`, the last summary and `byBrowser` (`total` and `pending` per browser). |
| `POST /api/approve`, `POST /api/reject` | Review changed stories (`key`, `keys` or `all`). |

Every `POST` must send `x-requested-with: kitsune`. Cross-origin calls are only accepted from `localhost` / `127.0.0.1` pages, such as Storybook on port 6006.

## Shared server (web approvals for a team / CI)

Use this when CI runs the check and people approve from a browser. It needs Node 22.13 or newer.
Everything is stored in one folder: a SQLite database (projects, reviewers, sessions, builds, approvals) plus PNG files.

| Command | What it does |
|---|---|
| `kitsune server create-project <name>` | Creates a project and prints an **upload token** (for CI) and a **review token** (for reviewers). Shown once. |
| `kitsune server start` | Starts the dashboard + API (default http://127.0.0.1:4456). |
| `kitsune user add <name>` / `user list` / `user revoke <name>` | Short form of the three commands below. The project is optional when there is only one (`--project <name>` otherwise); the data folder defaults to `./kitsune-data`. |
| `kitsune server add-reviewer <project> <name>` | Issues a **personal review token** (shown once). Approvals are recorded under that name, and typing another name does nothing. |
| `kitsune server list-reviewers <project>` | Shows who has a personal token (active or revoked). |
| `kitsune server revoke-reviewer <project> <name>` | Revokes one person's token and signs only them out. |
| `kitsune server disable-shared-token <project>` | Turns the shared review token off so only personal tokens can sign in. |
| `kitsune server rotate-tokens <name>` | Issues new tokens. Old ones stop working and review sessions are signed out. |
| `kitsune server start --public-project <name>` | Lets anyone view that project read-only without signing in (builds, images, diffs). Approving and uploading still need a token. Off by default. Also `publicProject` in the settings file or `KITSUNE_PUBLIC_PROJECT`. |
| `kitsune server inspect` | Read-only look inside the database. Safe while the server runs. |
| `kitsune server prune` | Moves or deletes the files of old builds to save disk space. |

Typical flow:

```bash
# 1. on the server, once
npx kitsune server create-project web --repo yourname/yourrepo
npx kitsune server start --data ./kitsune-data

# 2. in CI, after build-storybook
KITSUNE_URL=https://review.example.com KITSUNE_UPLOAD_TOKEN=kitsune_up_… npx kitsune check --remote

# 3. reviewers open the server URL, sign in with the review token, approve or reject
```

### Options shared by the `server` commands
| Option | Meaning |
|---|---|
| `--data <dir>` | Data folder (database + files). Default `./kitsune-data`, or `KITSUNE_DATA_DIR`. |
| `--images-dir <dir>` | Where screenshots go (default `<data>/images`, or `KITSUNE_IMAGES_DIR`). |
| `--diffs-dir <dir>` | Where diff images go (default `<data>/diffs`, or `KITSUNE_DIFFS_DIR`). |
| `--archive-dir <dir>` | Cold storage for old files (or `KITSUNE_ARCHIVE_DIR`). |
| `--server-config <file>` | Settings file (default: `kitsune.server.json` in the current folder). See *Server settings file*. |

`server start` also takes `-p, --port` (default 4456) and `--host` (default `127.0.0.1`; keep it that way behind a
reverse proxy). `create-project` takes `--repo <owner/repo>` (GitHub statuses) and `--default-branch <branch>`
(default `main`: every branch falls back to its baselines).

Use the **same** folder options for `start` and `prune`, otherwise they look in different places.

### `kitsune server inspect`
```bash
npx kitsune server inspect                        # projects, latest builds, pending counts
npx kitsune server inspect --build <build id>     # every snapshot in one build
npx kitsune server inspect --approvals --branch main
npx kitsune server inspect --sql "SELECT key, status FROM snapshots WHERE status = 'changed'"
```
`--limit <n>` changes how many rows are shown. Only SELECT queries run, and tokens are never shown.

### `kitsune server prune`
```bash
npx kitsune server prune --older-than 30 --archive-dir ./archive --dry-run   # preview, changes nothing
npx kitsune server prune --older-than 30 --archive-dir ./archive             # move old files
npx kitsune server prune --older-than 90 --delete                            # delete instead
npx kitsune server prune                                                     # use retention.* from kitsune.server.json
```
- Only PNG files are touched; build history in the database stays complete.
- The **current baseline of every story and branch** and everything used by newer builds are never removed.
- Archived files are still shown when someone opens the old build; deleted ones show as a missing image.
- It refuses to run unless you give an archive folder or `--delete`.
- Prefer not to use cron? Set `retention` in the server settings file and the server does this by itself.

---

## Configuration reference (`kitsune.config.js`)

Everything below is optional. `kitsune check` stops with a clear message if a value is wrong (for example a threshold
above 1, or a misspelled option inside `overrides`).

### Basics
| Key | Meaning |
|---|---|
| `storybook.dir` / `storybook.url` | The built Storybook folder (e.g. `./storybook-static`) or a running Storybook URL. Use one. |
| `viewports` | Sizes to capture: `[{ name: 'desktop', width: 1280, height: 720 }, …]`. Names must be unique. |
| `browsers` | `chromium`, `firefox`, `webkit` (install with `npx kitsune browsers`). |
| `include` / `exclude` / `excludeTags` | Which stories to capture (id fragments). Stories tagged `skip-visual` are skipped. |
| `concurrency` | Stories captured at once (default 4). |
| `dataDir` | Local results (default `.kitsune`): `baselines/` (commit this to git), `approved.json`, `current/`. |
| `remote.url` | Review server address (or `KITSUNE_URL`). |

### Capture environment (same for every screenshot)
| Key | Default | Meaning |
|---|---|---|
| `colorScheme` | `'light'` | `'light'`, `'dark'` or `'no-preference'` (what `prefers-color-scheme` reports). |
| `reducedMotion` | `'reduce'` | `'reduce'` or `'no-preference'`. |
| `locale`, `timezoneId` | `'en-US'`, `'UTC'` | Keeps dates and number formats stable between machines. |
| `deviceScaleFactor` | `1` | `2` gives retina screenshots (sharper diffs, bigger files). |
| `freezeAnimations` | `true` | Stops CSS animations and transitions before the screenshot. |
| `waitForFonts` | `true` | Waits for web fonts and image decoding. |

### What happens on the page before the screenshot
Each of these can also be set for particular stories in `overrides` (lists add to the global ones, single values replace).

| Key | Meaning |
|---|---|
| `delay`, `timeout` | Extra wait after render (ms, default 100); max wait per story (ms, default 30000). |
| `waitFor` | CSS selector that must exist first, e.g. `'[data-loaded]'`. The story errors if it never appears. |
| `hide` | Selectors set to `visibility: hidden` (layout stays). Good for clocks, avatars, ads. |
| `mask` | Selectors painted over with `maskColor` (default `#ff00ff`), same size, so layout still counts. |
| `ignoreRegions` | `[{ x, y, width, height }]` in screenshot pixels, painted solid in every screenshot. |
| `css` | Extra CSS injected before the screenshot. |
| `screenshot` | `{ fullPage, selector }`: whole page (default) or just one element. |

> **Changing `hide`, `mask`, `ignoreRegions` or `css` changes the screenshots**, so the first check afterwards will
> report differences against your old baselines. Re-approve once (`kitsune approve --all`) after changing them.

### How screenshots are compared
| Key | Default | Meaning |
|---|---|---|
| `threshold` | `0.05` | Per-pixel colour tolerance, 0 (strict) to 1 (loose). |
| `maxDiffPixels` | `0` | Pixels allowed to differ. |
| `maxDiffRatio` | `null` | Share of the page allowed to differ (`0.001` = 0.1%). A story is *changed* only above **both** limits. |
| `includeAA` | `false` | `true` also counts anti-aliased edge pixels. |
| `allowSizeChange` | `false` | By default a page that got taller or shorter is always *changed*. `true` judges it by pixels like any other change. |

### Per-story `overrides`
```js
overrides: [
  { match: 'charts-', threshold: 0.2, maxDiffPixels: 200 },          // noisy charts: be more forgiving
  { match: /^atoms-clock/, mask: ['.time'] },                        // hide the changing part
  { match: 'modal', viewports: ['desktop'], delay: 400, waitFor: '[role=dialog]' },   // only desktop, wait for it
  { match: 'legacy-', skip: true },                                  // not captured at all
  { match: 'hero', viewport: 'mobile', browser: 'webkit', ignoreRegions: [{ x: 0, y: 0, width: 390, height: 60 }] },
]
```
- `match` is a fragment of the story id or title, a RegExp, a list of those, or a function `(story) => boolean`.
- `viewport` / `browser` narrow *where* the override applies. `viewports` limits which viewports run for the match.
- Later entries win. Allowed options: `skip, viewports, delay, timeout, waitFor, hide, mask, css, fullPage, selector,
  ignoreRegions, threshold, maxDiffPixels, maxDiffRatio, includeAA, allowSizeChange`.
- Stories skipped here are not counted and not uploaded with `--remote`.
- With `--remote`, each story's comparison rules travel with its screenshot, so the server judges it the same way.

### Review dashboard (`ui`)
Project defaults. Each reviewer's own choices (view, zoom, theme) are remembered in their browser and win over these.

```js
ui: {
  filter: 'review',          // first list: 'review' | 'new' | 'accepted' | 'unchanged' | 'all'
  view: 'side',              // 'side' | 'slider' | 'diff' | 'new' | 'baseline'
  zoom: 'fit',               // 'fit' | 'actual' (1:1 pixels)
  theme: 'auto',             // 'auto' | 'light' | 'dark'
  slider: {
    start: 50,               // % of the baseline shown on open (100 = all baseline, 0 = all new)
    blinkMs: 700,            // how long each image stays up in Blink
    highlight: false,        // start with changed pixels highlighted
    highlightOpacity: 0.85,  // 0..1
  },
}
```
With the shared server, set `ui` in the server settings file instead (below).

## Server settings file (`kitsune.server.json`)

Put it in the folder you start the server from (or pass `--server-config <file>`). Secrets are never read from it:
the GitHub token stays in `KITSUNE_GITHUB_TOKEN`. For every setting the order is
**command-line flag → environment variable → this file → built-in default**.

```json
{
  "port": 4456,
  "host": "127.0.0.1",
  "dataDir": "./kitsune-data",
  "imagesDir": "/mnt/volume/kitsune/images",
  "diffsDir": "/mnt/volume/kitsune/diffs",
  "archiveDir": "/mnt/volume/kitsune/archive",
  "publicUrl": "https://review.example.com",
  "trustProxy": true,
  "sessionDays": 7,
  "github": { "apiUrl": "https://api.github.com" },
  "retention": { "olderThanDays": 30, "mode": "archive", "everyHours": 24 },
  "ui": { "view": "slider", "theme": "auto", "slider": { "start": 50 } }
}
```

| Setting | Meaning |
|---|---|
| `port`, `host` | Where the server listens (env `KITSUNE_PORT`, `KITSUNE_HOST`). |
| `dataDir`, `imagesDir`, `diffsDir`, `archiveDir` | Folders (env `KITSUNE_DATA_DIR`, `KITSUNE_IMAGES_DIR`, `KITSUNE_DIFFS_DIR`, `KITSUNE_ARCHIVE_DIR`). Relative paths are relative to the settings file. |
| `publicProject` | Name of a project anyone may view read-only without signing in (env `KITSUNE_PUBLIC_PROJECT`, flag `--public-project`). |
| `publicUrl` | Public address. PR statuses link here and cookies become `Secure` on https (env `KITSUNE_PUBLIC_URL`). |
| `trustProxy` | `true` when behind your own reverse proxy, so the real client IP is used (env `KITSUNE_TRUST_PROXY=1`). |
| `sessionDays` | How long a reviewer stays signed in (1 to 90, default 7). |
| `github.apiUrl` | GitHub API address, for GitHub Enterprise (env `KITSUNE_GITHUB_API_URL`). |
| `retention` | **Automatic clean-up**: the server itself archives (`"archive"`, needs `archiveDir`) or deletes (`"delete"`) the files of builds older than `olderThanDays`, once at start and then every `everyHours`. Same safety rules as `server prune`. No cron needed. |
| `ui` | Dashboard defaults for everyone (same keys as `ui` above). |

A misspelled or invalid setting stops the server from starting with a message that names it.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `KITSUNE_BROWSER_PATH` | check | Use an installed Chrome instead of Playwright's Chromium. |
| `KITSUNE_URL`, `KITSUNE_UPLOAD_TOKEN` | check `--remote` | Server address and upload token (CI secret). |
| `KITSUNE_REVIEW_URL` | check `--github` | Link on the GitHub status. |
| `KITSUNE_DATA_DIR`, `KITSUNE_PORT`, `KITSUNE_HOST` | server | Data folder, port, interface. |
| `KITSUNE_IMAGES_DIR`, `KITSUNE_DIFFS_DIR`, `KITSUNE_ARCHIVE_DIR` | server | Separate folders for files. |
| `KITSUNE_PUBLIC_URL` | server | Public address (see `publicUrl`). |
| `KITSUNE_GITHUB_TOKEN` | server | Token allowed to write commit statuses (never in a file). |
| `KITSUNE_GITHUB_API_URL` | server | GitHub API address. |
| `KITSUNE_TRUST_PROXY=1` | server | Read client IP from `X-Forwarded-For` (only behind your own reverse proxy). |
| `KITSUNE_TAB=1` | Storybook | Show the Kitsune tab inside Storybook (when your `main.js` opts in). |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `error … React is not defined` / `X is not defined` | A story has a code bug. Fix the story, rebuild Storybook, check again. |
| Everything is `changed` after a rebuild | Fonts or animations differ. Use `css` to freeze animations and wait for fonts with `delay`. |
| `Expected N snapshots but received M` (remote) | Upload was cut off. Run the check again. |
| Server will not start | Needs Node 22.13+. Run `nvm use` in the project. |
| Dashboard says "No build to review" | Run `kitsune check` first. |
