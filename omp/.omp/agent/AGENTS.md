# Cross-project defaults

## Verification

- Never report work done without running the changed path.
- Verify UI changes with the `browser` tool.
- Reproduce bug fixes before changing code, then confirm the reproduction no longer triggers.

## Commands

- Prefer a `justfile` target when one exists; otherwise use the project's package-manager scripts.
- Run Python through `uv run`; never use a global `pip install`.
- Never add Mason's `bin` directory to `PATH`.

## Secrets

- Run `gitleaks detect --no-banner` before any commit that touches configuration.
- Never inline a token in `mcp.json`; use the environment-variable-name indirection instead.

## Writing

- Use NZ/British spelling by default; use US spelling for US-customer material.
- Say "customers", never "clients".
- The company is "Everyday AI" or "EAI".
- Never invent numbers, dates, or prices: use `[X]` and flag the gap.
- Produce drafts for human review rather than sending anything.

## Knowledge promotion

At the end of a task, route anything worth keeping. The owning repository is the
system of record; promote elsewhere only what no repository can own.

- Ephemeral result → keep nothing.
- Durable project fact or decision → the owning repository's committed docs, not memory.
- Durable personal or cross-repository fact no repository can own → memory (rare).
- Repeatable procedure for one repository or repo class → scoped skill in `~/dotfiles/omp/.omp/agent/scoped-skills/`, linked per repo.
- Repeatable procedure genuinely useful in any repository → global skill (rare; keep the global set small).
- An existing skill nearly covers it → update that skill; never add a near-duplicate.

Creating or changing a skill edits global harness configuration: do it only when
the user asks for it or confirms the promotion, never as a routine side effect.

## Tooling

Read `~/.omp/agent/TOOLING.md` for the linked tooling catalogue, installation commands, and alternatives.
