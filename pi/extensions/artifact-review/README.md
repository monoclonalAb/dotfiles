# Artifact review

`/artifact-review` opens an HTML page in the browser so you can point at parts of
it and write notes. Send delivers the notes to the Pi session you ran the command
in, as your next message. When the agent changes the page, the browser reloads it
where you were.

```text
/artifact-review cove-october        an artifact id, or any unique part of one (as `artifact show` takes)
/artifact-review ~/page.html         a file, a folder, or a file:// URL
/artifact-review                     pick from recent artifacts; this session's come first
/artifact-review stop
```

## A review, step by step

1. You run `/artifact-review cove-october` in the Pi session that made the page.
   The browser opens the page from a small server on this Mac. The footer shows
   `reviewing <id>`.
2. You Option-click a heading and type "move this to the top", then press Enter.
   Or select some text and press **Add note**. Plain clicks still work the
   page's own tabs and pickers. Tick **Plain clicks add notes** to comment
   without Option. The outline, the note card and the **Add note** button
   scroll with the part of the page they belong to; the review panel stays in
   the bottom-right corner.
3. You press **Send to Pi** (or ⌘Enter in a note). Pi shows the message and asks
   whether to send it. **Keep them on the page** is preselected, so an Enter meant
   for Pi's prompt sends nothing. Choose **Send** and the notes arrive in Pi as
   your message. If Pi is busy,
   they wait until it finishes, like a follow-up you type while it works. If you
   decline, nothing is sent and the notes stay on the page.
4. The agent edits the page. A change to any file in the page's folder reloads
   the page at the same scroll position and address. A half-written note holds
   the reload until you add it or cancel it.

Each note in the message says what it points at: the element, its text or
title, the section heading above it, and a CSS path. It also says what was on
screen when you wrote it: pressed tabs and buttons (`aria-pressed`,
`aria-selected`, `aria-current`), picker values and the address after `#`.
The message names the page's file and project, and says when the page was made in
another Pi session. A page built by a script needs the script changed and rerun,
and the message tells the agent so.

Unsent notes stay in the browser tab (sessionStorage) through reloads. After
Send, **Copy** copies the exact message Pi received.

## Limits

- One review per Pi session. `/new`, `/resume`, `/fork`, `/reload` and quitting
  end it; the page then says "Review stopped".
- A reload keeps the address and scroll, not a page's own state. Pages keep
  their tab and picked day after `#` so a reload returns to them
  ([`pi/AGENTS.md`](../../AGENTS.md)); older pages, like the cove October page,
  go back to their first tab.
- If Pi refuses the message (it does while compacting), Pi shows the error and
  the notes are not delivered; Copy still has them.

## Safety

- The server listens on 127.0.0.1 only, on a random port, and every address
  starts with a random token.
- It answers only requests naming 127.0.0.1 or localhost as the host, takes notes
  only as JSON from its own origin, and serves only files inside the page's
  folder (symlinks out of it are refused). It changes no files.
- The review panel is added to the page as it is served; the file on disk is
  unchanged. The panel lives in a shadow root, so the page's styles do not
  reach it. A script inside the reviewed page could post notes too, which is why
  Pi asks you to confirm every batch and shows you what it would send.

Policy: this extension calls `pi.sendUserMessage`, an
[approved exception](../README.md) because it only sends notes from a review you
started, after you confirm each batch in Pi.

## Files

- [`index.ts`](index.ts): the command, finding the page, delivery and lifecycle.
- [`server.ts`](server.ts): the local server, file watching and reload events.
- [`notes.ts`](notes.ts): checking posted notes and writing the message.
- [`overlay.js`](overlay.js): the review panel in the browser.

## Verification

```sh
bun test ./pi/extensions/artifact-review/*.test.ts      # notes, server, command with a mocked Pi
node --test pi/extensions/artifact-review/native.test.mjs   # real Pi SDK session, synthetic provider
node --test pi/extensions/artifact-review/browser.test.mjs  # real headless Chrome; skipped without Chrome
```

The browser test uses real mouse and key events. Set
`ARTIFACT_REVIEW_SHOT=/tmp/review.png` to keep a screenshot of the panel.
`PI_ARTIFACT_REVIEW_NO_OPEN=1` stops the command opening a browser.
