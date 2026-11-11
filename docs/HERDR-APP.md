# Herdr app

**Status:** Operator guide. The Herdr desktop app (`/Applications/Herdr.app`,
`herdr-app`, tested with 0.1.12 and herdr-core `hc` 0.1.17) is taking over as the
main Herdr setup; terminal Herdr ([HERDR.md](HERDR.md)) stays as a backup. This repository gives it the terminal setup's
theme, keys, sidebar and plugins. The move is tracked in the
[migration plan](plans/active/2026-11-04-herdr-app-migration.md).

The app is a window over **herdr-core** (`hc`), a background program that runs
every terminal and agent. Closing or updating the window leaves agents running.
It reads only `~/.config/herdr-app/`; nothing in `~/.config/herdr/` applies.
Its own manual is `~/.config/herdr-app/AGENTS.md`, rewritten on every start.

## Where things live

| Path | What it does |
| --- | --- |
| [`herdr-app/keys.json`](../herdr-app/keys.json) | Every key. `global` keeps the app's `Cmd` keys and the `C-a` prefix keys that map to app commands; `layout:eric` adds the keys that need this repository's mods |
| [`herdr-app/layouts/eric.json`](../herdr-app/layouts/eric.json) | The window: a copy of the shipped `main` layout with one right-hand panel that shows the Spaces tree, Files or Brief, a tab bar without buttons, a status bar that hosts the mods below, attention pane headers and a 2 px focus border |
| [`herdr-app/themes/`](../herdr-app/themes/) | Catppuccin Latte, Frappé, Macchiato and Mocha, from the same palettes as Alacritty and Neovim |
| [`herdr-app/mods/`](../herdr-app/mods/) | `tab-bar` (the app's own tab bar without its `+`, Files and Changes buttons), `spaces-tree` (the sidebar view of the right-hand panel), `next-agent`, `spaces-env`, `popups`, `pane-keys`, `pi-resume` (status bar), `attention-pane` (pane headers), `brief` (the right-hand panel), `conversation-picker` (a popup), `mission-control` (a dialog) |
| [`lib/herdr-app-mods/`](../lib/herdr-app-mods/) | Tests for the mods' rules, with the app's modules stubbed |
| [`bin/herdr-import`](../bin/herdr-import) | Rebuilds the terminal Herdr session in the app |

Also app-aware: [`bin/theme`](../bin/theme) (writes the flavour into the app's
`settings.json`), [`bin/herdr-review`](../bin/herdr-review) (sends with `hc`),
the [Pi Tasks launcher](../herdr/plugins/task-launcher/README.md#in-the-herdr-app)
(`app-rpc.mjs`) and the
[`herdr-task-summary`](../pi/extensions/herdr-task-summary/summary.ts) Pi
extension (titles as `hc` labels). The
[`herdr-app-resume`](../pi/extensions/herdr-app-resume/index.ts) Pi extension
exists only for the app ([after a reboot](#after-a-reboot)).

### How the app sees these files

Every file is its own symlink (the `herdr-app/` line in [`links`](../links)), so
the app's own files (`settings.json`, `shared.json`, `data/`, `layouts/.state/`)
stay out of the repository. Two consequences:

1. The app notices an edit only when something in its folder changes. After
   editing a file here, `touch -h` its link, for example
   `touch -h ~/.config/herdr-app/mods/spaces-tree/main.js`. Then check
   `herdr-app status` for `errors` (and `keys.error` or `layout.error` in
   `~/.config/herdr-app/`).
2. A mod is one `main.js`. The app resolves a linked file to its place in this
   repository and refuses imports from there, so a mod cannot import its own
   helper file. Its pure rules are exported from `main.js` instead, and the tests
   load it with stand-ins for `gpui-kit`, `gpui-base` and `herdr`. Linking whole
   mod folders is no fix: the app writes an 800 KB `gpui-kit.d.ts` and a
   `jsconfig.json` into every mod folder.
3. Images (`svg()`, `image()`, a layout's `preview`) load the same way, so they
   cannot be links either. `spaces-tree` keeps its pull-request icons and the
   `eric` layout's Settings preview as text in `main.js` and writes them as hidden
   files in its own folder (`.pr-*.svg`, `.layout-preview.svg`) when it starts;
   hidden files do not reload the mod. JSON files (layouts, themes, keys) are
   fine as links.

Check a mod after any edit: `herdr-app check ~/.config/herdr-app/mods/<name>`.
Check the linked folder, never the repository's: `check` writes the app's
`gpui-kit.d.ts` and `jsconfig.json` into the folder it checks, and the next
`dotfiles-link apply` would link them.

If `keys.json` is missing, the app at once writes its defaults over the path, so
replace a link with `ln -s` to a temporary name and `mv -f` rather than deleting
it first. The app's original keys are kept at
`~/.local/state/herdr-app/keys.json.pre-dotfiles`.

## The window

Switch to it once with `herdr-app do layout.switch --name eric` (or `Ctrl+Shift+L`
to cycle layouts). `Ctrl+Alt+Shift+Esc` always resets to the shipped `main`
layout if a file breaks the window.

- **Right-hand panel:** one area beside the panes that shows one of three
  views. `C-a b` (or `Cmd+B`) shows the sidebar, `C-a f` the app's Files and
  `C-a i` [Brief](#brief). The key of the view already showing closes the
  panel. Example: the sidebar shows; `C-a i` swaps it for Brief; `C-a b`
  brings the sidebar back; `C-a b` again closes the panel. The view stays as
  you left it when you change Space. The app's Changes view is left out.
- **Sidebar:** one tree. Repository, then its worktree Spaces (branch icon),
  then the conversations in each Space. Each Space's row ends with its
  repository and branch, `main` included (`.config  dotfiles · main`); a
  worktree named after its branch, or showing its pull request, leaves them
  out. Only the active environment's Spaces
  show, plus the one you are in. Click a Space's counts (`◆1 ●2`) to fold its
  conversations, a repository's chevron to fold its worktrees. It has no
  buttons: `C-a s` or `Cmd+N` makes a Space.
- **Tab bar:** only the tabs, with room on the left for the window buttons. New
  tab: `Cmd+T` or `C-a C-c`.
- **Status bar, right:** `Personal | Work` (click: toggle) and the attention
  counts (click: next agent).
- **Pane headers:** a blocked pane's header is red ("◆ Needs you"), a finished but
  unreviewed one peach ("● To review").

Each conversation has one dot. Example, three agents in one Space:

1. 10:00: `fix login` works: `◐`.
2. 10:05: it finishes while you are in another pane: `●` (to review).
3. 10:06: `migrate store` asks a question: `◆`. `C-a u` goes there first, then
   to `fix login`.
4. 10:07: you focus `fix login`: `○` (read). Its split neighbour keeps its own
   dot; only focusing that pane reads it.
5. 10:08: `C-a m` on `fix login` keeps it `●` until you send it a message.

Pi conversations are named by the `herdr-task-summary` extension (a 2–6 word
title). Other agents show their own title, else their tab or program name.

### Motion

This repository's mods animate what they draw. The app runs the animations
itself, so they use no timers:

- **Sidebar:** switching Space or conversation fades the highlight from the
  old row to the new one. Folding slides the rows shut or open. A new Space or
  conversation, or the other environment's Spaces after `C-a ;`, opens in. A
  dot that changes fades in.
- **Pane headers:** the red and peach tints fade in and out, a changed dot
  fades in, and the hover buttons fade in.
- **Status bar:** the `Personal | Work` highlight slides, and a changed count
  fades in.
- **[Conversation picker](#conversation-picker):** results slide to their new
  places as you type, the selection glides, and the list grows and shrinks.
- **[Mission control](#mission-control):** see below.

The app's own parts do not animate, and its files offer no setting for it: tabs,
terminals, pane borders and focus, splits, zoom, and its dialogs and toasts.
Nor do reordering a worktree by dragging and [Brief](#brief).

A new row has to be drawn shut once before it can open, because the app
animates only a change. So each mod draws it shut, then redraws it 32 ms later.

## Keys

The prefix is `C-a`, as in terminal Herdr and tmux. These need the `eric`
layout; the rest of [HERDR.md's keys](HERDR.md#keys) work everywhere, except
`C-a H/J/K/L`: they resize panes here, so they no longer change tabs or move
worktrees.

| Key | Action |
| --- | --- |
| `C-a w`, `Cmd+P` | [Conversation picker](#conversation-picker): type part of a conversation's name, `Enter` goes there |
| `C-a C-w` | [Mission control](#mission-control): every agent at once |
| `C-a u` / `C-a U` | Next conversation needing you / back to where the jumps started |
| `C-a m` | Keep this conversation unread until you reply; again: mark it read |
| `C-a o` | The conversation that most recently came to need you (terminal Herdr: the latest notification's pane) |
| `C-a ;` / `C-a :` | Toggle Personal/Work / send this Space to the other one |
| `C-a S-1..9`, `Ctrl+1..9`, `C-a S-←/→` | Spaces of the active environment, in sidebar order |
| `C-a t` | Pi Tasks: a new worktree Space running Pi |
| `C-a v` / `C-a V` | Review the agent's changes / whole branch in tuicr |
| `C-a e` | This terminal's history in `$EDITOR` |
| `C-a h/j/k/l`, `Cmd+Alt+arrows` | The pane in that direction; in a zoomed tab, unzooms first |
| `C-a H/J/K/L` | [Resize](#resizing-panes): move the pane's edge left / down / up / right; `H/J/K/L` alone repeat |
| `` C-a ` ``, `C-a Tab` / `C-a S-Tab` | Last pane, next / previous pane in this tab |
| `C-a M-1..9` | The n-th conversation in the sidebar |
| `C-a g` / `C-a G` / `C-a C-g` | Open / new / remove worktree (the app's dialog) |
| `C-a b`, `Cmd+B` | The sidebar in the right-hand panel; again: close the panel |
| `C-a f` | Files in the right-hand panel; again: close the panel |
| `C-a i` | [Brief](#brief) in the right-hand panel; again: close the panel |

`C-a w`, `Cmd+P` and `C-a C-w` work in every layout. `C-a C-a` sends a literal `C-a`. Keys a mod handles reach it only while its block
is on screen, which is why those mods sit in the status bar: no key hides it.

**Zoom (`C-a z`).** In the `eric` layout, `pane-keys` keeps the zoomed pane and
the pane you type into the same, as tmux does. The app alone would move focus
to a pane its zoom hides, so you would type into a pane you cannot see.
Example, a tab with `fix login` and `migrate store` split side by side:

1. 10:00: you zoom `fix login` with `C-a z`.
2. 10:05: `C-a u` (or the sidebar, `C-a w`, `Cmd+]`, `C-a Tab`) goes to
   `migrate store`. The tab unzooms and shows both, focus on `migrate store`.
3. 10:06: `C-a z` again zooms `migrate store`. `C-a h` unzooms and moves left.
4. A pane header's zoom button zooms that pane and moves focus to it.

### Resizing panes

The app has no resize command, so `pane-keys` changes the split sizes in the
layout herdr-core keeps for the app (its `herdr-app` document), and the app
redraws. Each press moves one edge by 5% of its split, as tmux's `resize-pane`
does. Example, `fix login` and `migrate store` side by side at 50/50:

1. Focus is in `fix login`, on the left. `C-a L` moves its right edge right: 55/45.
2. Focus is in `migrate store`, the last pane. It has no right edge, so `C-a L`
   moves its left edge right: `migrate store` shrinks to 45%.
3. `C-a H` moves the same edges back. `C-a J` / `C-a K` do the same for the
   nearest top/bottom split.

After a resize key, `H`, `J`, `K` and `L` alone keep resizing, as tmux's
`bind -r` does: `C-a H H H H` moves an edge four steps. The repeat ends 500 ms
after the last press, or at any other key, which is then not typed (`Esc` just
ends it). Meanwhile `pane-keys` holds the keyboard, so the pane's focus border
goes until it ends. Presses that arrive while one is being saved are saved
together, so holding or spamming a key does not queue up.

A pane stops shrinking at 10% of its split. Dragging an edge still works. The
layout document is undocumented, so an app update may change it; the key then
shows a `pane-keys resize` error and changes nothing (see
[Troubleshooting](#troubleshooting)).

## Conversation picker

`C-a w` or `Cmd+P` opens a search bar at the top of the window, like Spotlight,
for conversations. It replaces the app's own picker of tabs and Spaces on those
keys. Example, five agents running:

1. 10:00: you are in `Build conversation picker` and want the panel sketch.
2. `C-a w`, then type `pan`. `Sketch herdr right-side panel` is the **Top hit**
   and is selected; the right half shows its Space, its state and the end of its
   screen.
3. `Enter`. You are in that pane, even if it is in another Space or in Work.
4. 10:05: `C-a w`, then `Enter` with nothing typed. With nothing typed the list
   is **Recent**, conversations by last visit, so this goes back to
   `Build conversation picker`.

- It searches every agent in every Space, Personal and Work alike; plain shells
  are left out. A conversation from the other environment says so (`Work`).
- Each typed word has to match its title, Space, branch, named tab, program,
  machine or environment (`dot sync` finds `Theme sync` in `dotfiles`). Title
  matches rank first; between equals, the one you visited last.
- Words match at their start, anywhere, by initials (`flr`: `Fix login
  redirect`), or with a few letters skipped (`lgn`: `login`).
- `↑` / `↓` or `Ctrl+N` / `Ctrl+P` move; `Enter` or a click goes; `Esc` closes.

Visits are recorded by `pane-keys` (the `eric` layout's status bar) in the shared
`pane-keys.recent` list. In another layout the picker still works, but no new
visits are recorded: Recent shows those recorded before, then sidebar order.
The preview is text read every 2 seconds while the picker is open; it never
types into or resizes a terminal.

## Mission control

`C-a C-w` opens a dialog showing every agent of the active environment at
once, like Tern's Mission Control. Plain shells are left out. `C-a C-w` again
or `Esc` closes it.

- Each Space with an agent is a heading, in sidebar order. Under it, each agent
  is a card with its sidebar dot and title and the last lines of its screen.
- A red border means the agent needs you; a peach border means it finished and
  you haven't looked yet.
- It opens on the agent you are in (marked "here"), else the first one. Arrows
  or `h`/`j`/`k`/`l` move; `Enter` or a click goes to that agent's pane.
- On opening, the rows fade and rise in one after another. Scrolling is smooth,
  and the selection ring glides to the next card. The app draws this itself,
  so it uses no timer and stops when the dialog closes.

The cards are text, refreshed every 2 seconds while the dialog is open. They
are not live terminals, so opening it never resizes or types into a terminal.

## Brief

`C-a i` shows **Brief** in the right-hand panel, in place of the sidebar or
Files; `C-a i` again closes the panel. It answers "what is this conversation about,
what did I last ask, and where is the work?" for one agent: the focused pane's, else the
first in the focused tab, else the first in the Space. Like Files, it follows
the pane you focus.

Example, the `fix-login` Space:

1. 10:06: Pi starts on "Why does login spin forever after a 401?".
2. 10:40: you add "Also show the error message instead." Two seconds later the
   `herdr-task-summary` Pi extension writes a summary of the conversation so far.
3. 11:30: `C-a u` lands there and `C-a i` shows:
   - **Conversation:** the dot, the title, `1h 24m` since it started, and the
     summary: "Fixing the login page's endless spinner after a 401; now showing
     the error message instead."
   - **Last prompt:** "Also show the error message instead.", `50m` ago
     (`more ▾` shows all of a long one).
   - **Branch:** `fix-login ↗`, which opens the branch on GitHub (`· not
     pushed` until it is there). Then `3 commits since main`, `7 files · +142
     −38` for those commits plus uncommitted edits (from the same starting
     point as `C-a V`), and `2 files not committed`. On `main`: the commits not
     pushed.
   - **Pull request:** `#482 Fix login spinner ↗`, which opens it,
     `Open · Changes requested`, `Checks ✓ 5 ✗ 1 ◌ 1` and each failing check
     (click to open its log). Not shown on `main` or a detached HEAD.
4. 11:35: CI finishes. While Brief shows, it reads git and the conversation
   file every 15 seconds and GitHub at most once a minute, so the next look
   has the result. Hidden, it reads nothing.

Where each part comes from:

- The summary is a second small, tool-free model request the extension makes
  alongside the title, to the same model (gpt-6-luna, else the conversation's
  model; see [titles](HERDR.md)). It costs provider usage: one
  request per new prompt, plus one when a conversation opens or reloads. Like
  the title, it sees only your messages, never the agent's replies or tool
  output. A Pi started before this existed shows "No summary yet" until you
  `/reload` it once idle.
- The last prompt is read from the end of the Pi conversation file with `jq`,
  which stops at that message. Many conversation files are over the app's
  1 MB file-reading limit. Other agents (OMP) show their title only.
- The links need the remote's website (GitHub, from `git remote get-url`), and
  the pull request needs `gh` signed in.

## Popups

`C-a t`, `C-a v`, `C-a V` and `C-a e` open a terminal in a dialog with a small bar.
The dialog closes when its program exits; closing it first (click outside or
`×`) ends the program. `Esc` goes to the program.

- **Pi Tasks** is the same form as in terminal Herdr, with the same drafts,
  history and preferences. In the app it makes the worktree in
  `~/.herdr/worktrees/<repo>/<branch>` (where the app's own worktree dialog puts
  them), a Space named after the task, and Pi as its only tab.
- **Review** runs `herdr-review` on the focused agent, or the only agent in the
  tab. `:wq` sends the comments with `hc send`, which refuses an agent waiting on
  a question; the comments then stay in tuicr and go to the clipboard.

## After a reboot

herdr-core keeps terminals running while the window is closed or updated. A
reboot or logout ends their programs; each terminal then comes back as a fresh
shell in its last folder, in the same pane. Pi conversations reopen by
themselves, as terminal Herdr's `resume_agents_on_restore` did:

1. 09:00: `t7` runs Pi. The `herdr-app-resume` extension labels it with its
   session file and its shell's pid (`hc get t7 | jq .labels`).
2. 18:00: the Mac restarts. `t7` comes back as a new shell with a new pid.
3. 18:01: the app's `pi-resume` mod sees the labels and the changed pid, and types
   `pi --session '<file>'` into `t7`. A toast says so.

Quitting Pi clears the labels, so a conversation you ended stays ended. If
something other than a shell is in front of the recovered terminal, or the
session file is gone, nothing is typed and a toast gives the command. Other
agents (OMP) come back as shells.

## Theme

`theme set <flavour>`, `theme cycle` and the Alacritty hotkeys also set `theme`
and `appearance` in `~/.config/herdr-app/settings.json`, which the app applies at
once. `theme status` shows the app's line. Opacity does not apply: the window is
opaque. A theme picked in the app's own theme menu wins over this until reset.

## Moving the terminal Herdr session

`herdr-import` reads `~/.config/herdr/session.json` and makes each workspace a
Space: same name, tabs and splits, every pane in its folder, and Pi panes running
`pi --session <file>` on their conversation. Spaces join their Personal/Work
environment. It skips workspaces it already imported
(`~/.local/state/herdr-app/import.json`).

It never resumes a conversation terminal Herdr still has open: two Pi processes on
one session file can corrupt it. So the move is one sitting, for example:

1. 21:00: every agent is idle. Note anything a pane runs besides Pi (a dev
   server): it comes back as a plain shell.
2. 21:01: `herdr-import --dry-run` lists what will be made.
3. 21:02: `herdr server stop`. Every terminal Herdr pane ends; the conversations
   are safe on disk.
4. 21:03: `herdr-import`. Spaces appear in the app with Pi reopened.

To move one workspace at a time instead: copy `session.json`, close that
workspace in terminal Herdr, then `herdr-import --from <copy> --workspace w3`.
`--shells-only` rehearses without resuming anything.

Lost in the move: split sizes (all come back even; drag to resize), scrollback,
and programs other than Pi.

## What the app cannot do

Terminal Herdr settings with no app equivalent:

- **Copy mode, resize mode (`C-a Space`), pane rename:** the app has no command
  for them. Select with the mouse and `Cmd+C`. Resize one step per press with
  [`C-a H/J/K/L`](#resizing-panes), or drag a pane's edge. There is no
  copy-on-select.
- **Dimmed or coloured panes:** mods do not draw terminals, so unfocused panes
  are not faded and borders are not red or peach. The pane header carries the
  colour instead.
- **Alerts:** the app's own sound and corner toast when an agent needs you or
  finishes unseen (Settings → Alerts); `ui.toast` settings do not apply. The app
  bundle includes macOS notification delivery, but whether it posts to
  Notification Center has not been checked here.
- **Output after a reboot:** closing the window and updating the app or
  herdr-core keep every terminal's output; a reboot or logout loses it
  (`experimental.pane_history` kept it). Pi conversations still reopen with their
  history ([above](#after-a-reboot)).
- **`C-a '` (next machine):** not needed; every machine's Spaces are in the one
  sidebar.
- **Detach and config reload:** not needed; the window can close at any time and
  reloads files itself.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| An edit here does nothing | The app did not see it: `touch -h` the link under `~/.config/herdr-app/`, then `herdr-app status` |
| `C-a H/J/K/L` shows a `pane-keys resize` error | The app changed how it stores splits (herdr-core's `herdr-app` document). Drag edges meanwhile; compare that document with `resizePlan` in [`pane-keys`](../herdr-app/mods/pane-keys/main.js) |
| Brief shows `GitHub: …`, no summary or no last prompt | Run `gh auth status` and `gh pr view` in that checkout. The summary needs a Pi started (or `/reload`ed) with the current `herdr-task-summary`; `hc get <t> \| jq .labels` shows `task_brief`, or why not in `task_brief_error`. The last prompt needs `jq` and the `herdr-app-resume` extension's `pi.session` label |
| `C-a u`, `C-a ;` or `C-a t` does nothing | Another layout is showing (`herdr-app status` → `layout`): `herdr-app do layout.switch --name eric` |
| `herdr-app status` lists `resolves outside the application directory` | A mod imports another file; mods must be one `main.js` (see above) |
| The sidebar shows every Space | spaces-env is not loaded: the status bar has no `Personal | Work` pill. Switch to `eric` |
| A worktree shows its branch, not its pull request | Lookups run every 30 s for the shown Space, 5 min for others, and need `gh auth status` to pass. The cache is the `spaces-tree` mod's localStorage in `~/.config/herdr-app/data/` |
| A Pi conversation did not reopen after a reboot | It started before the `herdr-app-resume` extension existed (no `pi.session` label): reopen it by hand with `pi --session <file>`; `/reload` running ones once idle |
| A Pi conversation stays `Pi` or `Naming…` | Its Pi started before the extension learned `hc` labels: `/reload` it once idle. `hc get <t> \| jq .labels` shows `task_summary_error` |
