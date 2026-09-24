# Shared Catppuccin theme

Pi follows the flavour selected by [`theme`](../../../../../bin/.local/bin/theme),
including **Ctrl+Shift+T** in Alacritty. Read/edit/bash and other native tool panels
use the matching Catppuccin backgrounds: base while pending, mantle on success,
and a subtle red tint on error. Dark-flavour output uses subdued subtext rather
than bright white; Latte uses darker text for legibility. Markdown, syntax,
diffs, messages and editor borders use the same palette.

## Behaviour

In interactive sessions the extension reads `~/.local/state/theme/flavour` (the
`theme` script's literal path) at startup and every 500 ms, builds a Pi `Theme` in
memory and applies it with `ctx.ui.setTheme()` when it changes. Nothing is written.

- The shared flavour wins over Pi's saved theme, `/settings` and `--use-theme`. To
  use Pi's own themes, disable `theme-sync` with `pi config` and reload.
- Missing or invalid state keeps the current theme until a valid `theme set`.
- Opacity stays with the terminal; tool panels are opaque, muted surfaces.
- Print, JSON and RPC modes do nothing.

After deploying, `/reload` existing idle sessions once; later hotkey changes apply
automatically.

## Verification

```sh
bun test ./pi/.pi/agent/extensions/theme-sync/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/theme-sync/pty-smoke.py
```

The Bun suite checks every Pi colour token in all four flavours, 256-colour mode,
tool-panel contrast and lifecycle cleanup. The PTY test runs real Pi with an isolated
HOME and the real `theme cycle` script (other app reloads stubbed), and never changes
the live theme.
