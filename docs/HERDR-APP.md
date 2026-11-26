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
| [`herdr-app/layouts/eric.json`](../herdr-app/layouts/eric.json) | The window: a copy of the shipped `main` layout with one right-hand panel that shows the Spaces tree or Files, a tab bar without buttons, a status bar that hosts the mods below, attention pane headers and a 2 px focus border |
| [`herdr-app/layouts/review.json`](../herdr-app/layouts/review.json) | [Review mode](#review-mode): a top bar and three columns, one Review mode mod each |
| [`herdr-app/themes/`](../herdr-app/themes/) | Catppuccin Latte, Frappé, Macchiato and Mocha, from the same palettes as Alacritty and Neovim |
| [`herdr-app/mods/`](../herdr-app/mods/) | `tab-bar` (the app's own tab bar without its `+`, Files and Changes buttons), `spaces-tree` (the sidebar view of the right-hand panel), `next-agent`, `spaces-env`, `popups`, `pane-keys`, `pi-resume` (status bar), `attention-pane` (pane headers), `conversation-picker` (a popup), `mission-control` (a dialog), `toast-filter` ([notifications](#notifications)), `review-nav`, `review-page`, `review-side` ([Review mode](#review-mode)) |
| [`lib/herdr-app-mods/`](../lib/herdr-app-mods/) | Tests for the mods' rules, with the app's modules stubbed |
| [`bin/herdr-import`](../bin/herdr-import) | Rebuilds the terminal Herdr session in the app |

Also app-aware: [`bin/theme`](../bin/theme) (writes the flavour into the app's
`settings.json`), [`bin/herdr-review`](../bin/herdr-review) (sends with `hc`),
[`bin/review`](../bin/review) ([pull request reviews](#pull-request-reviews)),
the [Pi Tasks launcher](../herdr/plugins/task-launcher/README.md#in-the-herdr-app)
(`app-rpc.mjs`) and the
[`herdr-task-summary`](../pi/extensions/herdr-task-summary/summary.ts) Pi
extension (titles as `hc` labels). The
[`herdr-app-resume`](../pi/extensions/herdr-app-resume/index.ts) Pi extension
exists only for the app ([after a reboot](#after-a-reboot)). Both act only for an
interactive Pi: a `pi -p` that an agent runs from its shell inherits the
agent's `HC_TERMINAL_ID` but leaves that terminal's title and labels alone.

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

- **Right-hand panel:** one area beside the panes with two views. `C-a b`
  (or `Cmd+B`) shows the sidebar; `C-a f` shows the app's Files. The key of the
  view already showing closes the panel. Example: the sidebar shows; `C-a f`
  swaps it for Files; `C-a b` brings the sidebar back; `C-a b` again closes the
  panel. The view stays as you left it when you change Space. The app's Changes
  view is left out.
- **Sidebar:** at the top, a pinned band lists the active environment's
  conversations in four sections: the ones that need you (`◆ Needs you`),
  then the ones finished unread (`● To review`), then the ones you saved for
  later with `C-a m` (`■ Saved`), then the ones running (`◐ Running`). Each
  row shows its Space or repository/PR and how long it has been in that
  state. Click a row to jump there, or a heading to fold that section. A
  section with no rows is left out; the band hides when all are idle. Below
  it is one tree: repository, then its worktree Spaces (branch icon), then the conversations in each Space.
  Each pane running Neovim has a row too, drawn differently: the green Neovim
  logo instead of a dot, and its name in the terminal font. Rows go tab by tab,
  so tab 2's conversations and Neovim panes sit together, in pane order. The
  name is the file Neovim's title names (`options.lua`, or `lua/` for an Oil
  folder view, set in [`nvim/lua/options.lua`](../nvim/lua/options.lua)), else
  the pane's or a named tab's name, else its folder. Click it to go there. These rows have no
  state, so the top band, the counts, `C-a u` and `C-a M-1..9` leave them out;
  a folded Space shows how many (Neovim logo and a number).
  Each Space's row ends with its repository and branch, `main` included, so
  branches line up at the right edge; commits ahead or behind sit just left
  of them, and the fold chevron and counts follow the name
  (`code-slop ●1      ↑2 main`). A worktree named after its branch, or showing
  its pull request, leaves them out. Only the active environment's Spaces
  show, plus the one you are in. Click a Space's counts (`◆1 ●2`) to fold its
  conversations, a repository's chevron to fold its worktrees. A Pi
  conversation you have not written in yet (`New conversation`) is left out
  until you send it something, and gets no `C-a M-1..9` number. It has no
  buttons: `C-a s` or `Cmd+N` makes a Space. At the bottom, **Reviews** lists
  [pull request reviews](#pull-request-reviews) instead of the tree.
- **Tab bar:** only the tabs, with room on the left for the window buttons. New
  tab: `Cmd+T` or `C-a C-c`. The window buttons ignore zoom, so the layout's
  `traffic_lights` height is set for `zoom` 0.7 in `settings.json`. At another
  zoom they sit above or below the tabs; set its second number to
  21 × zoom − 7.5 (6 at 0.7, 13.5 at 1).
- **Status bar, right:** `Personal | Work` (click: toggle) and the attention
  counts, which leave Saved conversations out (click: next agent).
- **Split panes:** the selected pane stays bright. The other panes fade toward
  the theme background (`pane.veil` in the `eric` layout). Click any pane to
  select it. A dialog does not dim the selected pane, and zooming shows one
  pane at full brightness.
- **Pane headers:** a blocked pane's header is red ("◆ Needs you"), a finished but
  unreviewed one peach ("● To review"), a saved one purple ("■ Saved").

### Notifications

The notes in the bottom-right corner show only conversation alerts and errors.
Example:

1. 10:00: `fix login` asks a question while you are in another Space. "Pi needs
   you" shows, with its Space and tab; click it to go there. 10:05: another
   agent finishes unseen: "Pi finished".
2. 10:06: `C-a ;` switches to Work. No note; the `Personal | Work` pill shows it.
3. 10:07: `C-a t` cannot open its popup. A red "Popup failed" note shows.

Everything else is dropped: Space switches, `C-a m`'s "Saved until you reply", "Resumed
Pi", the app's own info notes. The `toast-filter` mod does this; the layout's
`toast` field hands it every note, the app's and every mod's. Kept notes look like
the app's own (`toast` mod, copied from 0.1.17). The alert sounds are separate and
still play (Settings → Alerts). [Review mode](#review-mode) uses the same
filter; another layout shows every note.

Each conversation has one dot. Example, three agents in one Space:

1. 10:00: `fix login` works: `◐`.
2. 10:05: it finishes while you are in another pane: `●` (to review).
3. 10:06: `migrate store` asks a question: `◆`. `C-a u` goes there first, then
   to `fix login`.
4. 10:07: you focus `fix login`: `○` (read). Its split neighbour keeps its own
   dot; only focusing that pane reads it.
5. 10:08: you want to come back to `fix login` tomorrow. `C-a m` moves it to
   Saved (`■`). `C-a u` and the status bar counts now skip it, even if it was
   asking you something.
6. Next day: you click it under Saved and send it a message. It leaves Saved
   and shows `◐` again. `C-a m` a second time also takes it out (as read).

Pi conversations are named by the `herdr-task-summary` extension (a 2–6 word
title). Other agents show their own title, else their tab or program name.
For a recap, read the latest reply or ask the agent directly. The extension
only generates titles, not conversation summaries. Run `/reload` in idle Pi
sessions after updating the extension; new sessions use the updated code.

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
Nor does reordering a worktree by dragging.

A new row has to be drawn shut once before it can open, because the app
animates only a change. So each mod draws it shut, then redraws it 32 ms later.

## Keys

The prefix is `C-a`, as in terminal Herdr and tmux. These need the `eric`
layout, except the resize keys; the rest of [HERDR.md's keys](HERDR.md#keys)
work everywhere, except `C-a H/J/K/L`: they resize panes here, so they no longer
change tabs or move worktrees.

| Key | Action |
| --- | --- |
| `C-a w`, `Cmd+P` | [Conversation picker](#conversation-picker): type part of a conversation's or Neovim pane's name, `Enter` goes there |
| `C-a C-w` | [Mission control](#mission-control): every agent at once |
| `C-a u` / `C-a U` | Next conversation needing you / back to where the jumps started |
| `C-a m` | Save this conversation for later (sidebar's Saved) until you reply; again: unsave it, marked read |
| `C-a o` | The conversation that most recently came to need you (terminal Herdr: the latest notification's pane) |
| `C-a ;` / `C-a :` | Toggle Personal/Work / send this Space to the other one |
| `C-a S-1..9`, `Ctrl+1..9`, `C-a S-←/→` | Spaces of the active environment, in sidebar order |
| `C-a t` | Pi Tasks: a new worktree Space running Pi |
| `C-a R` | [Review a pull request](#pull-request-reviews): a popup asks for its link, then its `/rho audit` starts in a Space of its own |
| `C-a v` / `C-a V` | Review the agent's changes / whole branch in tuicr |
| `C-a e` | This terminal's history in `$EDITOR` |
| `C-a h/j/k/l`, `Cmd+Alt+arrows` | The pane in that direction; in a zoomed tab, unzooms first |
| `C-a H/J/K/L`, `Ctrl+Alt+arrows` | [Resize](#resizing-panes): move the pane's edge left / down / up / right; after `C-a H/J/K/L`, `H/J/K/L` alone repeat |
| `` C-a ` ``, `C-a Tab` / `C-a S-Tab` | Last pane, next / previous pane in this tab |
| `C-a M-1..9` | The n-th conversation in the sidebar |
| `C-a g` / `C-a G` / `C-a C-g` | Open / new / remove worktree (the app's dialog) |
| `C-a b`, `Cmd+B` | The sidebar in the right-hand panel; again: close the panel |
| `C-a f` | Files in the right-hand panel; again: close the panel |
| `C-a p` | [Review mode](#review-mode); there, `C-a p` again comes back here |

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

`C-a H/J/K/L` and `Ctrl+Alt+arrows` run the app's own `pane.resize` (Herdr app
0.1.17 or later). Each press moves the edge nearest the focused pane by 40 px
(about 4 columns) in the key's direction, the same as dragging it, as tmux's
`resize-pane` does.
Example, `fix login` and `migrate store` side by side:

1. Focus is in `fix login`, on the left. `C-a L` moves its right edge right:
   `fix login` grows.
2. Focus is in `migrate store`, the last pane. It has no right edge, so `C-a L`
   moves its left edge right: `migrate store` shrinks.
3. `C-a H` moves the same edges back. `C-a J` / `C-a K` do the same for the
   nearest top/bottom split.

`Ctrl+Alt+arrows` do the same; hold one to keep resizing. They work in every
layout, and so does `C-a H/J/K/L`, one step per press.

In the `eric` layout, after `C-a H/J/K/L`, `H`, `J`, `K` and `L` alone keep
resizing, as tmux's `bind -r` does: `C-a H H H H` moves an edge four steps. The
repeat ends 500 ms after the last press, or at any other key, which is then not
typed (`Esc` just ends it). Meanwhile `pane-keys` holds the keyboard, so the
pane's focus border goes until it ends.

A pane stops where dragging would stop it. In a zoomed tab, or with no split in
that direction, nothing moves. Dragging an edge still works.

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
   is **Recent**, conversations and Neovim panes by last visit, so this goes
   back to `Build conversation picker`.

- It searches every agent and every Neovim pane in every Space, Personal and
  Work alike; plain shells are left out. A conversation from the other
  environment says so (`Work`).
- A Neovim pane looks as in the sidebar (green logo, name in the terminal font)
  and, when you type, is listed under **Editors**, after **Conversations**.
  `nvim` or `editor` finds them all.
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

## Popups

`C-a t`, `C-a v`, `C-a V`, `C-a e` and `C-a R` open a terminal in a dialog with a small bar.
The dialog closes when its program exits; closing it first (click outside or
`×`) ends the program. `Esc` goes to the program.

- **Pi Tasks** is the same form as in terminal Herdr, with the same drafts,
  history and preferences. In the app it makes the worktree in
  `~/.herdr/worktrees/<repo>/<branch>` (where the app's own worktree dialog puts
  them), a Space named after the task, and Pi as its only tab.
- **Review** runs `herdr-review` on the focused agent, or the only agent in the
  tab. `:wq` sends the comments with `hc send`, which refuses an agent waiting on
  a question; the comments then stay in tuicr and go to the clipboard.

## Pull request reviews

`C-a R` starts `/rho audit <link>` in a Space of its own, so reviews stay out
of the Space you work in. Example:

1. 10:00: you press `C-a R`. A popup asks for a pull request link; you paste
   one (`Cmd+V`) and press `Enter`.
2. A Space named after the pull request (`#163 Disable BWOF drafts`) opens in
   your clone of that repository, running Pi on `/rho audit <link>`, in Work
   for a work repository even while you are in Personal. You stay where you
   are. The popup says where it went (`under Reviews in Work`) and closes
   itself after a moment (`Enter` closes it at once).
3. The sidebar lists it under **Reviews** at the bottom, not in the tree: the
   pull request's state icon, its repository and the conversation's dot (`◐`
   while it audits, `●` when the verdict is ready, `◆` if it asks you
   something). Its conversation also shows in the top band like any other.
4. 10:20: you click the row and read the verdict. When the pull request is
   merged or closed, its row dims; close the Space with `C-a D` or its
   right-click menu.

- The same link again opens nothing new: the popup says it is already under
  Reviews.
- A mistake (not a pull request link, no clone, `gh` signed out) stays in the
  popup until `Enter`. `Ctrl-C` in the popup cancels.
- From any shell: `review <link>`. `review --dry-run <link>` shows the Space it
  would make (name, folder, environment, command) and changes nothing.
- The clone is the first one whose GitHub remote matches: from the open Spaces
  (the folder each was made in and where its terminals are now), then
  `~/Desktop/projects` (three folders deep) and the folders directly in `~`.
  Without one, nothing starts and the popup says to clone it. Pi starts in its
  main checkout; `/rho` reads the change in its own `/tmp` worktree.
- The review joins Personal or Work with a Space that already shows that
  repository. With none open, it joins the one most Spaces of the same GitHub
  owner are in (an `everyday-artificial-intelligence` repository goes to Work),
  else the one you are in.
- [`bin/review`](../bin/review) labels the Space's terminal
  `review.pr=<link>`; that label is what puts it under Reviews.

## Review mode

`C-a p` turns the window into a screen for reviewing GitHub pull requests: the
`review` layout. `C-a p` there brings back the `eric` layout. The
[Review mode plan](plans/active/2026-11-25-review-mode.md) builds it in steps;
so far it lists your pull requests and shows one's description, checks,
reviewers and labels. Example:

1. 10:00: you are in `fix login`, with the `dotfiles` repository folded in the
   sidebar and Files showing in the right-hand panel. `C-a p` shows Review mode.
   On the left, **Needs your review** lists the open pull requests waiting for
   your review, then **Yours** the open ones you wrote, each with its state.
2. 10:01: `j` twice and `Enter` (or a click) opens `example-app #42`: its
   title, branches, size and checks with its description in the middle, its
   checks, reviewers and labels on the right.
3. 10:05: `C-a p` again. You are back in `fix login`, `dotfiles` is still
   folded and the panel still shows Files. Next time, `#42` is still open.

The list is GitHub's own search (`gh search prs` uses the same), every page,
loaded each time Review mode opens and every 2 minutes while the window
shows; `Refreshing…` marks a reload. GitHub returns at most 1000 results per
search: past that, a section says how many more there are on GitHub. When
GitHub says a search may be incomplete, the section says so. Each pull request
shows one state, the first that applies: Draft, Conflicts, CI failing, Checks
running, Changes requested, Ready to merge, Review required, Blocked, Unknown.
Ready to merge means GitHub says it merges cleanly, never just that it is
approved. GitHub answers Unknown until it has worked a merge out, so the list
asks again after 5, 10 and 20 seconds. If `gh` fails (signed out, offline),
its message shows in red above the list.

The columns are three mods: `review-nav` (left: your pull requests),
`review-page` (middle: the open pull request; with props `{ "part": "bar" }` it
is also the top bar that drags the window) and `review-side` (right: Info and
Chat). The open pull request is the shared `review-mode.open`, which
`review-nav` sets and the other two show. `review-nav` takes the keyboard when
Review mode opens: `j`/`k` or the arrows move, `Enter` opens; it ignores any
key with Ctrl, Alt, Cmd or Shift, so chords reach their bindings. `C-a p` is
bound only in the `layout:eric` and `layout:review` sections
of `keys.json`, so it never goes to a third layout; `Cmd+Shift+L` still cycles
through them all. Keys bound only in `layout:eric` (`C-a u`, `C-a t`, `C-a ;`
and the other keys of this repository's mods) do nothing in Review mode.

Switching layouts restarts each layout's mods. Coming back, the sidebar and
the status bar mods start again and reload what they keep in storage (folds,
unread marks, recent visits); the focused pane and the panel's view and width
belong to the app and do not change. ``C-a ` `` forgets the pane before, which
`pane-keys` keeps only while it runs, so it does nothing until you move to
another pane.

### State of a pull request's review

The three mods share one JSON file per pull request. They cannot share their
own storage, which is per mod and props.

- **Path:** `~/.local/state/herdr-review/<owner>/<repo>/<number>.json`, owner
  and repository lower-cased as GitHub treats them. A mod's `writeTextFile`
  creates the folders.
- **`pr`:** the pull request's link, `https://github.com/<owner>/<repo>/pull/<number>`.
  A file whose `pr` does not match its path is ignored.
- **`snapshots`:** an object keyed by snapshot id. Each value holds what was
  recorded while reviewing that snapshot: Viewed files, marks on findings and
  draft comments, each added by its own step of the plan.
- **Snapshot id:** `<head commit>:<merge-base commit>:<base branch>`, full
  hashes, as `bin/review-analyse snapshot` pins them. Branch names cannot
  contain `:`, so the id splits unambiguously, and a pull request moved to
  another base gets a new id even when its head stays the same.
- **Writing:** read the file, change only your own part, keep keys you do not
  know, and save with `writeTextFile(path, text, expected)` using the text you
  read as `expected`. If another view saved first, the write is refused: read
  again and re-apply only your change.
- **Size:** under 1 MiB, the most `readTextFile` reads. A save that would make
  it larger is not written; the mod says so and keeps the change on screen.

The file is your review work and lives outside this repository. Deleting it
forgets that pull request's Viewed ticks, marks and drafts.

## After a reboot

herdr-core keeps terminals running while the window is closed or updated. A
reboot or logout ends their programs; each terminal then comes back as a fresh
shell in its last folder, in the same pane. Pi conversations reopen by
themselves, as terminal Herdr's `resume_agents_on_restore` did:

1. 09:00: `t7` runs Pi. The `herdr-app-resume` extension labels it with its
   session file and its shell's pid (`hc get t7 | jq .labels`).
2. 18:00: the Mac restarts. `t7` comes back as a new shell with a new pid.
3. 18:01: the app's `pi-resume` mod sees the labels and the changed pid, and types
   `pi --session '<file>'` into `t7`.

Quitting Pi clears the labels, so a conversation you ended stays ended. If
something other than a shell is in front of the recovered terminal, or the
session file is gone, nothing is typed and an error note gives the command. Other
agents (OMP) come back as shells.

## Theme

`theme set <flavour>`, `theme cycle` and the Alacritty hotkeys also set `theme`
and `appearance` in `~/.config/herdr-app/settings.json`, which the app applies at
once. `theme status` shows the app's line. `theme`'s opacity does not apply here.
A theme picked in the app's own theme menu wins over this until reset.

The window is frosted glass instead. `window_blur` in
[`layouts/eric.json`](../herdr-app/layouts/eric.json) blurs the desktop behind it,
and each Catppuccin theme file gives three colours some transparency: `canvas`
(behind everything, `73` = 45%), `chrome` (the tab bar and sidebar, `74` = 45%)
and `background` (the panes, `8b` = 55%). They stack, so panes end up about 75%
solid, the tab bar 70%, the sidebar 84% and the gaps 45%. A terminal cell can't be
partly see-through, so boxes that programs paint stay solid, such as Pi's tool
panels and your own messages. How strongly the desktop is
blurred is macOS's choice; Herdr 0.1.16 only has blur on or off, and off makes the
window solid. Neovim turns off its own
background inside the app ([`nvim/lua/theme.lua`](../nvim/lua/theme.lua)). To
make it less see-through, raise those alpha suffixes; `ff` is solid. The app
re-reads a theme file when its theme changes or when it starts. `herdr-app shot`
draws the app without the desktop, so it cannot show this effect.

The terminal font is Maple Mono NF, set by `font` in
[`layouts/eric.json`](../herdr-app/layouts/eric.json) and installed by the
[`Brewfile`](../Brewfile), for its handwriting-style italics (Neovim comments,
Pi's "Thinking"). The app takes one font for everything, so the italics can't
come from a second family. Without the font installed, the app falls back to
JetBrains Mono. The mods use `ui_font`, Nunito (same file, also in the
Brewfile), a rounded font that sits well next to Maple Mono.
A newly installed font shows after the app restarts.

The sidebar is the exception: it uses SF Pro Rounded at medium weight, with
Space names and headings semibold, and its grey text one step darker than the
theme's (lighter on the dark flavours). Nunito is one variable-font file, and
the app draws only its regular weight, so bold text in Nunito shows regular.
SF Pro Rounded has a file per weight. It is not in the Brewfile (it comes from
[Apple's fonts page](https://developer.apple.com/fonts/)); which font the
sidebar shows without it has not been checked. The font, the weights and the darker greys
are set in [`spaces-tree`](../herdr-app/mods/spaces-tree/main.js)
(`SIDEBAR_FONT`, `ink`).

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

Lost in the move: split sizes (all come back even; drag or
[resize](#resizing-panes)), scrollback,
and programs other than Pi.

## What the app cannot do

Terminal Herdr settings with no app equivalent:

- **Copy mode, resize mode (`C-a Space`), pane rename:** the app has no command
  for them. Select with the mouse and `Cmd+C`. Resize with
  [`Ctrl+Alt+arrows` or `C-a H/J/K/L`](#resizing-panes), or drag a pane's
  edge. There is no copy-on-select.
- **Attention-coloured pane borders:** the pane header carries the colour
  instead.
- **Alerts:** the app's own sound and corner toast when an agent needs you or
  finishes unseen (Settings → Alerts); `ui.toast` settings do not apply, and the
  `eric` layout shows only those notes and errors ([Notifications](#notifications)). The app
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
| `C-a H/J/K/L` or `Ctrl+Alt+arrows` move nothing | The tab is zoomed (`C-a z` unzooms), there is no split that way, or the pane is as small as dragging allows. On an app older than 0.1.17 (`herdr-app --version`) `pane.resize` does not exist |
| `C-a u`, `C-a ;` or `C-a t` does nothing | Another layout is showing (`herdr-app status` → `layout`): `herdr-app do layout.switch --name eric` |
| `herdr-app status` lists `resolves outside the application directory` | A mod imports another file; mods must be one `main.js` (see above) |
| The sidebar shows every Space | spaces-env is not loaded: the status bar has no `Personal | Work` pill. Switch to `eric` |
| A worktree shows its branch, not its pull request | Lookups run every 30 s for the shown Space, 5 min for others, and need `gh auth status` to pass. The cache is the `spaces-tree` mod's localStorage in `~/.config/herdr-app/data/` |
| A Pi conversation did not reopen after a reboot | It started before the `herdr-app-resume` extension existed (no `pi.session` label): reopen it by hand with `pi --session <file>`; `/reload` running ones once idle |
| A review Space shows in the tree, not under Reviews | Its terminal lost the `review.pr` label (`hc get <t> \| jq .labels`). `hc label <t> review.pr=<link>` puts it back |
| A Pi conversation stays `Pi` or `Naming…` | Its Pi started before the extension learned `hc` labels: `/reload` it once idle. `hc get <t> \| jq .labels` shows `task_summary_error` |
