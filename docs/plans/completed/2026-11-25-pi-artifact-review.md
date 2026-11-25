# Review artifact pages in the browser and send notes to Pi

**Status:** Complete
**Scope:** New Pi extension `pi/extensions/artifact-review/`, its policy entry,
`pi/AGENTS.md` (artifact pages keep view state in the address), owning docs.
Pi only; no OMP version.

## Objective

`/artifact-review <page>` in Pi opens an artifact page in the browser from a
local server. Option-click any part of the page (or select text) to write a
note; Send delivers the notes to that Pi session as the user's next message
(queued as a follow-up when Pi is busy). When the agent changes the page's
folder, the browser reloads at the same scroll position and address. Each note
says which part of the page it is about and what was on screen (pressed tabs,
picker values, address).

## Non-goals

- Drag-and-drop editing in the browser; Lavish's whiteboards, phone layout,
  image uploads, publishing or layout checks.
- An OMP version, network access beyond 127.0.0.1, or changes to `bin/artifact`.
- Restoring a page's own tab/picker state for pages that do not keep it in the
  address (the cove October page does not).

## Context and constraints

- [Extension policy](../../../pi/extensions/README.md): `sendUserMessage` needs
  an approved exception; the user asked for delivery on 2026-11-25.
- `/review` is taken by `agent-stuff`, so the command is `/artifact-review`.
- `pi.sendUserMessage(text, { deliverAs: "followUp" })` sends at once when Pi
  is idle and queues after the current run otherwise (Pi 1.6.0
  `dist/core/agent-session.js`, `prompt()`); it throws only during compaction.
- Server state is session-scoped: start on the command, close on
  `session_shutdown` (any reason).
- New files under the mirrored `pi/` folder need `dotfiles-link apply` before
  the live Pi sees them.

## Acceptance criteria

- [x] Command resolves an artifact id (through `artifact show`), a folder, an
  HTML file or a `file://` URL; no argument offers a picker.
- [x] Server: 127.0.0.1 only, random token in every path, Host and Origin
  checks, no files outside the folder, overlay injected into HTML only.
- [x] Notes arrive in a real Pi SDK session as one user message, immediately
  when idle and as a follow-up when busy.
- [x] A change in the folder reloads the page in real Chrome and restores scroll.
- [x] Policy, operator and verification docs updated.

## Progress

- [x] Implement `notes.ts`, `server.ts`, `overlay.js`, `index.ts`.
- [x] Bun unit tests, native Pi test, headless Chrome test.
- [x] Docs and `dotfiles-link check` preview.

## Decisions

- **Inject into the page, UI in a shadow root:** simpler than Lavish's
  frame-in-a-page; page CSS cannot restyle the panel.
- **Option-click instead of a mode:** the page's own tabs and pickers keep
  working; a "click mode" switch is there for plain clicks.
- **Views survive reloads through the address:** pages keep tab/day choices
  after `#`; the tool keeps the address and scroll, it does not replay clicks.

## Verification

All from the repository root on 2026-11-25, Pi 1.6.0, Bun 1.3.14, Node 24.19.0.

- `bun test ./pi/extensions/artifact-review/*.test.ts` — passed (15 tests):
  note checking and the message text, serving and injection, refused paths,
  tokens, hosts, origins and content types, SSE busy/reload/stopped, command
  resolution, picker, stop and session end with a mocked Pi.
- `node --test pi/extensions/artifact-review/*.test.mjs` — passed (2 tests):
  real Pi SDK session (synthetic provider): the idle note reaches the model at
  once, the busy note after the running reply, `/reload` closes the server; real
  headless Chrome: Option-click, selection, plain tab clicks, Send payload,
  reload with scroll restored, held reload while writing, stopped state.
- Type check of `index.ts` (and imports) against installed Pi public types with
  the `agent-stuff/typecheck.mjs` settings — passed.
- Read-only run on the real cove October page in headless Chrome (watch off,
  no writes): panel connected, fonts loaded, plain click switched the tab,
  Option-click on a booking block described it with its title, section and the
  picker value. Found and fixed a picker label that included every option.
- `bin/dotfiles-link check` — 8 links to create, all in
  `~/.pi/agent/extensions/artifact-review/`; nothing else.
- Not run: `dotfiles-link apply` and a live Pi session with a real model.

## Risks and recovery

- A page script on the served origin could post notes; pages are agent-made
  and local. Remove the extension folder and `/reload` to disable.

## Outcome

`/artifact-review` is built and tested in `pi/extensions/artifact-review/`.
It is not installed: `dotfiles-link apply` then `/reload` in Pi makes it live.
Pages made before the `pi/AGENTS.md` address rule (such as the cove October
page) return to their first tab after a reload.
