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
| Herdr attention ledger | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -p 'test_*.py'` | Standard-library tests; discovery handles the hyphenated directory |
| Herdr environment grouping | `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/spaces-env -p 'test_*.py'` | Includes temporary-state concurrency tests; no live server |
| Pi task summaries | `bun test ./pi/.pi/agent/extensions/herdr-task-summary/summary.test.ts` | Injected reporter; no live pane updates |
| Pi long-context toggle | `bun test ./pi/.pi/agent/extensions/long-context/index.test.ts` | Mocked extension runtime; verifies model metadata switching and UI state, not provider acceptance or billing |
| Pi Anthropic route | `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` | Mocked token/update/transport plus a loopback HTTP server and Bun subprocess; not a provider or billing check |
| Pi Vim navigation | `bun test ./pi/.pi/agent/extensions/modal-vim-navigation/index.test.ts` | Requires npm and globally installed `@earendil-works/pi-coding-agent`; exercises installed editor APIs, not a rendered terminal |

Run Pi suites as separate commands: the navigation suite installs module mocks
for the installed Pi packages. A focused pass does not prove global extension
discovery, context neutrality, provider compatibility, or UI behaviour.

### Shell syntax

Parse each file separately; passing several filenames to a shell does not check
all of them. The subshells below stop on a failed parse without exiting the
operator's shell.

```sh
(
  for file in bin/.local/bin/pi bin/.local/bin/dotfiles-update bin/.local/bin/install-herdr-focus; do
    sh -n "$file" || exit 1
  done
)
bash -n bin/.local/bin/theme
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
| tmux | `tmux source-file ~/.config/tmux/tmux.conf` | Changes the running server and executes configured hooks/plugins; not syntax-only |
| Neovim | `nvim --headless '+qa'`, then `nvim +checkhealth` when appropriate | Startup can bootstrap/download plugins and language tools; only run against a reviewed, provisioned environment |
| Pi extension loading | Fresh Pi session and the affected command/UI | Global hooks may run at startup, including the [Anthropic route's Homebrew update attempt](../pi/.pi/agent/extensions/omp-anthropic-route/README.md#compatibility-and-risk); no fresh session needed for prose-only edits |
| Patched Herdr binary | `install-herdr-focus --build-only <temporary-output-path>` | Network/toolchain/build side effects but no installed-binary replacement; follow the [setup guide](../README.md#8-set-up-each-tool) and inspect the installer first |

Do not restart a live Herdr server, reload another agent conversation, or run
`dotfiles-update` just to obtain a green check. If safe integration verification
is unavailable, report the remaining boundary rather than weakening the check.

## Report evidence

For each relevant check, record the exact command, observed result, and limitation:

- **Passed:** ran successfully against the relevant inputs.
- **Failed:** ran and found a problem; distinguish task-related and existing failures.
- **Blocked:** could not run because a named prerequisite or permission is missing.
- **Not run:** deliberately omitted, with the reason and any remaining manual step.

Tests from an earlier plan are historical evidence. Do not copy their results
into a new completion report without rerunning or explicitly labelling them as
historical. Prose-only changes do not justify increasing a [quality grade](QUALITY.md).
