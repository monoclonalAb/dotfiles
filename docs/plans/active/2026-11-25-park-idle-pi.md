# Park idle Pi conversations and reopen them on return

**Status:** Active (plan; no PR merged)
**Scope:** [`bin/pi`](../../../bin/pi), a new `pi/extensions/park-idle/`,
[`herdr-app-resume`](../../../pi/extensions/herdr-app-resume/index.ts),
[`pi-resume`](../../../herdr-app/mods/pi-resume/main.js), their tests and
operator docs. Live: the Herdr app (`herdr-app` 0.1.18, `hc` 0.1.22) and npm Pi 1.6.0.

## Objective

The owner keeps finished Pi conversations open in the Herdr app to come back to
(48 on 2026-11-25, 43 of them done). Each idle Pi holds ~180 MB plus ~300 MB of
MCP servers. After 2 hours with no input and no agent work, Pi quits to free
that memory, but its terminal stays where it was and still shows as a Pi
conversation in the sidebar. Coming back to the terminal reopens the same
conversation (`pi --session <file>`) in about a second. Quitting Pi yourself
still ends the conversation for good.

## Non-goals

- Stopping MCP servers of running sessions (sibling task `mcp-idle-stop`) or
  sweeping today's sessions (`mcp-stop-idle-now`).
- Sessions started before this ships: they keep running unparked until restarted
  (their `pi` wrapper already exec'd, so nothing supervises them).
- OMP and other agents.

## How it works

The `pi` wrapper stops `exec`ing Pi in an interactive terminal and runs it as a
child instead. Example:

1. 10:00: you start `pi` (in a shell, a Pi Task, a review Space or an app
   launcher: all four run the [`pi`](../../../bin/pi) wrapper; login shells
   resolve `pi` to `~/.local/bin/pi`). If the terminal is interactive and every
   option is one it can replay, the wrapper sets `PI_PARK_FILE` to a private
   path and starts Pi as its child; otherwise it `exec`s Pi as today.
2. 10:20: Pi finishes a reply. You move on to other Spaces.
3. 12:20: nothing has happened for 2 hours: no key reached Pi, no agent run,
   the editor is empty, no shell command runs under Pi, Pi serves no page and
   the terminal has no live `hc` sub-terminals. The new `park-idle` extension writes the session file to
   `PI_PARK_FILE` and calls `ctx.shutdown()`. Pi exits; its MCP servers stop
   with it. `herdr-app-resume` sees the park file and keeps its labels.
4. The wrapper (~1 MB) restores the terminal, prints one line ("Pi closed while
   idle to free memory. Press a key to reopen this conversation."), reports
   `state=idle:app=pi` (OSC 7501) so Herdr still lists a Pi conversation, turns
   on focus reporting, and waits for input.
5. 15:00: you focus the pane. The app sends focus-in (or you press a key; a
   focus-out alone is ignored); the wrapper swallows that input and runs
   `pi --session <file>` with the original run's replayable flags. The
   conversation is back with its last message.
6. Later you quit Pi (`Ctrl+D`, `/quit`): no park file, so the wrapper exits with
   Pi's status as today and the labels are cleared. A park file with a non-zero
   exit also exits with that status. While parked every key wakes it, `Ctrl+C`
   included: to end it, reopen and quit, or close the tab.

## Prototypes (measured 2026-11-25, `/tmp/park-proto`, throwaway `hc` terminals)

- **Herdr status survives Pi:** a child printed `state=done:app=pi` and exited;
  the terminal kept that status until another process in it sent
  `state=idle:app=pi` (then shown as such) or `state=clear` (then `null`). Pi
  itself sends `state=clear` when it stops (`pi-tui` `terminal.js` `stop()`).
- **Full loop:** a prototype wrapper and extension (15 s threshold) parked a real
  Pi: Pi gone, the wrapper and `dd` 1.6 MB RSS together, status
  `{app: pi, state: idle}`. `hc keys <t> a` brought back the conversation with
  its last message visible in 0.7 s, on the same model (`gpt-6-luna`, not the
  default). `Ctrl+D` then ended the terminal with exit 0 and removed the park
  directory.
- **Wake delivery:** `hc keys` reached a raw reader in ~40 ms.
- **Sub-agents:** an `hc run --bg` child stayed live when the process that
  started it exited, and ended only when its parent terminal ended.
- **Listening Pi:** one of the owner's Pi processes listens on a local TCP port
  (an open `/artifact-review` page); its server dies with Pi.
- **Focus from the app:** a throwaway Space ran a reader with focus reporting on
  (`ESC [ ? 1004 h`). `pane.focus` on it, with Herdr not the front app, delivered
  `ESC [ I`; moving focus back delivered `ESC [ O`. The wrapper wakes on focus by
  itself, so PR 3 is dropped, and it must ignore focus-out.

## Risks from the brief, answered

- **Herdr loses the session while parked:** no. The wrapper reports `idle` with
  `app=pi`; agents are terminals with a status and "an agent's own report wins"
  for the program icon (`~/.config/herdr-app/AGENTS.md`). `next-agent` keeps a
  live terminal's ledger entry when it briefly drops out, and an `idle` report
  never clears `unread`, so an unseen finish stays marked. Reporting `done`
  instead was rejected: it could raise a new "finished" alert per parked session.
- **Lost when Pi quits:** an unsent draft (never park with editor text); `/fast`
  set inside the session (as on `/reload`; `--fast` on the command line is
  kept); an open `/artifact-review` page (never park while Pi listens on a TCP
  port); the open `/btw` overlay (its thread is saved with `appendEntry` and
  restored on `session_start`, `btw.ts`). Background programs the agent started:
  the bash tool untracks its shell once it exits and a normal quit kills nothing
  (`bash.js`, `interactive-mode.js`), so they survive; `hc` sub-terminals
  survive but would type their notes into the waiting wrapper, so never park
  while one is live. Kept: the conversation, model and thinking level
  (measured), session name, and `/skill` choices (`selective-skills.ts` restores
  its `appendEntry` state on `session_start`; to confirm in PR 2).
- **Typing race:** the wrapper owns the terminal while parked; nothing reaches a
  shell. The waking input (focus-in or the first key) is swallowed; keys typed
  while Pi starts wait in the terminal and land in Pi's editor.
- **Focus-out:** ignored, or leaving a parked pane would reopen it.
- **Reboot while parked:** labels are kept, so `pi-resume` reopens every parked
  conversation at once after a reboot (40 × ~480 MB). PR 4 brings them back parked.
- **Idle threshold:** 2 hours, `PI_PARK_AFTER=<seconds>` overrides (0: never).
- **A nested Pi** (run by the agent) inherits `PI_PARK_FILE`; the extension parks
  only when its parent is the wrapper that set it (`PI_PARK_PID`).
- **Options a resume would lose** (`--no-tools`, `--tools`, `--system-prompt` …):
  such runs are not supervised at all, so they never park. Replayed:
  `-a/--approve`, `-na/--no-approve`, `--no-skills`, `-e/--extension`,
  `-ne/--no-extensions`, `--no-mcp`, `--tui-mode`, `--session-dir`, `--fast`,
  `--offline`. Dropped as the session restores or
  replaces them: messages and `@files` (before or after `--`), `--session`,
  `--session-id`, `-c`, `-r`, `--fork`, `-n/--name`, `--provider`, `--model`,
  `--thinking`. Anything else, `-p` and `--mode` included, means `exec`.
- **A `!command` still running:** `isIdle()` ignores it and shutdown would abort
  it, so never park while Pi has a direct child that is a shell (measured on
  this session's Pi: its children are the MCP servers, `npm exec` or `node`, and
  `/bin/bash -c` for a running command).
- **Reading by scrolling:** fullscreen Pi consumes clicks and scrolling before an
  extension's input listener sees them, so two hours of reading without a key
  can park it; a key reopens it at the bottom. Accepted.
- **Signals:** Pi stays a foreground child in the same process group, so a tab
  close (terminal hangup) reaches both; the wrapper sets no HUP or TERM trap (a
  shell defers traps until its foreground child exits). `Ctrl+Z` stops both and
  `fg` resumes both. PR 1 checks `hc kill` and a Pi Task tab close leave no
  process.

## PRs

Each PR rebases on `origin/main`; they stack in this order because none is
merged here (`rho-may-merge` says no for this repository).

### PR 1: the `pi` wrapper can hold a parked conversation

- **Waits for:** nothing. **Files:** `bin/pi`, new `lib/pi/test_pi.py`,
  `docs/AGENT-TOOLS.md`, `docs/VERIFICATION.md`.
- **Change:** with a terminal on stdin and stdout, run Pi as a child with
  `PI_PARK_FILE`/`PI_PARK_PID`; after Pi exits with a session in the park file,
  report `idle`, print the line, wait raw for input other than focus-out, then
  rerun Pi with `--session <file>` and the replayed flags; anything else exits
  with Pi's status. Runs that are not interactive or carry other options still
  `exec`.
- **You see:** nothing yet (nothing writes the park file).
- **Done check:** `python3 -m unittest discover -s lib/pi` runs the wrapper in a
  pseudo-terminal with a fake `pi`: a parked fake leaves no `pi` process, the
  screen has the line and `state=idle:app=pi`; one key reruns it with exactly
  the replayed flags and `--session <file>`; focus-outs do not; a park file with exit 7 exits 7; a plain exit passes the
  status through; `pi -p`, `--no-tools` and a pipe are the same process (exec).
  By hand: the worktree wrapper runs a real Pi in `hc` terminals in the four
  launch forms; `Ctrl+D` still exits as before (the review and launcher forms
  return to their shell, the first message is sent once), `Ctrl+Z`/`fg` works,
  and `hc kill` leaves no process.

### PR 2: Pi parks itself after 2 idle hours

- **Waits for:** PR 1 (to prove it). **Files:** new `pi/extensions/park-idle/`
  (`index.ts`, test, README), `pi/extensions/herdr-app-resume/` (keep labels
  when parking), `pi/extensions/README.md`, `docs/AGENT-TOOLS.md`,
  `docs/HERDR-APP.md` (new "Idle conversations" next to "After a reboot"),
  `docs/VERIFICATION.md`.
- **Change:** the extension arms a timer on start, on any terminal input and when
  an agent run settles; when it fires and every rule above holds, it writes the
  park file and calls `ctx.shutdown()`; otherwise it re-arms.
- **You see:** a parked pane (screenshot of a throwaway Space for review before
  merge); the sidebar row and icon unchanged.
- **Done check:** in a throwaway Space in the app running the worktree wrapper
  with `PI_PARK_AFTER=20` and a temporary `PI_CODING_AGENT_DIR` that links
  everything in `~/.pi/agent` except these two extensions, which link to the
  worktree (`-ne` would also turn off MCP): before parking its MCP server pids
  exist; after 20 s they and Pi are gone, the terminal is live with `idle`/`pi`
  and still labelled `pi.session`; focusing it (or a key) shows the last message
  within 5 s from the same file and the `/skill` choice; a draft and a running
  `!sleep 60` each keep it running past 20 s; `Ctrl+D` clears the labels. Plus
  `bun test` for both extensions.

### PR 3 (dropped: the app sends focus-in): wake a parked pane on focus

- **Waits for:** PR 2. **Files:** `herdr-app/mods/pi-resume/main.js`, its test,
  `docs/HERDR-APP.md`.
- **Change:** the wrapper labels its terminal `pi.parked` only once it waits,
  and clears it before starting Pi; when the focused terminal carries it, the
  mod presses one key there with `hc keys`.
- **Done check:** the PR 2 check passes by focus alone, including for a pane
  that was already selected when it parked.

### PR 4: after a reboot, parked conversations come back parked

- **Waits for:** PR 2. **Files:** `bin/pi` (`--parked`: start in the waiting
  state), `herdr-app/mods/pi-resume/main.js` and its test,
  `pi/extensions/park-idle/` (label `pi.parked`), `docs/HERDR-APP.md`.
- **Change:** `herdr-app-resume` also labels the replayed flags (`pi.args`, a
  JSON list the wrapper exports), so a recovered terminal gets them back: today
  a reboot drops `--approve`/`--no-approve`. `pi-resume` types
  `pi [--parked] <flags> --session '<file>'`, with `--parked` when the terminal
  was labelled `pi.parked`.
- **Done check:** `node --test lib/herdr-app-mods/*.test.mjs` (a parked label
  gives the parked command; flags are quoted one by one; unlabelled ones as
  today) and the wrapper test for `--parked` (waits without starting Pi, then
  reopens on a key with the flags).

Parallel: PR 1 and the code of PR 2 touch different files; PR 3 and PR 4 both
touch `pi-resume` and go one after the other. Screenshots before merge: PR 2
(parked pane) and PR 3 if it exists.

## Rejected

- **Pi exits to a shell and `pi-resume` types `pi --session` on focus** (the
  brief's sketch): a Pi Task tab closes when Pi exits 0 (the launcher exits and
  deletes its request); keys typed on return mix into the typed command; the
  terminal becomes a plain shell, so the sidebar, `next-agent` and Mission
  control drop it; three exit paths need their own handling.
- **A special exit code handled by each launcher:** the same three places to
  change instead of one wrapper.

## Decisions

- **No mouse reporting while parked:** clicking an unfocused pane already sends
  focus-in, and the click itself would then reach the new Pi as input. A click on
  the pane that is already focused needs a key.
- **Plan review** (GPT, 2026-11-25, `rho/plan-review-1.md` in the worktree's Git
  dir): adopted all but one. Not adopted: holding PR 2 until PR 4 ships. A
  reboot already reopens every running conversation at once today; parking does
  not add to it.

## Progress

- [x] Prototypes above.
- [x] Focus-in measured in the app: received (PR 3 dropped).
- [ ] PR 1 · [ ] PR 2 · [x] PR 3 dropped · [ ] PR 4
- [ ] Overall done check on a throwaway Space after deployment.

## Verification

- Overall (brief): on a throwaway Space, (1) after the shortened threshold its
  Pi and MCP processes are gone and the terminal remains, (2) focusing it reopens
  the same session file with its last message within ~5 s, (3) a conversation
  you quit never reopens. Not run.

## Outcome

<Complete when moved to completed/.>
