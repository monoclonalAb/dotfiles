# Local file links → Neovim

Rendered assistant Markdown links such as `[guide](docs/guide.md)` get absolute
`file://` targets resolved against the session's working directory. This is
**display-only**: messages, model input and copied text are unchanged, and the
extension reads no files and starts no processes.

## Use

- **Cmd-click** a file link in Alacritty (**Cmd+Shift-click** inside Herdr), or
  press **Ctrl+Shift+O** and type the hint label.
- If Pi prints the URL in parentheses (no OSC 8 support), click the `file://…` part.
- The file opens in Neovim in a new Alacritty window. Web links still open in the
  browser; `file://` hints from other programs also go to Neovim.

The [Alacritty hint](../../../alacritty/alacritty.toml) runs
[`terminal-open`](../../../bin/terminal-open), which needs macOS's
`/usr/bin/python3` and Homebrew Neovim, and passes paths as literal argv.

## Supported links

Inline links with relative, absolute, `~/`, percent-encoded or `<angle bracket>`
paths. `file.ts:42`, `file.ts:42:7`, `#L42`, `#L42:7` and `#L42-L50` jump to the line
(and column); heading fragments open the file only. Encode literal `#` and `%`.
Code spans, images, reference-style links and non-file schemes are left alone.
Remote hosts, queries, missing files and directories are rejected. Neovim starts
with modelines and project `exrc` disabled.

## Checks

```sh
bun test ./pi/extensions/local-file-links/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s lib/terminal-links -p 'test_*.py'
terminal-open --check "file://$HOME/dotfiles/README.md#L10"   # prints argv, opens nothing
```

The tests use Pi's real Markdown renderer (OSC 8 on and off) and headless
`nvim -u NONE`; GUI launches are mocked. After changes, `/reload` in an idle session.
