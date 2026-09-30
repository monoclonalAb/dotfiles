# Move Pi MCP servers to the built-in MCP support

**Status:** Complete (sessions still running the adapter need `/reload`; Linear needs `pi mcp login linear`)
**Scope:** `pi` (settings, global `mcp.json`, `compact-ui`), `bin` (Pi wrapper),
this repository's `.pi/mcp.json`, host-local project `.pi/mcp.json` overrides, docs.

## Objective

Pi 0.99 ships MCP support (`builtin:mcp`, `/mcp`, `pi mcp …`). `pi-mcp-adapter`
registers `/mcp`, which *replaces* the built-in support, so while it is listed in
`settings.json` the native support never loads. Remove the adapter and express
every server and per-project override in the native `mcp.json` format so the same
servers are available in the same projects.

## Non-goals

- No new servers, exposure tuning, package upgrades, or OMP changes.
- No secrets in Git: the host-local `~/.config/mcp/mcp.json` stays untouched.
- No `pi mcp login`, `/reload` of other sessions, or deletion of adapter caches.

## Context and constraints

- Native config: `~/.pi/agent/mcp.json` (the Stow link to `pi/.pi/agent/mcp.json`)
  and, for trusted projects only, `<cwd>/.pi/mcp.json`. Project entries **replace**
  global entries of the same name, so a partial `{ "disabled": true }` override is
  an invalid entry (reported at startup, then ignored). Native uses `enabled: false`.
- Native ignores `lifecycle`, `auth`, `protocolVersion`; every enabled server
  connects at session start. `url` is not interpolated; `env`/`headers` are.
- `/mcp` enable/disable/exposure rewrites the defining file with `JSON.stringify`
  (2-space), through the Stow link into the repository.
- `~/.config/mcp/mcp.json` (mode 600) held linear, notion (OAuth, no secret) and
  penpot (token embedded in its URL). All three were disabled globally.
- The `pi` wrapper appends `--no-skills --tui-mode fullscreen` to non-management
  commands; `pi mcp` rejects them (`Unknown option --no-skills`).
- `compact-ui` rendered `MCP: N/M` from the adapter's `pi-mcp-adapter/status/v1`
  event, which no longer exists. The built-in exposes no status event.

Original adapter-format project overrides (no secrets), for recovery:

| File | Content |
| --- | --- |
| `~/dotfiles/.pi/mcp.json` (tracked) | `workspace-context` disabled |
| `~/Desktop/projects/DE/.pi/mcp.json` | `gcloud`, `gcp-observability` enabled + eager; `linear` enabled |
| `~/Desktop/projects/DE/raywhite-ai{,-evergreen-matched-tasks,-nz-property-matching}/.pi/mcp.json` | `linear` enabled |
| `~/Desktop/projects/personal/.pi/mcp.json` | `linear` enabled |
| `~/Desktop/projects/personal/website/.pi/mcp.json` | `penpot`, `linear`, `notion`, `workspace-context` disabled; `paper` enabled |

## Acceptance criteria

- [x] `settings.json` no longer lists `pi-mcp-adapter`; the built-in `/mcp` loads.
- [x] Native loader reports no config errors for the global file and each project file.
- [x] Effective enabled sets per project match the adapter-era intent.
- [x] `pi mcp list` works through the wrapper.
- [x] `compact-ui` shows `MCP: enabled/total` from native config; tests pass.
- [x] Docs describe the native ownership, lifecycle difference, and penpot gap.

## Approach

1. Settings + global `mcp.json` (drop `lifecycle`; add disabled linear/notion).
2. Project overrides rewritten as complete native entries.
3. Wrapper passes `mcp` through; compact-ui counts native config.
4. Verify with the installed Pi's own loader and `pi mcp list`; update docs.

## Progress

- [x] Settings, global and repository `mcp.json`, six host-local project files
      (originals copied to `/tmp/pi-mcp-adapter-overrides-20260930114552/`).
- [x] Wrapper passes `pi mcp` through; compact-ui counts native config and skips
      `builtin:*` extension sources in its header count.
- [x] README, ARCHITECTURE, VERIFICATION, QUALITY Q-006, extension READMEs.

## Decisions

- **Keep the enabled set identical.** Native has no lazy mode, so gcloud,
  gcp-observability, paper and workspace-context now connect at every session
  start (paper warns when Paper Desktop is closed). Rejected: silently narrowing
  them to DE/website, which would hide tools elsewhere without a visible signal.
- **Track linear and notion disabled** in the global file (as OMP already does), so
  `/mcp` lists them. Their adapter OAuth tokens (OS keychain) do not carry over;
  native stores tokens in `~/.pi/agent/mcp-auth.json` after `pi mcp login`.
- **Leave penpot host-local and unported:** its token is in the URL and native
  cannot interpolate URLs. It was disabled everywhere.
- **Default `codemode` exposure** (native default, bounded description budget).
- **DE drops its gcloud/gcp-observability entries:** they were only `enabled` +
  `eager` overrides of enabled global servers, and native already connects them
  at startup. Copying full definitions would duplicate the allowlist path.
- **compact-ui reads `mcp.json` itself:** the built-in exposes no status event or
  public loader. It mirrors name/`command`/`url` validity and precedence only, and
  recounts on file mtime/size change. The adapter-notice filter was removed.
- **Fixed stale test mocks:** Pi 0.99's footer calls `getEntryCount`, `getSessionId`,
  `getLeafId`; compact-ui's footer tests failed at HEAD for that reason.

## Verification

All from `/Users/eric/dotfiles` on 2026-09-30 with Pi 0.99.1 unless noted.

- Pi's own `loadMcpConfig()` (`dist/extensions/mcp/config.js`) for `/tmp`, this
  repository and the six project directories, trusted — **passed**: no config
  errors; enabled sets equal the adapter-era intent (Linear enabled in DE, its three
  repositories and personal; workspace-context disabled here and in website).
- `~/.local/bin/pi mcp list` in `/tmp` and here — **passed** (exit 0): gcloud 1,
  gcp-observability 13, paper 35, workspace-context 9 tools connected (Paper
  Desktop was open); linear/notion disabled; workspace-context disabled here.
  Before the wrapper fix: `Unknown option --no-skills`.
- `pi list` — **passed**: `No packages installed.`
- RPC `get_commands` in `/tmp` — **passed**: `/mcp` sourced from `builtin:mcp`; no
  MCP warnings among startup UI requests.
- `bun test ./pi/.pi/agent/extensions/compact-ui/index.test.ts` — **passed** 8/8.
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/quota-footer/pty-smoke.py`
  — **passed** (dark, light), including a mid-run `mcp.json` edit to `MCP: 1/2`.
- Ad-hoc `tsc` of compact-ui against installed Pi public types — **passed**.
- `bun test` quota-footer suites — account-monitor and quota **passed**; monitor
  **failed** 1 test with the same pre-existing `getEntryCount` mock gap (file
  unchanged by this work).
- `sh -n bin/.local/bin/pi`, JSON parse of the three tracked files, `stow -n -v`
  for `pi`, `bin`, `docs` (no actions) — **passed**. `git diff --check` flags only
  the concurrent Herdr patch. No `penpot`/`userToken` in tracked files.
- Not run: an interactive TUI session with the real config, `/reload` of running
  sessions, OAuth sign-in to Linear.

## Risks and recovery

- Restore the adapter by reverting this change in Git (settings, global and
  repository `mcp.json`) and the host-local overrides from the table above. The
  adapter ignores native `enabled: false`, so re-adding only the package would
  enable linear and notion everywhere.

## Outcome

Pi now uses its built-in MCP support with the same servers per project.
Remaining: `/reload` sessions that still run the adapter; run `pi mcp login linear`
before using Linear in DE/personal; trust `~/Desktop/projects/personal` when Pi asks.
Optional cleanup of adapter runtime data (`~/.pi/agent/npm/node_modules/pi-mcp-adapter`,
`~/.pi/agent/mcp-{cache,npx-cache,onboarding}.json`, keychain OAuth entries) was not
done. Penpot remains unported; the quota-footer monitor mock gap remains.
