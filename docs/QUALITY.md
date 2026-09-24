# Quality map

**Status:** Evidence snapshot. Update a row in the same change when its cited
checks, boundaries, or known gaps materially change. A grade measures repository
legibility and verification strength, not a guarantee that an application is
currently healthy on this Mac.

## Grade scale

- **A — enforced:** the important invariant is documented, mechanically checked,
  and exercised through its meaningful boundary.
- **B — supported:** ownership is clear and focused checks exist, but some
  integration evidence remains manual or host-dependent.
- **C — inspectable:** the path is documented and can be checked, but regression
  protection is narrow or mostly manual.
- **D — uncertain:** ownership or a repeatable verification path is missing.

## Current map

| Area | Grade | Evidence | Most important gap |
| --- | :---: | --- | --- |
| Stow deployment and runtime separation | B | [`.stowrc`](../.stowrc), [`.gitignore`](../.gitignore), package-only dry runs, and the setup guide's managed/unmanaged boundary | No isolated regression check proves wildcard stowing cannot publish ignored runtime or documentation files |
| Shared theme flow | B | [`theme`](../bin/.local/bin/theme) validates state, writes atomically, reports reachability, and exposes `status` | Cross-consumer behaviour has no automated fixture or integration test |
| Herdr customisation | B | Pinned source and toolchains in [`install-herdr-focus`](../bin/.local/bin/install-herdr-focus), patch preflight, the patch's focused cargo tests run during install, `herdr config check`, focused [`next_agent` tests](../herdr/.config/herdr/plugins/next-agent/test_next_agent.py), and an [isolated native jump fixture](../herdr/.config/herdr/plugins/next-agent/pty-smoke.py) | Build verification is network/toolchain dependent; the jump fixture uses synthetic lifecycle reports, not real Pi/OMP event delivery |
| Shell, terminal, and window-manager configuration | C | Native syntax/reload paths and side effects are listed in [`VERIFICATION.md`](VERIFICATION.md) and [`../README.md`](../README.md) | Most confidence comes from this host's installed applications; there is no consolidated read-only smoke check |
| Neovim configuration | C | Headless startup and `checkhealth` can exercise the assembled config | Plugin resolution is intentionally unpinned and checks depend on mutable external installations |
| OMP and Pi agent tooling | B | Extension policy, scoped skills, explicit configuration, and [focused Bun test commands](VERIFICATION.md#source-only-checks) for transport, task summaries, and navigation | No single check validates discovery, frontmatter, configuration parsing, and all extension load paths together |
| Local automation | C | Scripts use dry-run/status paths and defensive identity checks where implemented | External APIs, launchd context, and hardcoded personal paths make end-to-end testing host-specific |
| Repository knowledge | C | Scoped agent map, indexed maintained/historical/vendored documents, a [verification runbook](VERIFICATION.md), and a versioned plan convention | Local links, freshness, and catalogue coverage are not checked automatically |
| Secrets and supply boundaries | B | Runtime/secret ignore rules, environment-name indirection, pinned Herdr source, and a documented `gitleaks` check | Secret scanning and dependency/source verification are not enforced by repository CI |

## Open technical debt

These are repository-wide capability gaps, not a backlog of every possible
cleanup. Remove an entry when evidence satisfies its completion condition; use
an execution plan for implementation history.

| ID | Gap | Completion evidence |
| --- | --- | --- |
| Q-001 | There is no one-command, read-only repository check | A documented command validates Markdown links, script syntax, key config parsers, and a sandboxed Stow layout without mutating `$HOME` |
| Q-002 | Knowledge-base structure and freshness rely on review | A lightweight check catches broken local links and uncatalogued required documents; a documented gardening pass handles semantic drift |
| Q-003 | The theme orchestrator has no automated tests | State transitions and generated Alacritty, Herdr, and tmux outputs are exercised in temporary directories without contacting live applications |
| Q-005 | Operational detail is concentrated in the long root README | Frequently changed subsystem rationale moves to one canonical linked document without weakening the README's setup path |
| Q-006 | Pi MCP registration is verified by hand (`/reload`, `/mcp`) | A read-only check confirms every enabled command server in `omp/.omp/agent/mcp.json` is also in `pi/.pi/agent/mcp.json` and that the deployed file is the Stow link |
| Q-007 | A Herdr live handoff regenerates internal terminal IDs, so next-agent's recycle guard can drop unread flags | An isolated old → new handoff keeps unread split siblings while still resetting genuinely recycled panes |

## Gardening rule

When a task exposes a repeated failure, ask which narrow capability was missing:
context, ownership, tooling, proof, feedback, or delivery. Fix that owner when the
evidence supports it, then update the relevant grade. Do not raise a grade for
new prose alone when the stated gap requires executable evidence.
