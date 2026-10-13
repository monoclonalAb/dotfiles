# Pi Tasks

`C-a t` opens a popup form: describe the work, pick a model and thinking level,
press Enter. The launcher names the task, creates a new branch and worktree Space
through Herdr, and starts Pi there as the Space's **only tab**. It only ever starts
Pi. It is a local Herdr plugin, not a Herdr patch or a Pi extension.

## Using the form

The task input is Pi's own editor with your `~/.pi/agent/keybindings.json`
overrides, so normal Pi editing keys work. Form-specific keys:

| Key | Action |
| --- | --- |
| `Enter` | Start the task (or activate the selected row) |
| `Ctrl+J` / `Shift+Enter` | Newline |
| `@` / `/` | Complete a file in this checkout / a Pi prompt template (`Tab` accepts) |
| `↑` | Recall a previous task for this repository |
| `Shift+Tab` | Cycle thinking effort |
| `Ctrl+L` | Model picker |
| `Ctrl+P` / `Shift+Ctrl+P` | Cycle models (Pi's `enabledModels`, else all available) |
| `Ctrl+V` / Alacritty `Cmd+V` | Paste a clipboard image as `[img #N]` (text paste still works) |
| `Ctrl+C` | Clear the draft (it is copied to the clipboard first); twice within 500 ms closes |
| `Tab` / `Esc` | Next field / back or close |

**Drafts are kept.** Closing the popup any way other than starting the task (Esc,
Ctrl+D, or Herdr closing it) saves the draft, images included, for that repository.
The next `C-a t` there restores it. Starting the task clears it.

**Rows below the editor:**

- **Model / Thinking.** The model defaults to the last one used for this repository
  (shared across its worktrees), else Pi's startup default. An unavailable model
  must be re-chosen; it never silently switches provider.
- **Start from.** `current` is the source checkout's committed `HEAD` when the form
  opened. `latest origin/main` (or whatever `origin/HEAD` names) fetches that branch
  when you press Start and begins there. The choice is remembered per repository.
  The fetch updates only the `origin/<branch>` tracking ref.
- **Changes** (only when the source has uncommitted work). `leave` keeps them in the
  source, as before. `copy` brings tracked edits, staged files and untracked files
  into the new checkout. Your source checkout is only read. Copying needs Start from:
  `current`.
- **Advanced.** Branch (skips naming), a custom base (overrides Start from) and an
  absolute checkout path outside the source.

Images: PNG, JPEG, GIF or WebP, up to 8 images / 20 MiB per popup. Delete the
marker to drop one. A text-only model is rejected before anything is created.
Images go only to the new Pi conversation, never to task naming.

Cancelling before Start creates nothing except the saved draft. After Start, wait
for the result, because Git operations already issued cannot be cancelled.

## Naming

Start makes one short, tool-free request that turns the task into a 2–6 word name
such as `task/fix-login-spinner`, plus the Space and Pi session name. The form shows
which model will do it:

1. `naming_model` from `~/.config/herdr/plugins/config/martinro.task-launcher/config.toml`,
   for example `naming_model = "lithosai/deepseek-ai/DeepSeek-V4.1-Flash"`.
2. Otherwise Pi's default model (`defaultProvider` / `defaultModel`).
3. Otherwise the task's own model.

Models that must go through the `omp-anthropic-route` Pi extension (direct Anthropic
with a Claude subscription login) are skipped. This launcher loads no Pi
extensions, so it never sends that traffic. A `/template` task is named after the
template's description. If naming fails or takes over 15 s, the task still starts
as `task/untitled-task-<id>` and the popup says why. Set a branch under Advanced
to skip naming.

## Pi in the task tab

- **No trust prompt.** Pi asks to trust every new folder that has `.pi` settings.
  The launcher reuses the decision you already saved for the source checkout (or a
  parent folder) and passes `--approve` or `--no-approve`. If you never decided for
  the source, Pi asks as usual. Nothing is added to `~/.pi/agent/trust.json`.
- **Session ID.** Pi starts with `--session-id <task id>`. To reopen the
  conversation later, run `pi --session-id <task id>` (or `pi -c`) in the checkout.
- **`.worktreeinclude`.** If the main checkout has this file (gitignore syntax, the
  same convention as Claude Code), ignored paths it lists are cloned into the new
  checkout before Pi starts. Typical entries are `.env` and `node_modules/`. On APFS
  the clones are instant and use no extra space. Existing files are never
  overwritten. Failures show as a Herdr notification and Pi still starts.

## Setup

Requires the patched Herdr 0.9.1, npm Pi (tested with 1.2.0) on Node 22.19+, and
the `pi` wrapper from `bin/`, which adds `--no-skills` and fullscreen mode. The
launcher sets a minimal `PATH` and uses the nvm default Node; it never sources shell
configuration. It reads Pi's cached model catalogue without loading extensions, so
extension-only models are not listed.

Pi's public API covers almost everything the launcher needs. The keybinding manager
and clipboard readers (`PRIVATE_MODULES` in `pi-runtime.mjs`) are internal files
that only the npm package has. **Pi's managed installer is therefore unsupported.**
`--check` names any file or API a new Pi release has removed.

```sh
dotfiles-link check             # review, then dotfiles-link apply
herdr plugin link ~/.config/herdr/plugins/task-launcher --enabled
theme apply                     # regenerates config.toml with the C-a t binding
herdr config check
sh ~/.config/herdr/plugins/task-launcher/launch.sh --check   # dependency check only
```

Edits to the linked plugin files apply the next time the popup opens.

## State and recovery

State lives in `~/.local/state/herdr/plugins/martinro.task-launcher/`. Everything
is private (mode 600):

- `preferences/<repo-hash>.json`: last model, thinking level and Start from.
- `drafts/<repo-hash>.json`: the unsent draft, with its images.
- `history/<repo-hash>.json`: the last 20 started tasks, for `↑`.
- `requests/<task-id>.json`: the handoff from the popup to the Pi tab (task text,
  images, session ID, trust decision).
- `requests/<task-id>.runner`: the Pi tab's process ID while it runs.

A request is deleted when Pi exits normally or when you close its tab or Space.
Each `C-a t` also sweeps requests no Pi tab can use any more: the checkout was
deleted, the tab's process died, or the request is over 30 days old.

**If Pi exits with an error,** its tab offers:

- `Enter`: resume this task's conversation. If Pi never saved one, it starts again
  with the original task.
- `new`: a fresh conversation with the original task.
- `q`: close. The request is kept, so
  `sh ~/.config/herdr/plugins/task-launcher/launch.sh run <task-id>` can run it
  later. Never do this while the original tab is still open.

**On launcher errors** the form keeps your text. If the worktree was created but
copying changes or opening Pi failed, retry reuses that checkout. If a reply was
lost, the form shows the branch and disables retry; inspect the Space before
trying again. Worktrees and branches are cleaned up by hand (`C-a C-g`).

## Verification

```sh
node --test herdr/plugins/task-launcher/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 herdr/plugins/task-launcher/pty-smoke.py
```

Both use temporary Git repositories, fake Herdr/Pi and a loopback naming provider.
Neither reads or writes the real clipboard or contacts a provider. The PTY check
also closes a running Pi tab's terminal to prove its files are removed. For a
native UI check, use a separate Herdr instance with its own socket and state, keep
the task text empty, and never send test keys to an existing agent pane. Real
task startup needs its own approval.
