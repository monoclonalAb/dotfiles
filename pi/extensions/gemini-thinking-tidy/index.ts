import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Gemini 4 Carbon on Vertex sends its thought summariser's working notes as the
// thinking text: "Thinking Process: 1. Analyze the Request ... Word count check",
// with the real summary ("**Header**", blank line, one paragraph) at the end of
// each note. A thinking block can hold several notes back to back.

/** Each leaked note starts with this unindented line. */
const NOTE_START = /^(?=Thinking Process:[ \t]*$)/m;
/** Wording only the summariser uses, so ordinary thinking is left alone. */
const LEAK_SIGNATURE = /Summarize the provided thoughts|Analy[sz]e the (?:Request|Thoughts)|\b3-7 words\b/;
/**
 * The note's last lines: a bold header, a blank line, one paragraph. The header
 * may be glued to the previous text or indented as a draft. Numbered step titles
 * ("6.  **Final Polish:**") end in ":" or "." and are excluded.
 */
const SUMMARY = /(?<!\d\.[ \t]+)\*\*([^*\n]*[^*\n\s:.])\*\*\n\n[ \t]*([A-Za-z`"'][^\n]*)\s*$/;
/** Fallback when a note ends without its summary: the last drafted body. */
const DRAFT_BODY = /^[ \t]*\*[ \t]+(?:\*\*)?Body(?:\*\*)?:[ \t]*(.+?)(?:[ \t]*\(\d+ words\)\.?)?[ \t]*$/gm;

export const STILL_THINKING = "_Thinking…_";
export const NO_SUMMARY = "_No summary in this thinking block._";

/** Show only the summaries of a leaked Gemini thinking block; return anything else unchanged. */
export function tidyThinking(markdown: string, streaming = false): string {
  if (!/^Thinking Process:[ \t]*\n/.test(markdown) || !LEAK_SIGNATURE.test(markdown)) return markdown;
  const notes = markdown.split(NOTE_START);
  const shown: string[] = [];
  notes.forEach((note, index) => {
    if (!note.startsWith("Thinking Process:")) {
      if (note.trim()) shown.push(note.trim());
      return;
    }
    const summary = note.match(SUMMARY);
    if (summary) {
      shown.push(`**${summary[1].trim()}**\n\n${summary[2].trim()}`);
    } else if (streaming && index === notes.length - 1) {
      shown.push(STILL_THINKING);
    } else {
      const body = [...note.matchAll(DRAFT_BODY)].at(-1)?.[1].trim();
      if (body) shown.push(body);
    }
  });
  return shown.join("\n\n") || NO_SUMMARY;
}

export default function geminiThinkingTidy(pi: ExtensionAPI) {
  pi.registerMarkdownTransformer(
    (markdown, { isStreaming }) => tidyThinking(markdown, isStreaming),
    { messageTypes: ["assistant-thinking"] },
  );
}
