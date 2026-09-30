# Verification runbook

Run commands from the repository root unless stated otherwise. Choose only the
rows relevant to the change; there is no single repository-wide test command.
Read the check's source before executing it if its side effects are unfamiliar.
A missing prerequisite is a reported gap, not permission to install it silently.

## Source-only checks

These do not deploy configuration or intentionally contact running applications.
Use temporary directories outside the repository for generated output.

| Area | Command | Evidence and limitations |
| --- | --- | --- |
| Diff hygiene | `git diff --check` and `git status --short` | Whitespace and worktree changes, not correctness; inspect newly created files too |
| Shell syntax | [Shell syntax commands](#shell-syntax) below | Syntax only; use the interpreter in the affected script's shebang |
| Zsh syntax | [Shell syntax commands](#shell-syntax) below | Syntax only; does not exercise startup or commands |
| Herdr attention ledger / jumps | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -p 'test_*.py'` | Ledger and mocked focus API; no live server |
| Herdr next-agent terminal flow | `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/next-agent/pty-smoke.py` | Installed Herdr; isolated server/client in its own PTY with synthetic lifecycle reports. `HERDR_TEST_BIN=<binary>` tests a build-only binary |
| Herdr environment grouping | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/spaces-env -p 'test_*.py'` | Includes temporary-state concurrency tests; no live server |
| Pi task launcher | `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs`, then `python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py` | Installed npm Pi/Node; temporary Git fixtures, fake Herdr/Pi, loopback naming provider; no real clipboard or agent |
| Pi task launcher prerequisites | `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh herdr/.config/herdr/plugins/task-launcher/launch.sh --check` | Minimal-PATH Pi/Node resolution; no model requests |
| Herdr review popup | `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s bin/.local/lib/herdr-review -p 'test_*.py'` | Fake Herdr/tuicr; with tuicr installed, also drives real tuicr in a PTY. No live Herdr or agent input |
| Terminal Neovim opener | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s bin/.local/lib/terminal-links -p 'test_*.py'` | Hint TOML/argv and headless Neovim; GUI launches mocked |
| Workspace Context MCP | `node --test bin/.local/lib/workspace-context-mcp/*.test.mjs` | Temporary fixture workspace and a spawned stdio server; never reads the real workspace |
| Pi extensions (Bun) | `bun test ./pi/.pi/agent/extensions/<name>/*.test.ts` — one command per extension | Installed npm Pi; mocked runtime/providers. Applies to `herdr-task-summary`, `theme-sync`, `compact-ui`, `quota-footer`, `quota-router`, `codex-fast`, `long-context`, `omp-anthropic-route`, `modal-vim-navigation`, `local-file-links` |
| Pi extensions (Node native) | `node --test pi/.pi/agent/extensions/<name>/*.test.mjs` | Real Pi SDK sessions with isolated HOME and synthetic providers. Applies to `agent-stuff`, `quota-footer`, `quota-router`, `codex-fast`, `omp-anthropic-route` |
| Pi agent-stuff public API | `node pi/.pi/agent/extensions/agent-stuff/typecheck.mjs` | Installed `tsc` and Pi public types |
| Pi terminal flows | `PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/<name>/pty-smoke.py` | Fullscreen Pi in its own PTY with isolated HOME. Applies to `theme-sync` and `quota-footer` (which also covers `compact-ui`) |

Run Pi suites as separate commands: some install module mocks for the installed
Pi packages. None make real provider requests, so they do not prove provider
acceptance, billing, or rendered UI.

### Shell syntax

Parse each file separately; passing several filenames to a shell does not check
all of them. The subshells below stop on a failed parse without exiting the
operator's shell.

```sh
(
  for file in bin/.local/bin/pi bin/.local/bin/dotfiles-update bin/.local/bin/install-herdr-focus bin/.local/bin/workspace-context-mcp bin/.local/bin/tailscale; do
    sh -n "$file" || exit 1
  done
)
bash -n bin/.local/bin/theme
bash -n bin/.local/bin/dotfiles-bootstrap
sh -n herdr/.config/herdr/plugins/task-launcher/launch.sh
(
  for file in zsh/.zshenv zsh/.config/zsh/.zshrc zsh/.config/zsh/.zprofile; do
    zsh -n "$file" || exit 1
  done
)
```

## Documentation and Stow

1. Resolve relative Markdown links and local HTML `src`/`href` targets from the
   containing document, including heading fragments. Exclude illustrative code
   blocks and remote URLs from filesystem checks. Skill examples naming paths in
   other repositories are prerequisites, not missing dotfiles files.
2. Verify new/renamed headings still match incoming links. Check commands and
   factual claims against their source owner, not just link existence.
3. Confirm the knowledge base deploys nothing:

   ```sh
   stow -n -v -t "$HOME" docs
   ```

   Expected: exit 0 and no link/unlink actions. This is a **dry run**, not a deploy.
4. For package layout changes, substitute the owning package for `docs` and
   inspect every proposed link and conflict. A successful dry run with pending
   actions is not the same as an already deployed package. Never automatically
   resolve a conflict with `--adopt`, deletion, or a blanket move of app state.
5. If the owning package's dry run also lists unrelated pending files, create only
   the new link from Stow's exact `LINK: <target> => <source>` line, then re-run the
   dry run to confirm it no longer appears. Leave the other files to their owner.

For an independent check that `docs/` leaves an empty target unchanged:

```sh
(
  target=$(mktemp -d) || exit 1
  trap 'rmdir "$target"' EXIT
  stow -n -v -t "$target" docs
)
```

Link validation is currently a manual or ad-hoc check, not an enforced repository
command; see [Q-002](QUALITY.md#open-technical-debt).

## Host diagnostics and live checks

These read deployed configuration or run application code. Review prerequisites
and side effects first; use them when the affected live path is in scope.

| Area | Check | Boundary / caution |
| --- | --- | --- |
| Shell | `zsh -ic 'exit'`, then the affected command | Runs startup hooks and may write local caches. Record warnings even if exit status is 0 |
| Theme | `theme status`, then inspect the affected consumer | Diagnostic only; a status report does not prove visual updates. `theme apply`, `set`, `cycle`, and `opacity` write outputs and reload consumers |
| Herdr config | `herdr config check` | Checks generated deployed config, **not** an unstaged or ungenerated base-file edit |
| Herdr review target | `HERDR_ACTIVE_PANE_ID=<pane> HERDR_ACTIVE_TAB_ID=<tab> bin/.local/bin/herdr-review --check` inside Herdr | Read-only: resolves the agent, directory and tuicr command; opens nothing |
| Pi Tasks native UI | [Pi Tasks verification](../herdr/.config/herdr/plugins/task-launcher/README.md#verification) | Needs the deployed plugin and regenerated config; keep the task text empty |
| tmux | `tmux source-file ~/.config/tmux/tmux.conf` | Changes the running server and executes configured hooks/plugins; not syntax-only |
| Neovim | `nvim --headless '+qa'`, then `nvim +checkhealth` when appropriate | Startup can bootstrap/download plugins and language tools; only run against a reviewed, provisioned environment |
| Workspace Context MCP | `bin/.local/bin/workspace-context-mcp doctor`, then `call <tool> '<json>'` | Reads the real workspace roots; no writes or network |
| New-Mac bootstrap | `bin/.local/bin/dotfiles-bootstrap --check`; for a blank machine's view, `(t=$(mktemp -d) && env -i HOME="$t" PATH=/usr/bin:/bin bin/.local/bin/dotfiles-bootstrap --check; rm -rf "$t")` | Changes no configuration, but runs `brew bundle check`, a Stow dry run and Herdr status queries, which may write their own caches and locks. The default mode installs software; never run it as a check |
| Pi MCP registration | `pi mcp list` from the project directory, then `/reload` and `/mcp` in Pi | Starts every enabled server (npx, gcloud, local HTTP) and exits 1 on a config error or a server that did not connect; reads project `.pi/mcp.json` only in trusted projects. `pi mcp add`/`remove` write through the link into the repository |
| Pi extension loading | Fresh Pi session and the affected command/UI | Startup hooks run. The [Anthropic route's OMP update check and model probe](../pi/.pi/agent/extensions/omp-anthropic-route/README.md#request-preflight) wait for the first direct Claude OAuth request (including SDK/extension requests), which may upgrade OMP and uses probe quota |
| Patched Herdr binary | `install-herdr-focus --build-only <temporary-output-path>`, then `HERDR_CONFIG_PATH=<staged config> <binary> config check` | Network/toolchain build plus the patch's tests; does not replace the installed binary. `--version` must include `dotfiles.<patch-hash>` |

Do not restart a live Herdr server, reload another agent conversation, or run
`dotfiles-update` just to obtain a green check. If safe integration verification
is unavailable, report the remaining boundary rather than weakening the check.

## Explicitly approved live Herdr handoff

Only when the user asks for it; never as routine verification. `server stop`
kills pane processes, so never use it as a fallback while agents are running.

1. Require `server.capabilities.live_handoff = true` and a compatible protocol in
   `herdr status --json`. Rehearse old → new with an isolated server first.
2. Record pane/Space/tab IDs, focus and pane PIDs. Back up the installed binary and
   generated config under `~/.local/state/herdr/deployments/`.
3. Stage the config from `config.base.toml` and `theme`'s `herdr_theme`, check it
   with the new binary, then install binary and config atomically.
4. Run `herdr server live-handoff` with the installed executable. Clients
   disconnect; the user reconnects with `herdr`.
5. Verify the new server PID/executable and unchanged pane processes, topology and
   focus. Handoff drops transient `task_summary` tokens and can clear unread
   attention flags ([Q-007](QUALITY.md)); do not send input to agents to repair them.
6. On failure, find which server owns the socket before restoring anything. Never
   blindly retry, kill pane processes, or overwrite concurrent changes.

## Report evidence

For each relevant check, record the exact command, observed result, and limitation:

- **Passed:** ran successfully against the relevant inputs.
- **Failed:** ran and found a problem; distinguish task-related and existing failures.
- **Blocked:** could not run because a named prerequisite or permission is missing.
- **Not run:** deliberately omitted, with the reason and any remaining manual step.

Tests from an earlier plan are historical evidence. Do not copy their results
into a new completion report without rerunning or explicitly labelling them as
historical. Prose-only changes do not justify increasing a [quality grade](QUALITY.md).
