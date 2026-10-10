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
packages appear in the count. Built-in extensions such as `builtin:mcp` are left out,
as in Pi's own list.

Set **Quiet startup** to `true` in Pi's `/settings`. That setting suppresses Pi's
built-in help and multi-section resource listing; this extension then supplies the
compact replacement. Pi writes the setting through the tracked `pi/settings.json`
link, so review and commit it like any other change (see the
[Pi section](../../../docs/AGENT-TOOLS.md#pi) of the agent tools guide).

The footer also shows a right-aligned `MCP: N/M`, where `N` is the number of enabled
servers and `M` the total. Pi's built-in MCP support publishes no status, so the
extension counts the servers as that support merges them: `~/.pi/agent/mcp.json`,
then the trusted project's `.pi/mcp.json` replacing entries of the same name, then
servers registered by extensions; `"enabled": false` disables one. It re-reads the
files only when their modification time or size changes, so `/mcp` toggles show on
the next render. The count says nothing about connections; `/mcp` shows those. It
preserves Pi's native footer through a small wrapper so quota and other statuses
stay left-aligned while MCP occupies the right edge. With no servers configured the
entry is hidden.

No messages, tools, context files, provider requests, credentials, or MCP payloads
are added or changed; the extension only reads `mcp.json` files.

## Verification

From the repository root:

```sh
bun test ./pi/extensions/compact-ui/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-footer/pty-smoke.py
dotfiles-link check
```

The unit suite checks resource summarization, bounded rendering, separated expansion,
the native `mcp.json` merge and recount, and the right-aligned enabled/total MCP
fraction. The own-PTY test combines this extension with synthetic quotas and a
synthetic `mcp.json` (edited mid-run) in an isolated quiet-startup Pi process with
built-in MCP unloaded; it makes no real provider request or MCP connection.
