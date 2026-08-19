---
name: repo-recon
description: Establish a focused map of an unfamiliar repository before changing it.
---

# Repository reconnaissance

Use this only for first contact with an unfamiliar repository. Keep the result bounded to the requested change.

1. Size the repository with `tokei`; identify the languages and directories relevant to the task.
2. Use `ast-grep --pattern` to locate likely entry points and existing structural patterns.
3. Build the symbol map with `lsp` using `action: symbols`, `file: "*"`; follow definitions and references rather than guessing call sites.
4. Use `repomix --compress --stdout` only when a bounded whole-repository artifact is genuinely needed. For sustained symbol navigation in a genuinely unfamiliar repository, enable the `serena` MCP instead; initialise Serena before use.

Do not pack, index, or summarise unrelated repositories by default.
