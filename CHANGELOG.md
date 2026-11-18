# Changelog

## Unreleased

### Added
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
