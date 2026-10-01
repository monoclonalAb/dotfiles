---
name: repo-recon
description: Establish a focused map of an unfamiliar repository before changing it.
---

# Repository reconnaissance

Use this only for first contact with an unfamiliar repository. Keep the result bounded to the requested change.

1. Read local instructions and `git status --short`. Identify the task's source
   owner from `git ls-files`, manifests, and relevant docs; use `tokei` if available
   and useful, not as a prerequisite.
2. Locate entry points with available search (`rg`/`grep`, or `ast-grep` for
   structural patterns). Read the source and follow callers and consumers.
3. Use exposed LSP symbols/definitions/references when available; otherwise trace
   imports and call sites with search. Bound queries to the relevant subtree.
4. Use `repomix --compress --stdout` only if installed and a bounded source pack
   is genuinely needed. Inspect exclusions first so secrets and runtime state
   cannot enter the pack. Do not enable Serena or another MCP as a side effect of
   reconnaissance; propose it only if native navigation leaves a concrete gap.
5. Return a compact task map: source owner, consumers, relevant tests/commands,
   constraints, and open questions, with paths supporting each claim.

Do not pack, index, or summarise unrelated repositories by default.
