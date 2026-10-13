# Theme

**Status:** Operator guide. Alacritty, Herdr, tmux, Neovim and Pi share one
Catppuccin flavour and one terminal opacity. [`bin/theme`](../bin/theme) is the
only writer of that choice. Flow and ownership:
[`ARCHITECTURE.md`](ARCHITECTURE.md#2-shared-theme-orchestration).

## Use it

| Hotkey (in Alacritty) | Effect |
|---|---|
| `Ctrl+Shift+T` | next flavour: latte, frappe, macchiato, mocha, then latte again |
| `Ctrl+Shift+B` | next opacity: 1.0, 0.85, 0.6, then 1.0 again |

`Ctrl+Shift+B` is used because `Ctrl+Shift+O` is Alacritty's built-in URL-hint key.

```sh
theme status                # what is set now; read-only
theme set mocha 0.85        # set explicitly
theme cycle                 # same as Ctrl+Shift+T
theme opacity               # same as Ctrl+Shift+B
theme apply                 # regenerate outputs and push them to running apps
```

A new Mac needs `theme set latte 0.6` once. Until then each app uses its own
default, and Alacritty logs a harmless missing-import error to
`$TMPDIR/Alacritty-*.log`.

## How a change reaches each app

1. `theme` writes the choice to `~/.local/state/theme/`, outside this repository,
   so pressing a hotkey never dirties `git status`. The repository's default is
   latte at 0.6.
2. Alacritty picks it up through `live_config_reload`.
3. Herdr gets a regenerated `~/.config/herdr/config.toml` with the flavour's
   colours, then a config reload. The [Pi Tasks](../herdr/plugins/task-launcher/README.md)
   popup (`C-a t`) reads the same colours each time it opens.
4. tmux runs `source-file`.
5. Every running Neovim updates over RPC, with a `FocusGained` fallback. Below
   1.0 opacity Neovim turns on `transparent_background`.
6. Pi's [theme-sync extension](../pi/extensions/theme-sync/README.md) polls the
   same state and follows within about half a second. It overrides Pi's
   `/settings` theme in memory without rewriting it.

New windows read the state on startup.

## Rules that are easy to break

**Keep theme-driven keys out of `alacritty.toml`.** Alacritty merges the
*importing* file last, so a key set in `alacritty.toml` overrides the generated
overlay. `window.opacity` and `window.decorations_theme_variant` therefore live in
[`alacritty/window-theme-defaults.toml`](../alacritty/window-theme-defaults.toml)
(imported before the state file); colours likewise. Putting either key back into
`alacritty.toml` silently pins it and makes `Ctrl+Shift+B` do nothing.

**The hotkey runs with a minimal `PATH`.** Alacritty runs it with `/bin/sh -c`,
which loads no profile, so the script sees only
`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin`: no Homebrew, no `~/.local/bin`.
`theme` therefore sets its own `PATH` at the top. Do not add a bare
`command -v <homebrew binary>` without it, or that step is skipped in silence.

## Diagnose

Pushes report what they reached on stderr (hidden under the hotkey, visible when
run by hand). `theme status` probes the four pushed apps without changing
anything:

```
$ theme status
flavour  frappe
opacity  0.6
state    /Users/you/.local/state/theme

alacritty  overlay present
herdr      server up
tmux       server up
neovim     found 3 instance(s)
```
