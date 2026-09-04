# Vim transcript navigation

This UI-only extension gives Pi's fullscreen transcript a temporary Vim-style
normal mode without changing conversation or model context.

- `Esc` or `Ctrl+[`: enter normal mode (`Esc` again keeps Pi's normal
  interrupt behavior)
- `i` or `a`: return to insert mode
- `j` / `k`: scroll down / up one transcript line
- `Ctrl+D` / `Ctrl+U`: scroll down / up half a page
- `Ctrl+F` / `Ctrl+B`: scroll down / up a page
- `J` / `K`: jump to the next / previous message block in the transcript
  (Pi marks both your prompts and each assistant response as jump targets,
  so alternate presses land on either; this granularity is Pi's built-in
  transcript navigation and cannot be narrowed to user prompts only)
- `↑` / `↓`: unchanged editor behavior — recall older / newer submitted prompts
  into the editor (this session's history), cursor movement otherwise
- `G`: jump to the transcript bottom

The editor border shows `INSERT` or `NORMAL`. The global Pi wrapper starts
interactive sessions in fullscreen mode so the application owns transcript
scrolling; pass `--tui-mode regular` explicitly to opt out.
