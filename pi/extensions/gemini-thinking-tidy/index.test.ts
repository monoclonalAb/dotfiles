import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";
import extension, { NO_SUMMARY, STILL_THINKING, tidyThinking } from "./index";

// Shaped like Gemini 4 Carbon's leaked summariser notes (contents made up).
const note = (header: string, body: string, ending: "glued" | "indented" | "missing" = "glued") => `Thinking Process:

1.  **Analyze the Request:**
    *   **Goal:** Summarize the provided thoughts in the first person ("I").
    *   **Header:** 3-7 words long, starts with a verb, wrapped in \`**\`.
    *   **Input Thoughts:** "Read the docs, then run the tests."

2.  **Draft the Header:**
    *   *Idea 1:* **Reading project docs** (3 words) - Good.

3.  **Draft the Summary:**
    *   Body: ${body} (24 words).
    *   *Word count check:* 27 words.

4.  **Final Polish:**
    **${header}**

    ${body}${ending === "glued" ? `**${header}**\n\n${body}` : ending === "missing" ? "\n\n5.  **Output Generation.**" : ""}`;

const reading = ["Reviewing project docs and tests", "I am reading the setup guide and running the unit tests so I know the current behaviour before I change anything."] as const;
const fixing = ["Fixing the failing parser test", "I found the parser drops trailing blank lines, so I am changing the split and re-running only that test."] as const;
const summary = ([header, body]: readonly [string, string]) => `**${header}**\n\n${body}`;

describe("leaked summariser notes", () => {
  test("keep only the summary glued to the end of a note", () => {
    expect(tidyThinking(note(...reading))).toBe(summary(reading));
  });
  test("keep every summary when a block holds several notes", () => {
    const block = `${note(...reading)}\n\n${note(...fixing)}`;
    expect(tidyThinking(block)).toBe(`${summary(reading)}\n\n${summary(fixing)}`);
  });
  test("dedent a summary that only appears as the indented final draft", () => {
    expect(tidyThinking(note(...reading, "indented"))).toBe(summary(reading));
  });
  test("fall back to the last drafted body when the summary is missing", () => {
    expect(tidyThinking(note(...reading, "missing"))).toBe(reading[1]);
  });
  test("say so when nothing usable is left", () => {
    const empty = "Thinking Process:\n\n1.  **Analyze the Request:**\n    *   Header must be 3-7 words.";
    expect(tidyThinking(empty)).toBe(NO_SUMMARY);
  });
});

describe("while the reply streams", () => {
  test("show a placeholder, never the notes, until the summary arrives", () => {
    const full = note(...reading);
    for (let end = 20; end < full.length; end += 7) {
      const shown = tidyThinking(full.slice(0, end).trim(), true);
      expect(shown).not.toMatch(/Analyze the Request|Word count|^\s*\*   /m);
    }
    expect(tidyThinking(full.slice(0, 200), true)).toBe(STILL_THINKING);
    expect(tidyThinking(full, true)).toBe(summary(reading));
  });
  test("keep finished summaries above the note still arriving", () => {
    const partial = `${note(...reading)}\n\n${note(...fixing).slice(0, 150)}`;
    expect(tidyThinking(partial, true)).toBe(`${summary(reading)}\n\n${STILL_THINKING}`);
  });
});

describe("other thinking is unchanged", () => {
  test.each([
    "**Planning the change**\n\nI will read the file first.",
    "Thinking Process:\n\n1. Read the file.\n2. Edit it.",
    "Let me check the summary.\n\nThinking Process:\n\n1.  **Analyze the Request:** later in the text",
    "",
  ])("%#", (thinking) => {
    expect(tidyThinking(thinking)).toBe(thinking);
    expect(tidyThinking(thinking, true)).toBe(thinking);
  });
});

test("registers one display-only transformer for thinking blocks", () => {
  const registered: { fn: Function; options: unknown }[] = [];
  extension({
    on: () => { throw new Error("no event handlers expected"); },
    registerMarkdownTransformer: (fn: Function, options: unknown) => { registered.push({ fn, options }); },
  } as never);
  expect(registered).toHaveLength(1);
  expect(registered[0].options).toEqual({ messageTypes: ["assistant-thinking"] });
  const context = { messageType: "assistant-thinking", isStreaming: false, availableWidth: 80 };
  expect(registered[0].fn(note(...reading), context)).toBe(summary(reading));
});

// Exercise the installed renderer: the result is still ordinary Markdown.
const root = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
const tui = await import(pathToFileURL(join(root,
  "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const identity = (value: string) => value;
const theme = Object.fromEntries([
  "heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote",
  "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline",
].map((key) => [key, identity]));

test("installed Markdown renders the summary without the notes", () => {
  const block = `${note(...reading)}\n\n${note(...fixing)}`;
  const shown = new tui.Markdown(tidyThinking(block), 0, 0, theme).render(200).join("\n");
  expect(shown).toContain(reading[0]);
  expect(shown).toContain(fixing[1]);
  expect(shown).not.toContain("Analyze the Request");
});
