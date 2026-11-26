# Park idle

Quits a Pi conversation that has sat idle for two hours, so the Pi process
(~180 MB) is freed, with any MCP servers still running (`mcp-idle-stop` usually
stopped them after 10 idle minutes). The terminal stays. Coming back to it
reopens the same conversation in about a second.

1. 10:20: Pi finishes a reply. You move to other work.
2. 12:20: no key has reached Pi and no agent run has started for two hours. The
   extension writes the session file to `PI_PARK_FILE` and quits Pi.
3. The [`pi`](../../../bin/pi) wrapper, which started Pi as its child, prints
   "Pi closed while idle to free memory. Press a key to reopen this
   conversation." It tells Herdr it is an idle Pi, so the sidebar, Mission
   control and `next-agent` keep the conversation.
4. 15:00: you click the pane. The focus, or any key, reopens
   `pi --session <file>` with the run's trust and display flags.

It does not park while something would be lost, and tries again two hours later:

- an agent run, a queued message, a draft in the editor or an open dialog;
- a command still running under Pi (`!cmd`, or an editor opened with Ctrl+G):
  any child of Pi that does not read a unix socket from it, as MCP servers do;
- a page Pi serves (an open `/artifact-review`);
- a live `hc` sub-terminal, whose notes would be typed into the parked pane;
- a `/tree` position other than the latest entry, since a reopen starts from
  the latest.

A key that arrives while the checks run (`Ctrl+D` to quit, say) cancels the park.

Lost on a park, as on `/reload`: `/fast` turned on inside the session (`--fast`
on the command line is kept) and an open `/btw` overlay (its thread is saved).
Kept: the conversation, model, thinking level, name and `/skill` choices.
Quitting Pi yourself writes nothing, so that conversation never reopens.

`PI_PARK_AFTER=<seconds>` changes the period; `0` turns parking off (the wrapper
then runs Pi as before). Only a Pi whose parent is the wrapper that set
`PI_PARK_FILE` parks: a Pi the agent starts, a `pi -p` run, or a session started
before this existed never does.

## Verification

```sh
bun test ./pi/extensions/park-idle/*.test.ts
```

Unit tests cover the timer, each check that blocks parking, and which runs
park. [`lib/pi/test_pi.py`](../../../lib/pi/test_pi.py) covers the wrapper's
side. The in-app check is in [`docs/HERDR-APP.md`](../../../docs/HERDR-APP.md#idle-conversations).
