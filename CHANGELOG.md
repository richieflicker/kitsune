# Changelog

## 0.6.0

### Added
- **Branch dropdowns on the request form.** The worker reports the branches on `origin`; the form offers *Your branch* and *Merge into* as selects, shows the branch's newest commit and how far ahead it is, and has a **Fetch** button that makes the worker run `git fetch`. No commit to type, and no Bitbucket token: the worker uses the git access its machine already has. New API: `GET /api/v1/branches`, `POST /api/v1/branches/refresh`, `PUT /api/v1/worker/branches`; a request can be created without `sha`.
- **Create pull request button** on approved requests: opens Bitbucket Server / Data Center, Bitbucket Cloud, GitHub or GitLab with source and target filled in (or your `branches.prUrl`). A request now carries `prLink`.
- The worker tells the server which commit it built, so the request always shows what was really checked; resubmitting uses the branch's newest commit when none is given. The worker now checks every 10 seconds by default.
- **Build report on every request.** Steps with their times (Fetch, Checkout, Install, Build Storybook, Capture, Upload), a live progress bar while screenshots are taken, and a summary of stories, viewports, browsers and screenshots checked with unchanged / new / changed / could not render. Stories that could not render are listed with their error. The last five runs of a request are kept, with a log you can copy. New API: `POST /api/v1/requests/:id/progress` (worker), `GET /api/v1/requests/:id/runs`; a request now carries its latest `run`.
- **Plain-English failures.** When a run breaks, the failed step turns red and Kitsune says why and how to fix it: branch not on the remote, git login, dependency install (peer conflicts, registry), Storybook build, missing build command or output folder, browser not installed, no stories, upload token rejected, server unreachable, timeouts. Tokens and credentials are removed from every line first.
- **`kitsune check` prints the same steps** with times, a live capture bar and the same explanation on failure.
- **`kitsune worker`: builds requests for you.** Run it on any machine that has the repository (a build box or a laptop). It watches the shared server for open requests, fetches the branch, builds Storybook in a throw-away worktree, runs the check, uploads it and moves the request to in review. If the build fails, the request goes back to the contributor with the reason (new `buildFailed` step, also a Cliq alert). Needs `KITSUNE_REVIEW_TOKEN` (an admin's personal token) and `KITSUNE_UPLOAD_TOKEN`.
- **Four eyes on request approval.** Whoever sent a request or built it (started or finished the build) cannot approve it; another reviewer or admin has to. Asking for changes or rejecting is still allowed. The dashboard hides the Approve button and says why. One-person teams can switch it off with `KITSUNE_ALLOW_SELF_APPROVAL=1`.

### Docs
- README has a **Features** list and a full section on **the worker**: why it is needed, how it works step by step, and how to set it up.
- New **docs/SETUP-FOR-AGENTS.md** (also inside `llms-full.txt`, linked from `llms.txt`): tells an AI assistant to ask which features the person wants (and a few questions about their Storybook, Node, git host, CI and team), then gives setup and verification steps for each of the ten features.
- README now opens with a 50-second demo of all four roles and has screenshots for each role and for the Storybook panel; `llms-full.txt` is built without pictures.

### Fixed
- Reviewers and admins could not open **Builds** from their home page (Requests / Overview): the address changed but the page did not. Navigation now always follows the address.

## 0.5.0

### Added
- **Admin Overview.** Admins open on an Overview page: requests needing action, builds with changes waiting, people by role, whether Zoho Cliq alerts are on, the request pipeline by state, recent activity and the latest builds. New admin-only API `GET /api/v1/overview`.
- **Users page for admins.** Add a person with a role (token shown once), change a role, or remove someone, from the dashboard instead of the CLI. New admin-only API: `GET/POST /api/v1/users`, `PUT /api/v1/users/:name/role`, `DELETE /api/v1/users/:name`.
- **Role home pages.** After sign-in, contributors land on "My requests", reviewers on "Needs review", admins on Overview; viewers land on builds. Requests have a "Needs my attention" filter, and reviewers and admins get a count per state. The sign-in page says what the token looks like and where to get one.
- **Request to build link.** A request shows "See the changes" for the uploaded build of its commit (read-only for contributors and viewers).
- **Impact scoring on the shared server.** Every changed snapshot gets a Minor / Moderate / Major level (same rules as local `kitsune check`), stored with the build. Existing databases are upgraded automatically; builds made before this keep an estimated badge.
- **Impact badges and sort** in the review list, and a top bar with role-aware tabs and a name + role badge.
- **Parallel branch builds**: start several Build & review runs and they queue, with up to `branches.concurrency` (default 2, max 4) running together. Each build has its own review. Asking for a pair that is already queued or running returns that build, and two builds that need the same commit build it once. The Branches page lists every build with its state.
- **Docs refreshed** (README, COMMANDS, `llms.txt`, `llms-full.txt`): roles and review requests, dashboard pages, impact scoring and its config, Cliq alerts, `kitsune publish`, new environment variables.

## 0.4.0

### Added
- **`kitsune publish`**: publish to Verdaccio (or npm) from your own machine, with the checks that make "approved" mean something. Rehearses by default (`--yes` to publish). Refuses a dirty tree, a version the registry already has, a private package, or a missing login. With `--request <id> --server <url>` it only publishes an approved request on the approved commit, then marks the request published. Tokens come from your environment or your own `npm adduser`, are never stored, and are scrubbed from error output.
- **Zoho Cliq alerts** for review requests: submitted, ready to review, approved, changes requested, rejected, resubmitted, PR created, published. Admins set the Cliq incoming-webhook address and pick the events under **Settings** in the shared dashboard (or set `KITSUNE_CLIQ_WEBHOOK` on the server). Only https Zoho Cliq addresses are accepted, the key is never shown again, and a failed alert never blocks a review.
- **Review requests** on the shared server. A contributor submits a branch (exact commit, title, note); admins and reviewers move it through `open` → `building` → `in_review` → `approved` → `pr_created` → `published`, or `rejected` / `changes_requested` (a reason is required, and only the requester can resubmit). Each step is checked against the person's role and recorded in an append-only history. Contributors see only their own requests. API: `GET/POST /api/v1/requests`, `GET /api/v1/requests/:id`, `POST /api/v1/requests/:id/:action`. **Requests** screen in the shared dashboard: contributors submit and track their requests; reviewers and admins work the queue with buttons that match their role. Viewers and contributors no longer see Approve / Reject on builds.
- **Roles on the shared server**: `viewer`, `contributor`, `reviewer`, `admin`. Existing personal tokens and the shared review token stay `reviewer`, so nothing changes until you assign roles. `kitsune server add-user --role`, `set-role`, `list-users`. Approve / reject now needs the `reviewer` or `admin` role (403 otherwise); `GET /api/v1/session` reports the role and what it can do. Roles are read on every request, so changes apply immediately, and the last admin cannot be removed.
- **Visual changes panel** in the Storybook bottom bar (next to Controls / Actions), for Storybook 8 and 9+. Shows the impact level, how much of the page changed, how many areas, and before / after / difference thumbnails for the open story, with a viewport and browser picker. Reads the new `GET /api/impact?story=<id>` from `kitsune serve`.
- **Impact scoring**: every compared story now carries `impact` (`none`, `minor`, `moderate`, `major`), `bboxRatio` (how much of the page the change spans) and `regions` (separate changed areas). A page that changed size is always `major`. Thresholds can be tuned with the new `impact` config key.

## 0.3.0

### Added
- **Branches view** in the local dashboard (`kitsune serve` → ⎇ Branches). Pick a local base branch and a remote branch, fetch (download only, never merges) and see commits, files changed and the merge-base.
- **Build & review**: builds Storybook for both branches in temporary git worktrees (your folder is never touched), screenshots every story and opens the usual review screen. Screenshots are cached per commit.
- **Create PR**: once every change is approved, opens your host's "new pull request" page with source and target filled in. Recognises Bitbucket Cloud, Bitbucket Server / Data Center, GitHub and GitLab; `branches.prUrl` covers other hosts. No token needed.
- `kitsune init-hook`: installs a git pre-push hook that runs `kitsune check` (Husky-aware).
- Merge-base baselines: a branch is compared with the default-branch approval nearest to where it was cut (`--base-branch`, `KITSUNE_BASE_BRANCH`).
- New config section `branches` (`allowed`, `buildCommand`, `output`, `install`, `prUrl`).

### Fixed
- Rejecting a story that was already approved is now refused, in both local and shared-server mode.
- Local dashboard server: foreign `Host` headers are refused (DNS rebinding), request bodies are capped at 1 MB, and malformed URLs return 400 instead of crashing.
- Static Storybook server: path traversal into sibling folders and malformed URLs are refused.
- Branch builds and Create PR no longer fail with `spawn /bin/sh ENOENT` when the project path goes through a symlink (for example macOS `/var` → `/private/var`).

### Notes
- Firefox and WebKit capture is implemented but has not been verified on a large Storybook.
