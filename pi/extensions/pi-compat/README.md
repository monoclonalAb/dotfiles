# Pi compatibility check

Some workflows here use parts of Pi that are not public: private editor members,
files inside Pi's package, Pi's exact prompt text. A Pi update can break them
without warning. After each Pi update, their tests run once against the new Pi,
and any failure shows in Pi's footer.

## What happens after an update

1. 10:00: `pi update` (or `npm install -g`) installs Pi 1.7.0.
2. 10:01: within a minute, an open Pi session sees that 1.7.0 has no check yet and
   starts [`pi-compat-check`](../../../bin/pi-compat-check) `--if-new` in the
   background. With no Pi open, the next Pi you start does this. Its footer shows
   `checking Pi 1.7.0`; other sessions see the check running and start nothing.
3. About 90 seconds later, either:
   - all pass: that session says `Pi 1.7.0 passed all 19 extension checks.` and the
     footer clears; or
   - some fail: every session's footer shows `Pi 1.7.0: 2 checks failed`, and each
     Pi process says once which workflows are affected.
4. `pi-compat-check --status` lists each failed suite, its command and its log.

Each version is checked once. `pi-compat-check` reruns the checks by hand.

## What it checks

| Workflow | What can break | Suites |
| --- | --- | --- |
| Vim editing and image paste ([`modal-vim-navigation`](../modal-vim-navigation/README.md)) | Private editor and scrolling members; Pi's clipboard files in `dist/utils/` | Bun suite, PTY smoke |
| `/btw`, `/goal`, `/session-breakdown` ([`agent-stuff`](../agent-stuff/README.md)) | `/btw` reuses the Vim editor; a private loader field; session `.jsonl` files read directly | Native suite (including a session file Pi writes), type check |
| Pi Tasks (`C-a t`, [`task-launcher`](../../../herdr/plugins/task-launcher/README.md)) | Three private files in Pi's `dist/` | Node suite, minimal-PATH `--check`, PTY smoke |
| Account switching and footer usage ([`quota-router`](../quota-router/README.md), [`quota-footer`](../quota-footer/README.md)) | Pi's private `ModelRuntime.credentials` | Bun, native and PTY suites of both |
| Compact header and footer ([`compact-ui`](../compact-ui/README.md)) | Patches Pi's footer class; Pi's theme global; the `<project_instructions path=…>` prompt text | Bun suite; `quota-footer`'s PTY smoke draws it in real Pi |
| Stopping idle MCP servers (`mcp-idle-stop`) | How Pi starts MCP servers (wraps `child_process.spawn`) | Bun and native suites |
| Claude via OMP ([`omp-anthropic-route`](../omp-anthropic-route/README.md)) | Pi's `Pi documentation (read only…` prompt block, which it removes | Bun suite; native suites, including one on Pi's real prompt |
| `/restart` and the out-of-date line (`restart`) | Pi's package layout and settings | Bun suite |

The suites use temporary HOMEs, fake providers and fake Herdr; none sends a model
request or touches real sessions. The list is `SUITES` in `bin/pi-compat-check`;
add a suite there when another workflow starts using Pi internals.

Not covered: the `restart` extension's list of settings keys that Pi writes
itself (a new key only causes a false "changed" notice), and anything that shows
only against a real provider.

## When a check fails

1. Run `pi-compat-check --status`. It names each failed suite with its command and
   log, and says whether the repository had local changes. A run during your own
   edits can fail because of them rather than because of Pi.
2. Open the log, or rerun that one command from the repository root.
3. Sessions you have not `/restart`ed still run the old Pi, so they keep working
   until you restart them. New sessions use the new Pi.
4. After the fix, run `pi-compat-check`. The footer clears within a minute.

## Files

- `~/.local/state/pi/compat/<version>/result.json`: what ran, when, at which
  commit, and each suite's status and log.
- `~/.local/state/pi/compat/<version>/logs/<suite>.log`
- `~/.local/state/pi/compat/running.json`: the running check's pid, so only one
  runs at a time. A lock left by a process that died is replaced.

Only interactive (TUI) sessions take part; `pi -p` and RPC sessions never start a
check. Nothing reaches the model.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/pi-compat -p 'test_*.py'
bun test ./pi/extensions/pi-compat/*.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/pi-compat/pty-smoke.py
```

The first runs the script with fake suites and a fake npm Pi: results, `--if-new`,
`--status`, the lock, timeouts and termination. It also checks that every file
named in `SUITES` exists. The second covers the extension's footer status and
notices with a fake launcher. The third starts fullscreen Pi with an isolated HOME
and the extension linked as deployed. The extension starts the real script with
one fixture suite, and a saved failure then shows in a new Pi's footer.
