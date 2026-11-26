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

The footer shows Pi's own text, rearranged into two rows instead of Pi's three:

```text
~/dotfiles (main)                               (anthropic) claude-opus-4-5 • high
1% | 57% · 68% · @main | 2 skills   ↑134 ↓51k R4.8M $2.595 (sub) 12.7%/1.0M (auto)
```

The first row is the folder, with the model on the right. The second is the
extension statuses (quota, account, skills, tokens per second), with the usage
figures on the right. A row too wide for the terminal splits in two: its right
part moves to a row of its own below, still right-aligned. Before that, the model
drops its `(provider)`, as in Pi's own footer.

The folder, usage and model text get the colours of the extension statuses: each
value in its own colour, numbers bold, labels and separators dim.

- `~/dotfiles (main) • name`: folder teal, branch green, session name plain.
- `↑1.2k ↓340 R56k W800 CH96.6% $0.420 (sub) 31.4%/200k (auto)`: token counts
  blue, cost orange, context share green (yellow over 70%, red over 90%, as Pi
  warns).
- `(anthropic) claude-opus-4-5 • high`: model violet, thinking level yellow.
- `(openai-codex) gpt-6.2-sol • fast • xhigh`: [`codex-fast`](../codex-fast/README.md)'s
  `fast` moves out of the statuses to right after the model name, bold orange
  like the cost (it uses more credits). It stays when the provider is dropped.
  If Pi's status row is ever not the one its statuses would make, the row is
  shown as is and `fast` stays in it.

The colour names are those of Pi's light theme; the dark theme uses its own
shades of the same theme slots. The extension has Pi draw its footer 1000
columns wide, so nothing is cut, then splits and fits the parts itself. It only
moves and colours Pi's text: a word it does not recognise stays dim, and if the
folder text ever differs from what it expects, Pi's is shown as is. The
extension statuses keep their own colours. There is no MCP count: every
configured server is always enabled, so `/mcp` is the place to check connections.

The layout stays put through `/new`, `/resume`, `/fork` and `/reload`. Those
commands load every extension again, and while they do, Pi removes any footer an
extension set with `ctx.ui.setFooter` and draws its own three-line footer. So
this extension does not set a footer. It changes how Pi's own footer draws, by
wrapping `render` on Pi's `FooterComponent` class, which extensions share with
Pi. It wraps it once, when it first loads; a reload swaps in the new drawing
code and theme, so edits show after `/reload`. Before the first session has started, it reads Pi's theme from the global
slot Pi keeps it in. If anything is missing, Pi's footer is drawn unchanged.
Removing this extension and running `/reload` leaves the layout in place until
Pi restarts.

No messages, tools, context files, provider requests, credentials, or MCP payloads
are added or changed.

## Verification

From the repository root:

```sh
bun test ./pi/extensions/compact-ui/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-footer/pty-smoke.py
dotfiles-link check
```

The unit suite checks resource summarization, bounded rendering, separated expansion,
the colours, the two-row layout at 146 columns, that narrower rows split without
losing text or overflowing, and that Pi's footer is wrapped only once and keeps
the layout across a session change. The own-PTY test combines this extension with
synthetic quotas and a synthetic `mcp.json` in an isolated quiet-startup Pi process
with built-in MCP unloaded. It checks the two rows, the colours, that no MCP count
appears, and that `/new` never shows Pi's own three-line footer, even briefly; it
makes no real provider request or MCP connection.
