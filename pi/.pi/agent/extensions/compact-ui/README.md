# Compact Pi chrome

This display-only extension removes routine startup prose in favor of one collapsed
resource summary:

```text
▸ pi v… · Context: AGENTS.md · Extensions: N · ctrl+o
```

Ctrl+O uses Pi's native global expansion state. Expanded mode lists every detected
context path and extension label in separated, indented sections; collapsing returns
to one line. Context names come
from the path attributes in Pi's already-built system prompt—the extension does not
log or display context contents. Extension labels mirror Pi's standard global/project
discovery and are supplemented by extension-owned commands/tools so configured npm
packages appear in the count.

Set **Quiet startup** to `true` in Pi's `/settings`. That setting suppresses Pi's
built-in help and multi-section resource listing; this extension then supplies the
compact replacement. Pi settings remain local application state rather than a Stow
source because they also contain machine-selected models and package state.

The extension also consumes pi-mcp-adapter's public, sanitized status snapshot and
reduces its native footer entry to a right-aligned `MCP: N/M`, where `N` is the
number of enabled servers and `M` is the total. It preserves Pi's native footer
through a small wrapper so quota and other statuses stay left-aligned while MCP
occupies the right edge. It defers that display update by one microtask because the
adapter publishes the snapshot immediately before its own verbose status. Routine all-disabled or
startup-connected info notices are suppressed; MCP warnings/errors and `/mcp status`
remain available.

No messages, tools, context files, provider requests, credentials, or MCP payloads
are added or changed.

## Verification

From the repository root:

```sh
bun test ./pi/.pi/agent/extensions/compact-ui/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/quota-footer/pty-smoke.py
stow -n -v -t "$HOME" pi
```

The unit suite checks resource summarization, bounded rendering, separated expansion,
and the right-aligned enabled/total MCP fraction. The own-PTY test combines this extension with synthetic quotas and
MCP state in an isolated quiet-startup Pi process; it makes no real provider request.
