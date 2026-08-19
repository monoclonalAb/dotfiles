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

## Tooling

Read `~/.omp/agent/TOOLING.md` for the linked tooling catalogue, installation commands, and alternatives.
