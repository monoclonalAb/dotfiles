# Migrate from terminal Herdr to the Herdr desktop app

**Status:** Active (Phases 1–2 and the Phase 3 tool done and live; the `home` machine waits on the machine)
**Scope:** `herdr-app/` (keys, layout, themes, mods), `bin/theme`, `bin/herdr-review`,
`bin/herdr-import`, `bin/dotfiles-bootstrap`, `bin/dotfiles-update`, `Brewfile`,
`herdr/plugins/task-launcher/`, `pi/extensions/herdr-task-summary/`,
`lib/herdr-app-mods/`, `lib/herdr-import/`, operator docs. Live: the running Herdr
app (`herdr-app` 0.1.12, herdr-core `hc` 0.1.17).

## Objective

Everything the terminal Herdr setup does that the desktop app can do runs in the
app, from this repository: theme, layout, keys, the four plugins as app mods, the
review and task popups, Pi task titles, and a script that rebuilds the terminal
Herdr session (Spaces, tabs, splits, Pi conversations) in the app.

## Non-goals

- A cutover: stopping the terminal Herdr server and moving its whole session
  into the app. The user dropped it; `herdr-import` stays for moving workspaces
  on request.
- Removing the terminal Herdr setup: it stays as a backup.
- Editing Herdr's shipped layouts or mods in place (they are replaced on start).

## Context and constraints

- The app reads only `~/.config/herdr-app/`; nothing of `~/.config/herdr/` carries
  over. Its rules: `~/.config/herdr-app/AGENTS.md`. Operator guide:
  [HERDR-APP.md](../../HERDR-APP.md).
- Observed app limits that shaped the design:
  - A mod's key commands reach only a copy in a *visible* block (a hidden block
    never loads; a 0 px block does), so command mods live in the status bar.
  - Modules and images resolve symlinks and are refused outside the app folder:
    each mod is one `main.js`, and images are written as hidden files by
    `spaces-tree`. JSON (layouts, themes, keys) works through links.
  - Edits through a link are not noticed until the link itself is touched.
  - `hc send` from inside a terminal wraps text in `<hc from=…>`; sending without
    `HC_TERMINAL_ID` delivers it as the person's prompt.
  - OSC 7501 pairs are separated by `:` (`state=done:app=x`).
- Pi and OMP report OSC 7501 to herdr-core natively (observed OMP
  `{"app":"omp","state":"idle"}`; OMP's `terminal.programStatus` defaults on).
- The saved `home` machine (`ericzheng@erics-macbook-pro`) did not answer ssh at
  any check on 2026-11-04.

## Acceptance criteria

- [x] Catppuccin themes for all four flavours; `theme set <flavour>` switches the app.
- [x] Layout `eric` in the repository: one Spaces tree (repo, worktree Space,
      conversations), status bar with environment and attention, heavier focus
      border, Settings preview.
- [x] next-agent: `C-a u` / `C-a U` / `C-a m` with per-pane review state.
- [x] spaces-env: `C-a ;` / `C-a :`, sidebar and Space keys follow the active environment.
- [x] pr-status: linked worktree rows show `#123 title` and the state icon and colour.
- [x] Worktree Spaces reorder within their repository: dragging. `C-a K` / `C-a J`
      did too until 2026-11-06, when they became resize keys.
- [x] `C-a H/J/K/L` resize the focused pane, 5% of its split per press.
- [x] `C-a t` opens Pi Tasks in a dialog and starts Pi in a new worktree Space.
- [x] `C-a v` / `C-a V` review the focused agent in tuicr and send comments with `hc`.
- [x] `C-a e`, `` C-a ` ``, `C-a Tab`, `C-a M-1..9`, `C-a g/G/C-g`, `C-a o` (latest needing you).
- [x] Pi task titles show in the app's tree.
- [x] Pi conversations reopen after a reboot (`session.resume_agents_on_restore`).
- [x] `herdr-import` rebuilds terminal Herdr workspaces in the app (dry run and a
      shell-only rehearsal on a real workspace).
- [x] New-Mac path: Brewfile cask, bootstrap step, `dotfiles-update` wakes the app.
- [x] Operator docs describe the app setup; terminal Herdr docs stay for the backup.
- [ ] `home` machine added to herdr-core (blocked: host unreachable).

## Progress

- [x] Phase 1: themes, layout, keys, theme integration, Brewfile and bootstrap.
- [x] Phase 2: seven mods (`spaces-tree`, `next-agent`, `spaces-env`, `popups`,
  `pane-keys`, `pi-resume`, `attention-pane`); the `herdr-app-resume` Pi extension; `app-rpc.mjs` for Pi Tasks; `hc` backend for
  `herdr-review`; `hc` labels for `herdr-task-summary`.
- [x] Phase 3 tool: `bin/herdr-import` with the still-open-conversation guard.
  Dry run against the real `session.json`: 28 workspaces, 85 panes, 30 Pi
  conversations held back because terminal Herdr has them open, 2 whose session
  files are gone.
- [ ] `hc machine add ericzheng@erics-macbook-pro --name home` once it answers ssh.
- [x] `brew install --cask --adopt herdr-app` (2026-11-05): the hand-installed
  app is now Homebrew's; it kept its self-updated 0.1.13.
- [x] Beyond the port (2026-11-05): `mission-control`, Tern's Mission Control as
  a dialog on `C-a C-w` (was a second picker key). One text card per agent pane
  (plain shells left out, at the user's request), from `hc read`, not live
  terminal blocks, so no terminal is resized.
- [x] Beyond the port (2026-11-06): `conversation-picker`, a Spotlight-style
  search over every agent (both environments) on `C-a w`, `Cmd+P` and the
  sidebar's search button, replacing the app's tab/Space picker there at the
  user's request. Nothing typed lists conversations by last visit, which
  `pane-keys` now records in shared `pane-keys.recent`.
- [x] Beyond the port (2026-11-06), at the user's request: the sidebar is a view
  of the right-hand panel, beside Files and Brief, with no buttons (the
  `sidebar-header` mod and the Spaces `+` are gone). `C-a b` / `Cmd+B`, `C-a f`
  (new) and `C-a i` swap the panel between them; Changes is out of the layout.
  The tab bar is `tab-bar`, a copy of 0.1.13's `tabs` without `+`, Files and
  Changes, and without per-Space panel memory (a sidebar click on a Space
  would otherwise swap the sidebar for that Space's view).

## Decisions

- **Terminal Herdr stays as a backup:** its config, plugins, patch and the
  terminal-Herdr paths of `herdr-review`, `herdr-task-summary` and Pi Tasks are
  kept and maintained alongside the app. Do not open one Pi conversation in both
  at once.
- **Status bar hosts command mods:** see constraints; the sidebar can be hidden.
- **Resize through the layout document (2026-11-06, user's choice of keys):**
  the app has no resize command, so `pane-keys` edits split weights in
  herdr-core's `herdr-app` document (`doc.get` / `doc.set` over `hc connect`,
  again on a version conflict); the app redraws from it. `C-a H/J/K/L` were
  taken for it, dropping the app's tab prev/next on `C-a H` / `C-a L` (still
  `Ctrl+Tab`, `Cmd+Shift+[ ]`) and worktree moves on `C-a K` / `C-a J`
  (dragging remains). Terminal Herdr keeps its keys. `H/J/K/L` alone repeat
  for 500 ms, as tmux's `bind -r` (user request): the mod takes the keyboard
  meanwhile, and presses queued during a save go in one write.
- **Mod keys in `layout:eric`:** they override `global` only while that layout
  shows, so the shipped layouts keep working keys.
- **Ported, not shared, plugin rules:** the mods re-implement `next_agent.py`,
  `spaces_env.py` and `pr_status.py` in JavaScript; the Python plugins stay for
  terminal Herdr. The ported test cases are in `lib/herdr-app-mods/`.
- **One `done` you looked at stays read:** the app keeps reporting `done` for a
  focused agent while its window is in the background; the ledger only raises a
  new `done` after a turn (`worked`).
- **Pi Tasks reuses the form and state:** only the five socket calls change
  (`app-rpc.mjs`); worktrees go where the app's own dialog puts them.
- **Titles as labels, no frames:** in the app the extension sets one
  `task_summary_pending` label instead of animating, because every label change
  redraws the window.
- **Resume by labels:** the Pi side records the session file and shell pid as
  herdr-core labels (they survive recovery); a changed pid marks a recovered
  terminal, since `reason` is null after a holder loss. Each recovered shell is
  decided once (`pi.resumed`), and only a bare shell gets typed into.
- **Import never double-runs a conversation:** conversations of workspaces the
  running terminal Herdr server lists are not resumed; split sizes come back even
  (no resize command).

## Verification

All on 2026-11-04, repository root, unless noted.

- `node --test lib/herdr-app-mods/*.test.mjs` — passed, 51 tests.
- `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/herdr-import -p 'test_*.py'` — passed, 8.
- `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/herdr-review -p 'test_*.py'` — passed, 35 (real tuicr included).
- `node --test herdr/plugins/task-launcher/*.test.mjs` — passed, 99;
  `python3 herdr/plugins/task-launcher/pty-smoke.py` — passed (terminal Herdr path).
- `bun test ./pi/extensions/herdr-task-summary/*.test.ts` — passed, 31;
  `bun test ./pi/extensions/herdr-app-resume/*.test.ts` — passed, 5.
- `bin/theme` against a temporary HOME — writes `theme`/`appearance`, keeps other
  keys, refuses invalid JSON; live: `settings.json` set to `catppuccin-latte`.
- `dotfiles-link` unit tests and the empty-home check — passed; real `check` — 0 pending.
- `herdr-app check` for all seven mods — passed; `herdr-app status` — layout `eric`, no errors.
- App keys: `keys()` lists all 48 `layout:eric` bindings with their actions.
  Physical key presses were not sent (no safe way to type into the window); each
  command was run with `herdr-app do`.
- Live, with fake OSC 7501 agents in a temporary repository and worktrees: tree
  nesting and dots, `next-agent.jump` (blocked first, cycling), `back`,
  `toggle-unread` kept until a reply, attention pane headers, `spaces-env.send`
  / `toggle` / `select` / `next` / `prev`, `spaces-tree.move-up/down` (stops at the
  end), `pane-keys.last/next/agent/worktree`, scrollback popup (closing ends its
  terminal), review popup (tuicr comment delivered untagged with `hc send`), Pi
  Tasks (form, named worktree Space, single Pi tab, Pi replied), task title label
  ("Reload session"). All test Spaces, terminals, the worktree and its Pi session
  folder were removed afterwards.
- Live pull requests: ckc-de04 worktrees showed `#264` open (green), `#265` draft
  (grey), `#266` merged (purple) with icons; closed Spaces left the cache.
- `herdr-import --dry-run` (real session) and
  `herdr-import --workspace w3N --shells-only --state /tmp/…` — one Space,
  three panes in the saved split, Personal; closed afterwards.
- `dotfiles-bootstrap --check` — Herdr app step all ok; Brewfile reports
  `gcloud-cli` (pre-existing) and `herdr-app` (until adopted).
- Recovery, on a separate core (`HC_SESSION=rt`, temporary `XDG_STATE_HOME`): a
  core stop or kill keeps programs (the holder survives); killing the holder gives
  each kept terminal a new shell, same address and labels, status cleared.
- Live resume: a throwaway Pi labelled its terminal (`pi.session`, `pi.shell` =
  the terminal's pid); `kill -9` of Pi was left alone (same shell); a fresh shell
  tab given those labels with another `pi.shell` got `pi --session` typed in and
  reopened the conversation with its history; `/quit` cleared the labels. The
  Space, session folder and core were removed afterwards.
- 2026-11-05: after the adopt, `brew list --cask` lists `herdr-app`, the app is
  still 0.1.13 and running, and `brew bundle check --no-upgrade` reports only
  `gcloud-cli` (pre-existing).
- 2026-11-05, mission control: `node --test lib/herdr-app-mods/*.test.mjs` — passed,
  60; `herdr-app check` on the mod — passed; `dotfiles-link apply` created only its
  three links; `herdr-app status` — no errors, no `keys.error`. Live:
  `herdr-app do mod.open --name mission-control` showed the Personal Spaces'
  57 terminals with screens and "here" on the focused pane (`herdr-app shot`);
  closed with `overlay.close`. After the agents-only change: tests passed, 60;
  `check` passed; live it showed "Personal · 3 agents" and no shell cards.
  Key presses inside the dialog (moves, Enter) and clicks were not sent.
- 2026-11-05, mission control motion (native `spring`/`transition`: opening
  fade and rise, springy scroll, a gliding selection ring, a fading title tint):
  tests passed, 62; `check` passed, but it draws no cards, so it does not reach
  the motion calls (a deliberately bad property passed too). Live: reloaded,
  `herdr-app status` no errors; a shot 0.15 s after `mod.open` showed the cards
  part-faded and low, a later one settled with the ring on "here"; closed with
  `overlay.close`. The ring's glide and the scroll spring were not exercised:
  no keys or wheel were sent.
- 2026-11-05, motion in every repository mod ([HERDR-APP.md](../../HERDR-APP.md#motion)):
  tests passed, 63 (one new: a folded repository's worktrees are listed hidden,
  and stay out of the agent order and moves); `check` passed on all five mods,
  but none of them draws rows in `check`. Live: the four mods reloaded,
  `herdr-app status` showed no errors, and the sidebar and pane header looked
  as before. A throwaway dialog mod (`mods/zz-motion-probe`, opened, shot, then
  closed and deleted) showed what the sidebar relies on: height and opacity
  transitions in a flex column, a timer started from `render`, and an absolute
  tint adding no gap. Not exercised: folding, switching Spaces, a status change,
  hover. The status bar row is 0 px in `eric.json`, so its motion is not on
  screen.
- 2026-11-06, conversation picker: `node --test lib/herdr-app-mods/*.test.mjs` —
  passed, 93 (10 new: titles agree with spaces-tree, the search fields, word
  matching, ranking with and without a query, list layout and scrolling,
  pane-keys' `remember`); `herdr-app check` passed on `conversation-picker`,
  `pane-keys` and `sidebar-header`; `dotfiles-link apply` created only its links;
  `herdr-app status` no errors, no `keys.error`. Live: `pane-keys.recent`
  appeared in `shared.json` with the focused agent; `mod.open` showed the popup
  sized to its content, Recent with five agents (Work badge, `here`, To review)
  and the preview's screen text (`herdr-app shot`); a throwaway copy starting
  on `herdr pan` (`mods/zz-cp-probe`, deleted after) showed one Top hit and
  "1 of 5". Closed with `overlay.close`. Not exercised: key presses (typing,
  moves, Enter), clicks, the wheel, and the motion.
- 2026-11-06, sidebar in the right-hand panel: `node --test
  lib/herdr-app-mods/*.test.mjs` — passed, 107 (new: 3 for `tab-bar`'s
  window-button room, 1 for the sidebar as a panel view, a check that the
  removed Changes view says so; the rest includes concurrent pane-resize
  work); `herdr-app check` passed on `tab-bar`, `spaces-tree`, `pane-keys`,
  `brief` and `conversation-picker`; `dotfiles-link apply` created only
  `tab-bar`'s links and its test link and removed `sidebar-header`'s two;
  `herdr-app status` no errors, no `keys.error` or `layout.error`. Live
  (`herdr-app shot`): tab bar with tabs only and room for the window buttons;
  the sidebar as a rounded card in the panel, clean corners; `herdr-app do
  pane-keys.panel:brief`, `:files`, `:sidebar` swapped the panel to each, and
  `:sidebar` again closed it (then reopened on the sidebar). The Settings
  preview SVG renders (Quick Look). Not exercised: the physical `C-a b`,
  `Cmd+B`, `C-a f` and `C-a i` presses.
- 2026-11-06, pane resizing: `node --test lib/herdr-app-mods/*.test.mjs` —
  passed, 106 at the time (5 new for `resizePlan`); `herdr-app check` passed on
  `pane-keys`; `herdr-app status` no errors, no `keys.error`. Live: a direct
  `doc.set` of a background tab's weights to 0.7/0.3 showed as 144/59 columns
  once the tab was opened, and back at 0.5/0.5 the visible tab redrew within
  0.3 s. Then `herdr-app do pane-keys.resize:left` on the right pane of a
  50/50 split: 0.45/0.55 (90/112 columns); two quick presses ran in turn to
  0.35/0.65; three `:right` presses restored 0.5/0.5. Not exercised: the
  physical `C-a H/J/K/L` presses, a nested split, a remote machine's pane.
- 2026-11-06, resize repeat: tests passed, 109 (2 new: queued presses in one
  write, the repeat keys); `herdr-app check` passed on `pane-keys`. Inside the
  app a `doc.get` round trip took 12-16 ms (temporary timing, removed). Live:
  `herdr-app shot` 120 ms after `herdr-app do pane-keys.resize:left` showed
  the focused pane without its focus border; 1 s later it was back on the same
  pane. Not exercised: physical `H/J/K/L` repeats (no way to send keys here).
- Not verified: macOS Notification Center delivery by the app; the `home` machine;
  a real reboot.

## Risks and recovery

- A broken layout or keys file: the app keeps the last good one and writes
  `<name>.error`; `ctrl-alt-shift-escape` resets to `main`. `layout.switch main`
  returns to the shipped layout.
- Running one Pi conversation in both apps at once can corrupt its history: the
  import refuses those while terminal Herdr has them open.
- `C-a H/J/K/L` rely on the undocumented `herdr-app` core document: after an app
  update they may show a `pane-keys resize` error and change nothing; dragging
  still resizes. Each press rewrites that whole document (changing two
  weights), so a bug there could damage the app's Spaces and tabs.
- App updates replace shipped mods; `spaces-tree` and `attention-pane` are copies
  of 0.1.12's `spaces` and `pane`, and `tab-bar` of 0.1.13's `tabs`; they may
  need re-basing on a new release.
- The sidebar publishes the Space and conversation order other keys use
  (`C-a S-1..9`, `C-a M-1..9`, `C-a u`) when it draws. If the app does not draw
  it while Files or Brief shows, Spaces and conversations made meanwhile join
  the end of those orders until the sidebar shows again (not checked).

## Outcome

Pending: the `home` machine.
