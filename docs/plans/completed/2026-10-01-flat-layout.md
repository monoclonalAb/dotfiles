# Flatten the repository layout and replace Stow with `links`

**Status:** Complete
**Scope:** every top-level tool folder, `bin/` and `lib/`, bootstrap/update
scripts, root and `docs/` guidance; the live links under `$HOME` on this Mac.

## Objective

Make the repository readable: one flat top-level folder per tool with undotted
names (`aerospace/aerospace.toml`, `zsh/zshrc`, `pi/extensions/`) instead of
Stow's mirrored `<tool>/.config/<tool>/` paths. A short [`links`](../../../links)
file says where each folder or file goes; [`bin/dotfiles-link`](../../../bin/dotfiles-link)
creates the symlinks. `$HOME` looks exactly as it does today: the same deployed
paths, real directories, one symlink per file.

## Non-goals

- Changing what is deployed, or where. Whole-folder links are out of scope: some
  loaders may not follow directory symlinks, and the mirrored layout already keeps
  app state local.
- Touching `.archive/` (it keeps the Stow layout) or rewriting completed plans.
- Committing or pushing; the user decides after reviewing the cutover.

## Context and constraints

- Built in a detached worktree, `~/dotfiles-flat`, so `~/dotfiles` (which every live
  link points into) keeps working until cutover. Nothing is committed.
- Migration helpers live outside the repository in `~/.local/state/dotfiles-flatten/`:
  `flatten.py` (rule-based `git mv` of every tracked package file, `git rm` of
  `.stowrc` and `docs/.stow-local-ignore`), `rewrite_paths.pl` (old path fragments to
  new), `check_links.py` (relative Markdown link and heading check), and
  `deploy.tsv` (old deployed path, old source, new source for all 238 files).
- `~/dotfiles` had one pre-existing uncommitted change, `pi/.pi/agent/settings.json`
  (Pi's own `lastChangelogVersion` write). `git mv` carries it to `pi/settings.json`.
- Moved files are two directory levels shallower, so relative paths that leave a
  tool folder changed: the three scripts that find the repository root, three test
  path computations and seven Markdown links. Absolute `/Users/eric/dotfiles/omp/...`
  allowlist paths in both `mcp.json` files changed too.

## Acceptance criteria

- [x] Every tracked tool file is flat; no `.config/`, `.pi/`, `.omp/` or `.local/`
      level remains outside `.archive/`.
- [x] `dotfiles-link` fixture tests pass; the real `links` applies cleanly to an
      empty home (240 links: the 238 existing files, `bin/dotfiles-link` and its test).
- [x] Rehearsal: in a throwaway clone Stowed the old way, the cutover steps repair
      every link, leave app-owned files alone and keep an uncommitted edit.
- [x] After cutover on this Mac, all 238 old deployed paths resolve to the matching
      new file, `dotfiles-link check` exits 0, and a new shell starts cleanly.
- [x] No live guidance refers to Stow except for restoring `.archive/` packages.

## Approach

1. Flatten in the worktree with `flatten.py apply` (renames staged).
2. Add `links`, `bin/dotfiles-link` and its tests; switch bootstrap and update to it.
3. Rewrite paths, fix depth-dependent paths, update docs (unstaged edits).
4. Run the source-only suites whose paths moved.
5. Rehearse the cutover against a throwaway clone and HOME.
6. Cutover (with the user): in `~/dotfiles`, run `flatten.py apply`, apply the
   worktree's content patch, run `bin/dotfiles-link apply`, verify, then remove the
   worktree.

## Progress

- [x] Steps 1-5, in `~/dotfiles-flat`.
- [x] Step 6, cutover on this Mac (2026-10-01), then the worktree was removed.

## Decisions

- **Top-level tool folders, undotted names, reviewed process:** chosen by the user.
- **Mirror folders instead of linking them whole:** keeps `$HOME` identical to the
  Stow deployment and the list short (17 lines). Rejected: per-app whole-folder links
  (need per-app state audits; directory symlinks can defeat loaders that check
  `isDirectory()` without following links).
- **`lib/` beside `bin/`:** `bin/.local/lib/` becomes `lib/`, linked to
  `~/.local/lib/`. `bin/workspace-context-mcp` keeps finding `../lib`.
- **Linker in Python 3.9 stdlib, `/usr/bin/python3`:** same interpreter as
  `herdr-review` and `terminal-open`, available once the Command Line Tools are in
  (bootstrap installs them before linking). Absolute links; atomic replacement.
- **No commits:** the result moves into `~/dotfiles` with the same rule-based script
  plus a patch of content edits, which also preserves uncommitted work there.
- **`stow` leaves the Brewfile's required list:** kept, commented out, for restoring
  `.archive/` packages.
- **Completed plans:** link targets were repaired to the moved files afterwards;
  their wording and recorded results are unchanged.

## Verification

- `python3 check_links.py .` in `~/dotfiles-flat` — **passed**: no broken link or
  heading outside completed plans (baseline before the move: one, in a completed plan;
  completed plans now have ten).
- Shell syntax commands from `docs/VERIFICATION.md` and `git diff --check` — **passed**.
- `dotfiles-link` fixture tests (9), `herdr-review`, `terminal-links`, `next-agent`,
  `spaces-env` unittest suites; `workspace-context-mcp` and task-launcher Node suites;
  Pi Node native suites (agent-stuff, quota-footer, quota-router, codex-fast,
  omp-anthropic-route) and agent-stuff typecheck; Bun `*.test.ts` suites for all ten
  listed extensions; theme-sync and task-launcher PTY smokes; launcher `--check` —
  **passed**, except one Bun test below.
- `bun test pi/extensions/quota-footer/*.test.ts` — **failed, pre-existing**: "native
  footer preserves colors/widths…" calls `sessionManager.getEntryCount`, missing in
  installed Pi 0.99.2's test double; the same test fails identically in the
  unflattened `~/dotfiles`.
- Rehearsal (`cutover.sh` on a clone of `~/dotfiles` HEAD plus its uncommitted edit,
  Stowed the old way into a temporary HOME seeded with app-owned files) — **passed**:
  238 repaired and 2 created; `verify_deploy.py` found all 238 old deployed paths
  resolving to the matching new file through absolute links; `dotfiles-link check`
  exit 0; app-owned files untouched; the uncommitted `settings.json` edit kept; the
  tree matched the worktree apart from that edit and an ignored OMP lock file.
- `env -i HOME=<empty> PATH=/usr/bin:/bin bin/dotfiles-bootstrap --check` — **passed**:
  the Links step reports 240 to create and counts it as missing.
- Cutover on this Mac (`cutover.sh ~/dotfiles "$HOME" …`) — **passed**: status and
  HEAD matched the rehearsal; 238 repaired, 2 created. `verify_deploy.py ~/dotfiles
  "$HOME"`: 238 checked, 0 wrong, 0 relative. `bin/dotfiles-link check -q`: exit 0.
  `gh/hosts.yml` and generated `herdr/config.toml` still local files; the
  `settings.json` edit kept. `script -q /dev/null zsh -ic exit` (real PTY): exit 0,
  no warnings, `ZDOTDIR` set (without a PTY, zsh cannot enable job control and
  gitstatus reports a failure; unrelated). `herdr config check`: ok. `theme status`:
  latte, Herdr server up.
- Independent audit by GPT-6 Astra (`pi -p --model openai-codex/gpt-6-astra
  --tools read,bash`, read-only instructions; report kept at
  `~/.local/state/dotfiles-flatten/astra-audit.md`) — **FAIL, then fixed**. It
  confirmed the cutover (238 paths, absolute links, real parents, app files local,
  `.archive/` unchanged, suites and the pre-existing quota-footer failure) and
  found: (1) links could escape `--home`, nest inside another listed link, or scan
  and prune through a directory link into the checkout; (2) create/repair/prune did
  not re-check targets after planning; (3) ignore rules were basename globs, not
  Stow's end-anchored regexes (`mcp-auth.json` was linkable; its `auth.json.bak`
  and `models-store.json.lock` rows were wrong: Stow never ignored those either);
  (4) no documented move for machines still on the Stow layout; (5) README promised
  `stale` output for a retired tool; (6) `pi/settings.json` also carries an
  `enabledModels` edit (present before the cutover, preserved, not ours); (7) the
  compact-ui README misstated settings ownership (pre-existing). Snapshots before
  and after showed the audit changed nothing in the repository or `$HOME`.
- Fixes for 1-5 and 7 in `bin/dotfiles-link`, its tests (15, all passing), README
  and the compact-ui README. The live check stayed at 240 links, nothing to
  review; the empty-home check passed; a sandbox of the documented one-time move
  (old Stow links, pulled tree, old updater's failing Stow run, then
  `dotfiles-link check`/`apply`) repaired all 238 paths.
- Focused Astra re-audit (report: `astra-reaudit.md`; snapshots showed it changed
  nothing) — **FAIL, then fixed**: confirmed findings 3-5 and 7 resolved (and
  corrected its own Stow table), 1 and 2 partial. New: (N1) directory symlinks
  pointing outside the checkout still let writes land outside home; (N2) a parent
  swapped between planning and apply could redirect `makedirs`, repair or removal
  into the checkout; (N3) overlapping mirrors pruned a link twice and exited 1;
  (N4) the docstring claimed the final race is reported. Fixes: planning rejects
  any directory symlink below home and targets inside the checkout; `execute()`
  walks from home with `O_NOFOLLOW|O_DIRECTORY` and uses `mkdir`/`symlink`/
  `readlink`/`rename`/`unlink` relative to those directory descriptors; pruning
  is de-duplicated; the docstring and QUALITY name the remaining undetected
  final-instant race. Tests: 20 passing, including deterministic parent swaps.
  Live check, empty-home check, and the one-time-move sandbox passed again.
- Final Astra pass (report: `astra-final.md`; snapshots showed it changed nothing)
  — N1-N4 **resolved**; new **FAIL** items, then fixed: (F1) a mirror at `~/`
  scanned into the checkout and pruned its links; (F2) on the case-insensitive
  disk `~/REPO/x` passed the string-based containment check; (F3) `execute()`
  opened home by path after planning; (F4) a parent moved after being opened
  could receive the write; (F5) a permission error mid-apply crashed without a
  summary; plus docs overstating the guarantee. Fixes: containment by filesystem
  identity; stale scans skip the checkout and its candidates; home is pinned
  before planning and verified before applying; each parent is verified in place
  before and after its change, which is undone if it had moved; per-target error
  reporting; docstring, ARCHITECTURE and QUALITY state the residual race.
  Tests: 26 passing. Live check, empty-home check and one-time-move sandbox
  passed again.
- Astra confirmation pass (report: `astra-v4.md`; snapshots showed it changed
  nothing) — **PASS WITH ISSUES**: F1-F5 resolved, normal use and the one-time
  move pass. Two minor items, fixed afterwards and covered by tests (29 passing)
  but not re-audited by Astra: targets differing only in case are now an error
  and stale links are de-duplicated by identity; repair and removal now undo
  themselves like creation when their parent moved, matching the docs. Live
  check, empty-home check and one-time-move sandbox passed again.
- Follow-up triage (Opus 5.5): `bun test pi/extensions/quota-footer/*.test.ts` —
  **fixed, passed 95/95**: the test's fake session manager lacked the
  `getEntryCount`/`getSessionId`/`getLeafId` calls Pi 0.99.2's footer makes; test
  only, extension unchanged. `PYTHONDONTWRITEBYTECODE=1 python3
  herdr/plugins/next-agent/pty-smoke.py` — **passed** (isolated HOME, config and
  socket; live server unaffected), closing the one suite no one had run after the
  move. Ten completed-plan link targets repaired, and the pre-existing
  `#clipboard-images` fragment pointed at "Using the form", where that behaviour
  is documented: `check_links.py` reports no broken link anywhere.

## Risks and recovery

- **Window between moving files and relinking:** old links dangle for a few seconds.
  New shells or app reloads in that window may fail; running apps are unaffected.
  Recovery: `bin/dotfiles-link apply` from `~/dotfiles`.
- **Rollback after cutover:** `git -C ~/dotfiles checkout -- .` is *not* safe while
  other edits exist. Instead reverse the renames with the saved map
  (`deploy.tsv`, columns two and three), restore `.stowrc`, then
  `brew install stow && stow -R -t "$HOME" */` repairs the old links.
- **Concurrent edits in `~/dotfiles`:** the content patch may not apply to a file
  edited since the worktree was made. `git apply --check` first; stop and reconcile.

## Outcome

The repository is flat and `links` plus `bin/dotfiles-link` replace Stow; `$HOME`
has the same deployed paths as before, now as absolute links. The change is
uncommitted in `~/dotfiles` for the user to review. Until it is committed, the
helpers and `uncommitted-before-cutover.patch` in `~/.local/state/dotfiles-flatten/`
support the rollback above; delete that directory afterwards. Accepted limit: a
process deliberately swapping a link or moving a directory in the instant between
a check and the system call is not detected (documented in the script and
QUALITY).
