# Setting up Kitsune Review for a project (for AI assistants)

Read this when a person asks you to install, set up or explain Kitsune Review in their project.

## Step 0: ask before you set anything up

Kitsune has several independent features. **Do not guess and do not set everything up.** Ask the person which ones
they want (a multiple-choice question is ideal; allow several answers), and ask the few questions in "What to find out".
Then set up only what they chose, in the order shown under "Order of work".

### The features to offer

| # | Feature | What the person gets | Needs |
|---|---|---|---|
| 1 | **Local review** | `kitsune check` screenshots every story and compares with approved baselines; `kitsune serve` is a dashboard to approve or reject. Approvals live in git. | A built Storybook |
| 2 | **Storybook tab and panel** | A Kitsune tab and a "Visual changes" panel inside Storybook (8, 9, 10). | 1 |
| 3 | **Pre-push hook** | `git push` is blocked while changes are unapproved. | 1 |
| 4 | **Cross-browser** | Chromium, Firefox and WebKit, each with its own baselines. | 1 |
| 5 | **Per-story rules and impact** | Overrides, masks, thresholds, and Minor / Moderate / Major impact badges. | 1 |
| 6 | **CI check on pull requests** | A `visual-review` status on GitHub pull requests; `kitsune check --github`. | 1, CI |
| 7 | **Shared review server** | Web approvals for a team, per-branch baselines, four roles (viewer, contributor, reviewer, admin), review requests, an admin Overview and Users page. | Node 22.13+, a machine to host it |
| 8 | **Automatic builds (the worker)** | Contributors send a request; a worker builds the branch, runs the check and uploads it. No one runs `kitsune check` by hand. Works without CI. | 7, a machine with the repo |
| 9 | **Zoho Cliq alerts** | Messages to a Cliq channel when requests are sent, built, approved and so on. | 7 |
| 10 | **Publish from an approved request** | `kitsune publish --request` publishes to Verdaccio or npm only if the request is approved and the commit matches. | 7 |

### What to find out (ask only what matters for the chosen features)

- **Storybook:** version, and how it is built (`storybook build`, a monorepo script, a custom command). Where does the build write to?
- **Node:** version on the machine that will run Kitsune (must be 22.13+ for the server and worker).
- **Git host:** GitHub, GitLab, Bitbucket Cloud, or Bitbucket Server / Data Center. This decides the "Create pull request" link and the CI options.
- **CI:** is there CI the team can configure? If not, feature 6 is not possible and the worker (8) is the way to get automatic checks.
- **Team size:** one person? Then `KITSUNE_ALLOW_SELF_APPROVAL=1` is reasonable (the four-eyes rule would otherwise stop them approving their own work).
- **Where the server runs** (7): which machine, which port, is there a reverse proxy with HTTPS? Then `KITSUNE_PUBLIC_URL`.
- **Where the worker runs** (8): a machine that has a clone of the repo, git access to it (SSH key or saved login), Node, the repo's dependencies, and a browser.
- **Registry** (10): Verdaccio or npm, and the registry address.

## Order of work

1 → (2, 3, 4, 5) → 6 → 7 → 8 → (9, 10). Check each step works before starting the next.

## Rules for you

- **Ask first.** Offer the list above. Set up only what was chosen.
- **Never invent tokens or put them in files.** Upload tokens, review tokens, the GitHub token and the publish token are passed as environment variables or shown once by the CLI. Kitsune never reads secrets from `kitsune.config.js`. Do not commit them. Tokens are shown once when created; tell the person to save them.
- **Do not publish, merge or push for the person** unless they ask. The worker never pushes or merges.
- **Verify every step** with the command shown, and report the real output. Do not say "done" without running it.
- If something fails, the run report explains it (see "When something fails"). Read it before changing anything.

## Feature 1: local review

```bash
npx storybook build                 # produces storybook-static/
npx playwright install chromium     # or set KITSUNE_BROWSER_PATH to an installed Chrome
npx kitsune init                    # writes kitsune.config.js, adds kitsune:* scripts and the addon
npx kitsune check                   # first run: every story is "new" and auto-approved
npx kitsune check                   # second run: all unchanged
npx kitsune serve                   # review dashboard at http://127.0.0.1:4455
```

Set `storybook.dir` (and viewports) in `kitsune.config.js`. Commit `.kitsune/baselines/` and `.kitsune/approved.json`; ignore `.kitsune/current/`.
**Verify:** the second `kitsune check` reports everything unchanged and exits 0.

## Feature 2: Storybook tab and panel

`kitsune init` adds the addon to `.storybook/main.*` when `addons` is a plain array; otherwise it prints the line to add. Set `KITSUNE_TAB=1` to show the tab. The panel works against `kitsune serve` (local mode); it does not work against the shared server yet.

## Feature 3: pre-push hook

`npx kitsune init-hook` (add `--warn` to warn instead of block). Uses `.husky/pre-push` when Husky is present. Skip once with `KITSUNE_SKIP=1 git push`.

## Feature 4: cross-browser

`npx kitsune browsers` lists and installs the browsers. Configure `browsers` in `kitsune.config.js`. Each browser keeps its own baselines, so the first run in a new browser creates new baselines.

## Feature 5: rules and impact

Per-story `overrides` (skip, masks, thresholds, viewports) and the `impact` setting are in `kitsune.config.js`; see COMMANDS.md for every key.

## Feature 6: CI check on pull requests (GitHub)

In CI after the Storybook build: `npx kitsune check --github` with `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_SHA` set; add `--fail` to fail the job when changes need review. With the shared server (7), CI uploads instead: `kitsune check --remote` with `KITSUNE_URL` and `KITSUNE_UPLOAD_TOKEN`, and the server posts the status (`KITSUNE_GITHUB_TOKEN` on the server). In CI use `fetch-depth: 0` so the merge base can be found.

## Feature 7: shared review server

```bash
npx kitsune server create-project web --default-branch main --data ./kitsune-data
# prints an UPLOAD token (CI secret) and a REVIEW token. Shown once.

KITSUNE_PUBLIC_URL=https://kitsune.example.com \
  npx kitsune server start --data ./kitsune-data --port 4456
```

Give each person their own token and role: `npx kitsune user add "Asha"` or `kitsune server add-user <project> <name> --role viewer|contributor|reviewer|admin`; admins can also manage people on the dashboard Users page. Keep the server behind a reverse proxy with HTTPS (`KITSUNE_TRUST_PROXY=1` only behind your own proxy). One-person teams: `KITSUNE_ALLOW_SELF_APPROVAL=1`.
**Verify:** open the address, sign in with a personal token, and see the Builds page.

## Feature 8: automatic builds (the worker)

The server only stores builds and approvals; it has no copy of the code and no browser. The worker is the piece that has the repository. Create an **admin** token for it (`kitsune server add-user <project> worker --role admin`) and use the project's upload token.

On the machine with a clone of the repo (git access, Node, dependencies, a browser installed):

```bash
KITSUNE_REVIEW_TOKEN=<admin personal token> \
KITSUNE_UPLOAD_TOKEN=<project upload token> \
npx kitsune worker --server https://kitsune.example.com
```

Keep it running (a service, `pm2`, `tmux`, a systemd unit). Try it once with `--once`.
If Storybook is not built the default way, set `branches.buildCommand` (use `{out}` for the output folder), `branches.output`, `branches.install` (`false`, or a command) in `kitsune.config.js`. If the host is not auto-detected or the web address differs from the git address, set `branches.prUrl`.
**Verify:** submit a request from the dashboard; the worker log shows Fetch, Checkout, Install, Build, Capture, Upload, and the request moves to "In review".

## Feature 9: Zoho Cliq alerts

Create an incoming webhook for the channel in Cliq, then an admin pastes it under Settings, or set `KITSUNE_CLIQ_WEBHOOK` on the server. Only https Zoho hosts are accepted. Choose which events to announce under Settings. Test with the Send test message button.

## Feature 10: publish from an approved request

`KITSUNE_REVIEW_TOKEN=<admin token> KITSUNE_PUBLISH_TOKEN=<registry token> npx kitsune publish --request <id> --server <url>` rehearses (`npm publish --dry-run`); add `--yes` to publish. It refuses unless the request is approved, the commit matches, the tree is clean and the version is free.

## When something fails

Every run (worker or `kitsune check`) is shown as steps with times. The failed step is marked and a short explanation says why and how to fix it. The common causes: the branch was not pushed, git login failed on the worker machine, dependency install failed (peer conflict, registry unreachable), Storybook's own build failed, the build command or output folder is wrong (`branches.buildCommand`, `branches.output`), the browser is not installed (`npx playwright install chromium`), no stories were found (`include` / `exclude`), the upload token was rejected, the server cannot be reached, or a step timed out. Run the same command by hand on that machine to reproduce.
