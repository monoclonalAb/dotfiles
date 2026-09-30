# Reorder worktree Spaces within their repository

**Status:** Complete (source/build; installation is an operator step)
**Scope:** Herdr pinned patch (client sidebar/input, keybinding config), base config, installer comment, owning docs. Isolated source/build: `/tmp/herdr-reorder.ip2PaV/`.

## Objective

Let the user change the order of a repository's linked worktree Spaces in the
Spaces tree, by mouse drag and by keyboard, and have that order persist in the
Herdr session like any other Space reorder.

## Non-goals

- No server/protocol change: the stock `workspace.move_block` API already persists order.
- No change to repository (group) reordering or legacy two-panel (`inline_agents = false`) drag rules.
- No installation, server restart/handoff, config regeneration or agent-pane input.

## Context and constraints

- Upstream 0.9.1 rejects dragging a linked worktree (`workspace_drag_moves_parent_worktree_as_one_block_and_rejects_child`); the tree lists the main checkout first, then linked worktrees in session (snapshot) order.
- The tree positions a repository at its earliest visible member, so a reorder must not shift neighbouring top-level entries or Spaces hidden by spaces-env.
- Patch pinned by `bin/.local/bin/install-herdr-focus` to `065ef9d6a531c49fb8bee7e818ef837065b21ee9`.

## Acceptance criteria

- [x] In tree mode a linked worktree row can be dragged; drop slots are limited to its visible linked siblings and the indicator is drawn in-group.
- [x] `keys.move_worktree_up` / `keys.move_worktree_down` move the focused linked worktree one place, clamped at the ends; unset by default, bound to `C-a K` / `C-a J` in the base config.
- [x] Moves are one `workspace.move_block` keeping the group anchored; hidden Spaces and other entries keep their relative order.
- [x] Native tests cover drag, keys, anchoring, hidden Spaces and no-op cases; installer suite and patch preflight pass.
- [x] Owning docs match; activation remains an explicit operator step.

## Approach

1. Shared `tree` helper computing the desired block move for a linked worktree.
2. Mouse: allow the drag in tree mode, in-group drop slots from the tree document, dispatch to the helper on release.
3. Keys: new keybinding pair through config, keybind resolution, help, default-config comment and config reference.
4. Tests, build-only installer run, regenerate patch, docs.

## Progress

- [x] `src/client/shell/tree.rs`: `linked_worktree_siblings`, `worktree_move_method`, `worktree_step_method`, `worktree_drop_slots`.
- [x] `mouse.rs` / `endpoint_navigation.rs`: tree-mode linked worktrees are draggable (only with a visible linked sibling); drop targets come from the tree document; release dispatches to the helper. Legacy mode is untouched.
- [x] `actions.rs`, `config/{keybinds,model}.rs`, `input/{keybindings,keybind_help}.rs`, `main.rs`, `config-reference.json`: new keys (unset by default).
- [x] Five native tests in `src/client/shell/tests/tree.rs`.
- [x] Canonical patch regenerated as `git diff 065ef9d` of the isolated source; base config, README, installer comment updated.

## Decisions

- **Client only:** the move is a stock `workspace.move_block`, so only the client half changes; it activates on the next `herdr` attach after install, without a server handoff.
- **Anchored block:** the visible group is rewritten as one block before the first non-member after its earliest member. Single-Space moves could make a repository jump when its earliest member moved.
- **Clamp, not wrap:** a vertical list end is a natural stop; tab moves wrap, but wrapping a worktree to the top is surprising.
- **Main checkout stays first:** the tree already pins it; dragging it still moves the whole repository (upstream behaviour).
- **Keys `C-a K` / `C-a J`:** free in the base config (upstream's shift+j/k swap defaults are overridden there) and match upstream's shift-means-move convention.
- **Patch format:** kept git's standard blank context lines (`" "`), as the existing 52 do, so `git diff 065ef9d` reproduces the patch exactly.

## Verification

Rust commands ran in `/tmp/herdr-reorder.ip2PaV/source` with `ZIG=/opt/homebrew/bin/zig` (0.16.0) and Rust 1.96.1.

- `git diff 065ef9d HEAD` on the pristine patched checkout — **passed**: byte-identical to the previous canonical patch, validating regeneration.
- `cargo test --release --bin herdr -- client::shell::tests::tree` — **passed**, 23 tests (5 new). Mutation checks (disable the tree drag gate; drop the anchor; allow a lone worktree) made the new tests fail, then sources were restored.
- `cargo test --release --bin herdr -- config::keybinds config::model input:: api::schema --test-threads=1` — **passed**, 466 tests.
- `python3 scripts/config_reference_check.py` (upstream reference/model check) — **passed**.
- Full `cargo test --release --bin herdr` — **not a valid signal here**: the PTY actor tests abort the harness with SIGPIPE, and 48 `app`/`config::io`/`detect::manifest`/… tests fail from a poisoned-mutex cascade. The same 52-test set fails identically (4 pass / 48 fail) on the unmodified patched source, so it is pre-existing and unrelated.
- `cargo fmt --check` — no new diffs from this change (18 pre-existing patch diffs before and after).
- Candidate patch: 27 of 37 prior sections byte-identical, 10 updated, 1 added (`actions.rs`); `git apply --check`, apply, reverse check on a fresh pinned checkout, and file comparison against the tested source — **passed**. `git diff --check 065ef9d` in the source — **passed**.
- `ZIG=/opt/homebrew/bin/zig sh bin/.local/bin/install-herdr-focus --build-only /tmp/herdr-reorder.ip2PaV/herdr-build-only` — **passed**: fresh fetch, patch preflight, release build, 345 focused tests (2 stock manual profiles ignored), including the 5 new tests and upstream's legacy child-rejection test. Built `0.9.1-dotfiles.ee34d8cce4be`; installed binary untouched.
- Staged config (tracked base + pure `herdr_theme`, frappe/1.0 from state) — `config check` with the build-only binary **passed** (`config: ok`); a deliberate `prefix+shift+h` clash was reported, so `ok` means no key conflict. The installed binary reports the two keys as unknown and ignores them (expected until install).
- Throwaway isolated end-to-end (`/tmp/herdr-reorder.ip2PaV/e2e.py`: own HOME/socket/server, real git repo with three linked worktrees, build-only client in its own PTY) — **passed**: `C-a K` / `C-a J` stepped and clamped; SGR mouse drags reordered within the repository and clamped past its end; the in-group indicator rendered; focus and top-level order were unchanged; the sidebar re-rendered the new order. Fixture server stopped; the user's server was never contacted.
- `sh -n bin/.local/bin/install-herdr-focus`, base-config `tomllib` parse — **passed**. Repository `git diff --check` flags only 2 new blank context lines inside the patch (same encoding as the existing 52).
- Installation, `theme apply`, reload, reattach — **not run**.

## Risks and recovery

- Until `install-herdr-focus` runs, a `theme apply` would put the new keys into the generated config, and the installed binary ignores them with an unknown-key warning. Install first, then `theme apply` (or `C-a R`), then reattach with `herdr`.
- Revert the patch and base-config lines to restore upstream behaviour; no persisted state format changes, and orders already saved remain valid.

## Outcome

Source/build complete. Linked worktrees can be reordered within their repository by dragging in the Spaces tree or with `C-a K` / `C-a J`; the order persists as ordinary session Space order. Activation: `install-herdr-focus`, then `theme apply`, then a fresh `herdr` attach (client-only change; no server handoff needed).
