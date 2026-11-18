# Changelog

## Unreleased

- **Users page for admins.** Add a person with a role (token shown once), change a role, or remove someone, from the dashboard instead of the CLI. New admin-only API: `GET/POST /api/v1/users`, `PUT /api/v1/users/:name/role`, `DELETE /api/v1/users/:name`.
- **Impact badges and sort** in the review list; the top bar has role-aware tabs.

### Added
- **Parallel branch builds**: start several Build & review runs and they queue, with up to `branches.concurrency` (default 2, max 4) running together. Each build has its own review, so you can open and approve a finished one while the others still build. Asking for a pair that is already queued or running returns that build, and two builds that need the same commit build it once. The Branches page now lists every build with its state.

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
