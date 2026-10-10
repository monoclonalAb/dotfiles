# Herdr

**Status:** Operator guide. Herdr is the primary terminal workspace manager: it
holds Spaces (one per repository worktree), tabs and panes, and shows which agent
conversations need attention. tmux remains as a fallback.

Where things live:

- [`herdr/config.base.toml`](../herdr/config.base.toml): settings and keys. The
  live `~/.config/herdr/config.toml` is **generated** from it by `theme apply`;
  never edit the generated file.
- [`herdr/patches/`](../herdr/patches/) and
  [`install-herdr-focus`](../bin/install-herdr-focus): the patched binary.
- [`herdr/plugins/`](../herdr/plugins/): `next-agent`, `spaces-env`,
  `pr-status` and [`task-launcher`](../herdr/plugins/task-launcher/README.md).
- Ownership details: [`ARCHITECTURE.md`](ARCHITECTURE.md#3-herdr-source-and-plugin-customisation).

## Install

Commands here install software or change live state. Agents: run them only
when asked.

This repository builds Herdr from upstream v0.9.1
(`065ef9d6a531c49fb8bee7e818ef837065b21ee9`) plus
[`herdr-0.9.1-focused-pane.patch`](../herdr/patches/herdr-0.9.1-focused-pane.patch),
which adds:

- heavy focused-pane borders and attention colours: blocked panes red,
  finished-but-unreviewed panes peach; other inactive panes fade toward the
  background (`ui.unfocused_pane_opacity`);
- one **Spaces tree** sidebar: repository, then worktree Space, then
  conversations. Click a repository to fold it, or a Space's status counts to
  show or hide its conversations. Drag a linked worktree's row to reorder it (the
  main checkout stays first);
- the `sidebar_hidden` Space token, used by spaces-env to hide the other
  environment (the focused Space always stays visible);
- the `pr_number` / `pr_title` / `pr_state` Space tokens, used by pr-status;
- `keys.next_machine` / `keys.previous_machine` and `keys.move_worktree_up` /
  `keys.move_worktree_down`.

Build it after `brew bundle` (needs Rust via rustup and Zig 0.16.0; set `ZIG` to
override). Run the theme step first, because `theme` generates the config.

```sh
install-herdr-focus                          # build, test, install ~/.local/bin/herdr
install-herdr-focus --build-only /tmp/herdr  # build and test only
```

The installer never restarts a server. The client draws the sidebar and the
server draws panes, so sidebar changes appear on the next `herdr` attach and pane
changes on the next server start. The build reports `0.9.1-dotfiles.<patch-hash>`, and its `herdr update`
refuses to replace itself with a stock release; upgrading needs a ported patch.
To swap the binary under running agents, follow the
[live-handoff checklist](VERIFICATION.md#explicitly-approved-live-herdr-handoff).

Then link the plugins and agent integrations:

```sh
herdr plugin link ~/.config/herdr/plugins/next-agent --enabled
herdr plugin link ~/.config/herdr/plugins/spaces-env --enabled
herdr plugin link ~/.config/herdr/plugins/task-launcher --enabled
herdr plugin link ~/.config/herdr/plugins/pr-status --enabled
herdr integration install pi
herdr integration install omp
herdr integration status      # Pi and OMP should both be current
herdr machine add <ssh-target> --label home   # optional, for C-a '
herdr config check
herdr
```

## Keys

The prefix is `C-a`, matching tmux: `h/j/k/l` moves between panes, `\` / `-`
splits right / down, `c` closes a pane, `C-c` creates a tab, `r` renames it, `w`
opens the workspace picker and `z` zooms. `H` / `L` changes tabs, `x` swaps down,
and `Space` enters resize mode. Splits are refused below 10 columns or 4 rows.
`C-a ?` shows the live keymap.

| Key | Action |
| --- | --- |
| `C-a u` / `C-a Shift-u` | Jump to the next conversation needing attention / back to where the jumps started |
| `C-a m` | Keep the current conversation unread until you reply; press again to mark it read |
| `C-a t` | Start a [Pi task](../herdr/plugins/task-launcher/README.md) in a new worktree Space |
| `C-a v` | Review the focused agent's uncommitted changes in tuicr and send comments back |
| `C-a ;` / `C-a :` | Toggle Personal/Work / send the current Space to the other environment |
| `C-a '` | Switch this client to the next online machine (for example the saved `home`) |
| `C-a K` / `C-a J` | Move the focused linked worktree up / down within its repository |
| `C-a R` | Reload the generated config (does not pick up `config.base.toml` edits; run `theme apply` for those) |

## Agent state

The official Pi and OMP integrations report each agent's lifecycle; without them
Herdr guesses from screen text. After `herdr integration install …`, `/reload`
idle sessions.

The next-agent plugin keeps a state per pane:

- `◐` working
- `◆` blocked or needs input
- `●` finished but not yet reviewed
- `○` idle or reviewed

Focusing a pane (hotkey, click, or pane body) marks it reviewed; split siblings
keep their own state. The focused conversation counts as reviewed even if it
finishes while the terminal is in the background (the macOS notification still
fires). It also sounds the active-tab OMP prompts that Herdr's own toasts skip.

`C-a m` overrides this. Example: you read a reply but want to come back to it.
Press `C-a m`. It shows `●`, and `C-a u` keeps visiting it until you send it a
message or press `C-a m` again. Typing without sending does not count.

Plugin settings live in `~/.config/herdr/plugins/config/<plugin-id>/config.toml`.

**Conversation titles.** OMP rows use OMP's terminal title. Pi rows use the
[`herdr-task-summary`](../pi/extensions/herdr-task-summary/summary.ts) token: a 2–6
word title from a small, tool-free background request to the selected model (this
uses provider quota). A scramble animation shows while it is pending; failures
keep the previous title. If a conversation keeps `New conversation`, its pane's
`task_summary_error` token says why:
`herdr pane list | jq '.result.panes[] | {pane_id, tokens}'`. The next good title
clears it.

## Pull requests in the sidebar

When a linked worktree's branch has a GitHub pull request, the
[pr-status](../herdr/plugins/pr-status/pr_status.py) plugin shows its row as
`#123 PR title` with GitHub's state icon: green open, grey draft, purple merged,
red closed. Only the sidebar changes; the Space's name, branch and worktree stay
the same. Main checkouts are never looked up.

It runs `gh pr view` in the checkout, so `gh` must be signed in. Herdr has no
plugin timer, so checks happen when something else does (a focus change, an agent
finishing, a new Space): the current Space after 30 seconds, others after 5
minutes, merged or closed ones after 30 minutes. Startup checks everything.

- Check now: `herdr plugin action invoke martinro.pr-status.refresh`.
- If `gh` fails (offline, signed out), the last result stays.
- Cache: `~/.local/state/herdr/plugins/martinro.pr-status/state.json`.

## Reviewing an agent's changes

`C-a v` runs [`herdr-review`](../bin/herdr-review), which opens
[tuicr](https://tuicr.dev) in a popup on the focused agent's working tree (or the
only agent in the tab).

1. Select lines with `v`/`V` and comment with `c`.
2. `:wq` or `ZZ` sends all comments to the agent as one prompt; `:q` or `ZQ`
   sends nothing.
3. If the agent is waiting on a question, the comments stay in tuicr and are
   copied to the clipboard instead.

For committed work, run `herdr-review -r main..HEAD` from a shell pane.

## Environments and machines

spaces-env splits Spaces into Personal and Work within one server. `C-a ;`
returns to the Space you last used in the other environment; `C-a :` moves the
current Space across. New Spaces join the active environment; unknown ones
default to Personal. The sidebar shows only the active environment.

- Inspect: `herdr plugin action invoke martinro.spaces-env.status`.
- Reset: delete `~/.local/state/herdr/plugins/martinro.spaces-env/state.json`.

Each saved machine is a separate sidebar screen with its own server, plugins and
environments; `C-a '` skips offline machines. From a plain terminal,
`herdr --remote <ssh-target>` attaches directly.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Herdr ignores an edit to `config.base.toml` | Run `theme apply`: it regenerates `config.toml` and reloads the server. `C-a R` (`herdr server reload-config`) only reloads the already-generated file |
| `C-a '` says `home is not ready` or `no other machine is saved` | Save it with `herdr machine add <ssh-target> --label home`; check `herdr machine list --json`. A stock client (`herdr --version` without the patch) lacks `next_machine`: rerun `install-herdr-focus` |
| A worktree shows its branch, not its pull request | Run `herdr plugin action invoke martinro.pr-status.refresh`, then `herdr plugin log list --plugin martinro.pr-status` for the `gh` result, and `gh pr view` in that checkout. If tokens are reported but the row is unchanged, the client predates the feature: rerun `install-herdr-focus` and reattach |
| `C-a K` / `C-a J` does nothing | Only a linked worktree moves, within its repository and not past either end. If `herdr config check` reports unknown `keys.move_worktree_*`, the binary predates the feature: rerun `install-herdr-focus` |
| Conversation symbol stays idle while Pi works | Check `herdr integration status`; run `herdr integration install pi`, then `/reload` that Pi session once idle. `herdr agent explain <pane-id> --json` should show screen detection skipped; `default_known_agent_idle_fallback` means Herdr is still guessing from the screen |
