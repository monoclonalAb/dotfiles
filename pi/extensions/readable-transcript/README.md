# Readable thinking and script panels

Frames assistant thinking blocks and tidies `codemode` and `bash` tool rows so
reasoning, batched tool scripts and multi-line shell commands stay scannable in
the transcript. This is **display-only**: it uses `registerMarkdownTransformer`
(`assistant-thinking` only), `setHiddenThinkingLabel` and `registerToolRenderer`,
so session entries, tool execution and model input are unchanged.

## What you see

- **Thinking blocks:** rendered inside one continuous blockquote (`│` rail in
  Catppuccin lavender from [`theme-sync`](../theme-sync/README.md)) under a bold
  `Thinking` (`Thinking…` while streaming) heading, keeping lists and code blocks
  visually inside the reasoning block rather than blending into the reply.
  Folding a block (left-click or `Ctrl+T`) shows `▸ Thinking · click to expand`.
- **`codemode` script runs:** collapsed rows hide the `Promise.all` script
  boilerplate once nested tool calls appear, format nested `read`, `bash`,
  `edit`, `write`, `grep`, `find`, `ls` and MCP arguments without raw JSON noise,
  and summarise JSON return values on one line (`↳ returned { … } · Took 0.1s`).
  Expanding (`Ctrl+O` or left-click) shows the syntax-highlighted script behind a
  `│` rail and unescapes multi-line string fields into `[key]` sections.
- **`bash` calls:** syntax-highlights the command as shell rather than bold
  title text and folds commands longer than four lines behind a `│` rail until
  expanded, while keeping Pi's native output preview and timer.

## Checks

```sh
bun test ./pi/extensions/readable-transcript/index.test.ts
```

After deploying, `/reload` in an idle session.
