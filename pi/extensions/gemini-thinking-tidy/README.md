# Gemini thinking tidy

Gemini 4 Carbon (`google-vertex/gemini-4-carbon`) does not send its thinking. Like
other Gemini models, it sends short summaries of it ("thought summaries"). This
model also sends the summariser's own working notes: "Thinking Process:
1. Analyze the Request … Word count check …". The real summary, a bold header and
one paragraph, comes at the end of each note.

This extension shows only those summaries in thinking blocks. It is
**display-only**: it uses `registerMarkdownTransformer` for `assistant-thinking`,
so the session file and the next request to Gemini keep the full text.

## What you see

- Each note becomes its summary: `**Header**`, then the paragraph.
- A note that ends without a summary shows its last drafted body instead; a block
  with nothing usable says _No summary in this thinking block._
- While a reply streams, a note that has not reached its summary shows
  _Thinking…_.
- Thinking that does not start with `Thinking Process:` and mention the
  summariser's rules (such as "3-7 words") is left unchanged, so other models are
  unaffected.

The full notes are still in the session file
(`~/.pi/agent/sessions/…/*.jsonl`).

Delete this extension once Gemini 4 Carbon's thinking no longer starts with
`Thinking Process:`.

## Checks

```sh
bun test ./pi/extensions/gemini-thinking-tidy/index.test.ts
```

After changes, `/reload` in an idle session.
