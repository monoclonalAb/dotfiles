# Pi Tasks launcher refresh

**Status:** Complete (source change; plugin files are linked, so `C-a t` uses it on next open)
**Scope:** `herdr/plugins/task-launcher/` and its owning docs (`docs/ARCHITECTURE.md`, `docs/VERIFICATION.md`); installed npm Pi 1.2.0 and Herdr 0.9.1 as read-only dependencies.

## Objective

`C-a t` keeps working as before, but: kept task files are cleaned up, drafts
survive Esc/close, naming is fast and never bypasses the Anthropic route, a crashed
Pi resumes its own conversation, Pi no longer asks to trust every new task folder,
and the form offers modern worktree options (start from latest default branch,
copy uncommitted changes, `.worktreeinclude`, `@file`/`/template` completion,
previous-task history).

## Non-goals

- Starting Pi before naming finishes (placeholder folder names), automatic branch
  or worktree deletion, repository setup scripts, other agents.
- Changing Pi extensions, the `pi` wrapper, Herdr patches, or Pi's trust store.

## Context and constraints

- Audit evidence (2026-10-13): 27 kept request files, 22 for deleted worktrees and
  one leaked image directory; `trust.json` held one entry per task folder; Pi's
  Anthropic login is OAuth/subscription, so naming with Claude bypassed
  `omp-anthropic-route`; the old suite passed on Pi 1.2.0.
- Plugin files are per-file links; all changes stay inside existing files so no
  `dotfiles-link apply` is needed.

## Acceptance criteria

- [x] Closed/killed runners leave no request or image files behind; stale ones are swept when the popup opens.
- [x] Esc/close/hangup keep the draft (text and images) for the repository; success clears it.
- [x] Naming uses `naming_model`, else Pi's default model, else the selected one, skipping route-only Anthropic OAuth models; failure starts with a visible placeholder.
- [x] Pi starts with `--session-id <task id>`; retry resumes an existing conversation.
- [x] `--approve` / `--no-approve` follows the source checkout's saved trust decision; unknown decisions still ask.
- [x] Start-from, copy-changes, `.worktreeinclude`, completion and history work in tests.
- [x] Node suite and PTY smoke pass; docs updated.

## Decisions

- **Trust inheritance, not trust writes:** read Pi's public `ProjectTrustStore` for
  the source (then main) checkout and pass `--approve`/`--no-approve`. This reverses
  the 2026-09-06 "never `--approve`" choice at the user's request, but only for a
  decision the user already saved. Unknown stays Pi's prompt. `trust.json` is not modified.
- **Naming model:** config `naming_model` → Pi default model → selected model,
  skipping direct-Anthropic OAuth (mirrors `omp-anthropic-route`'s own test). 15 s
  deadline. Failure now starts the task as `task/untitled-task-<id>` with a visible
  warning instead of blocking. This is still not a truncated prompt dressed as a summary.
- **Request lifecycle:** `runTask` owns deletion: normal exit or hangup deletes, `q`
  at the retry prompt keeps. A `.runner` PID file lets the popup sweep remove requests
  whose runner died, whose checkout is gone, or that are over 30 days old.
- **Resume:** `--session-id <task id>` plus a `started` flag persisted before the
  first spawn. Later runs look up the session with Pi's `SessionManager.findById` and
  never resend the task into an existing conversation.
- **Drafts:** written only when the popup closes (Esc, Ctrl+D, double Ctrl+C, or a
  SIGHUP/SIGTERM), never while typing. Ctrl+C copies a non-empty draft to the
  clipboard first, like the user's Pi editor.
- **Start from latest:** opt-in. The fetch updates only `refs/remotes/origin/<branch>`
  and runs without a controlling terminal, so SSH cannot prompt into the popup.
- **Copy changes:** only onto the current commit. An all-or-nothing `git apply` of a
  binary diff, then APFS clones of untracked files (at most 5000). The source is only read.
- **`.worktreeinclude`:** Claude Code's convention. Paths that are both listed and
  ignored, from the main checkout, are cloned with `cp -c -R -p` in the Pi tab before
  the first start. Never overwritten; failures go to a Herdr notification.
- **Skipped:** instant start (placeholder folder names) and automatic branch cleanup
  (destructive; Herdr's `C-a C-g` exists).

## Verification

From the repository root, 2026-10-13, npm Pi 1.2.0, Node 24.19.0, Herdr 0.9.1-dotfiles:

- `node --test herdr/plugins/task-launcher/*.test.mjs` passed 88/88 (68 before).
  New coverage: runner hangup/resume/new/close, request sweep, drafts/history/config,
  `.worktreeinclude`, copy changes (including binary, deleted, staged, untracked),
  latest start with a local `origin`, trust flags, naming-model choice, real-SDK
  trust and session lookups, Pi CLI parsing of `--session-id`/`--approve`.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/plugins/task-launcher/pty-smoke.py`
  passed. It covers Esc saving the draft and reopening restoring it, and submit with
  a session ID and no leftovers. It also closes a running Pi tab's PTY. With the
  hangup handler removed in a temporary copy, this check failed with "Closed tab left
  its task request", so it detects the original bug.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh herdr/plugins/task-launcher/launch.sh --check`
  passed. `sh -n` passed. `HERDR_CONFIG_PATH=herdr/config.base.toml herdr config check` passed.
- A read-only run against real state: beacon and dotfiles resolve to trusted
  (`--approve`). With Opus or Astra selected, naming resolves to
  `lithosai/deepseek-ai/DeepSeek-V4.1-Flash`. Seven global templates and `fd` were found.
  The sweep, run on a temporary copy of the real requests folder, would remove exactly
  the 22 orphaned requests and keep the 5 with existing checkouts.
- Not run: native Herdr popup, a real naming request (costs provider usage), a real
  Pi start, or a real fetch from a remote.

## Risks and recovery

- The first `C-a t` after this change deletes the 22 orphaned request files; they
  belong to deleted worktrees and nobody can use them.
- Herdr may cache the manifest's popup height (24 → 28 rows) until the plugin is
  re-enabled or Herdr restarts. Content scrolls either way.
- Revert with Git: the request format is backward compatible both ways for text,
  model and images.

## Outcome

Implemented as above. Remaining gap: a native Herdr check and a real end-to-end task
start were not run.
