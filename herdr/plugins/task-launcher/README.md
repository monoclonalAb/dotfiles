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
| `Enter` | Start the task (or activate the selected control) |
| `Ctrl+J` / `Shift+Enter` | Newline |
| `Shift+Tab` | Cycle thinking effort |
| `Ctrl+L` | Model picker |
| `Ctrl+P` / `Shift+Ctrl+P` | Cycle models (Pi's `enabledModels`, else all available) |
| `Ctrl+V` / Alacritty `Cmd+V` | Paste a clipboard image as `[img #N]` (text paste still works) |
| `Ctrl+C` | Clear the draft; twice within 500 ms closes |
| `Tab` / `Esc` | Next field / back or cancel |

- The model defaults to the last one used for this repository (shared across its
  worktrees), else Pi's startup default. An unavailable model must be re-chosen;
  it never silently switches provider.
- Images: PNG, JPEG, GIF or WebP, up to 8 images / 20 MiB per popup. Delete the
  marker to drop one. A text-only model is rejected before anything is created.
  Images go only to the new Pi conversation, never to task naming.
- Cancelling before Start creates nothing. After Start, wait for the result:
  Git operations already issued cannot be cancelled.

**Naming.** Start makes one tool-free request to the selected model (lowest
effort, 30 s deadline, costs provider usage) that turns the task into a 2–6 word
summary: `task/fix-login-spinner`, plus the Space and Pi session name. If naming
fails the form stays open; retry, or set a branch under **Advanced** to skip it.
Advanced also sets the base and checkout path (absolute, outside the source).

**Base.** The default base is the source checkout's committed `HEAD` when the form
opened. Uncommitted files are not copied (the form warns when the source is dirty).
Nothing is stashed, reset, committed, fetched, pushed or removed automatically.

## Setup

Requires the patched Herdr 0.9.1, npm Pi (tested with 0.87.1) on Node 22.19+, and
the `pi` wrapper from `bin/`. The launcher sets a minimal `PATH` and uses the
nvm default Node; it never sources shell configuration. It reads Pi's cached model
catalogue without loading extensions, so extension-only models are not listed.

```sh
dotfiles-link check             # review, then dotfiles-link apply
herdr plugin link ~/.config/herdr/plugins/task-launcher --enabled
theme apply                     # regenerates config.toml with the C-a t binding
herdr config check
sh ~/.config/herdr/plugins/task-launcher/launch.sh --check   # dependency check only
```

Edits to the linked plugin files apply the next time the popup opens.

## State and recovery

State lives in `~/.local/state/herdr/plugins/martinro.task-launcher/`:

- `preferences/<repo-hash>.json` — last model/thinking per repository.
- `requests/<task-id>.json` — private (mode 600) handoff with the task text and
  images. Deleted when Pi exits normally, kept if it fails.
- `requests/<task-id>.json.images-*/` — temporary image files passed to Pi; removed
  when Pi exits (a killed runner can leave one behind).

On errors the form keeps your text. If the worktree was created but Pi's tab failed,
retry reuses that checkout. If a reply was lost the form shows the branch and
disables retry; inspect the Space before trying again. If Pi exits with an error,
its tab offers `retry`, which starts a **fresh** session with the same task; use
`pi --continue` in the checkout to resume instead. A kept request can be rerun with
`sh ~/.config/herdr/plugins/task-launcher/launch.sh run <task-id>` — never while
the original is still running. Worktrees and branches are cleaned up by hand.

## Verification

```sh
node --test herdr/plugins/task-launcher/*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 herdr/plugins/task-launcher/pty-smoke.py
```

Both use temporary Git repositories, fake Herdr/Pi and a loopback naming provider;
neither reads the real clipboard or contacts a provider. For a native UI check, use
a separate Herdr instance with its own socket and state, keep the task text empty,
and never send test keys to an existing agent pane. Real task startup needs its
own approval.
