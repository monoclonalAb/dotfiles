/**
 * Pure Vim text model for the prompt editor: motions and text objects over the
 * draft's lines. Positions are UTF-16 offsets into the lines joined with "\n";
 * movement steps by grapheme (Pi's segmenter keeps its paste markers atomic).
 * Nothing here touches the editor, the terminal or the clipboard.
 */

export interface Pos {
  line: number;
  col: number;
}

/** Characters [start, end) as offsets, or whole lines first..last. */
export type Range =
  | { kind: "chars"; start: number; end: number }
  | { kind: "lines"; first: number; last: number };

export type Segmenter = (text: string) => Iterable<{ index: number; segment: string }>;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const defaultSegmenter: Segmenter = (text) => graphemes.segment(text);
const KEYWORD = /^[\p{L}\p{N}\p{M}_]/u;
const PICTOGRAPH = /^\p{Extended_Pictographic}/u;
const BRACKETS: Record<string, [string, string]> = {
  "(": ["(", ")"], ")": ["(", ")"], b: ["(", ")"],
  "[": ["[", "]"], "]": ["[", "]"],
  "{": ["{", "}"], "}": ["{", "}"], B: ["{", "}"],
  "<": ["<", ">"], ">": ["<", ">"],
};

export type FindKind = "f" | "F" | "t" | "T";

export class Draft {
  readonly lines: string[];
  readonly text: string;
  private readonly lineStarts: number[] = [];
  private readonly starts: number[] = [];
  private readonly segments: string[] = [];

  constructor(lines: readonly string[], segment: Segmenter = defaultSegmenter) {
    this.lines = lines.length > 0 ? [...lines] : [""];
    this.text = this.lines.join("\n");
    let offset = 0;
    for (const line of this.lines) {
      this.lineStarts.push(offset);
      offset += line.length + 1;
    }
    for (const { index, segment: text } of segment(this.text)) {
      this.starts.push(index);
      this.segments.push(text);
    }
  }

  /** Number of graphemes; also the index of the end-of-text position. */
  get size(): number {
    return this.segments.length;
  }

  get lastLine(): number {
    return this.lines.length - 1;
  }

  char(index: number): string {
    return this.segments[index] ?? "";
  }

  offsetOf(index: number): number {
    return index < this.starts.length ? this.starts[index]! : this.text.length;
  }

  /** Index of the grapheme containing an offset (size for the end of the text). */
  indexAt(offset: number): number {
    if (offset >= this.text.length) return this.size;
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  pos(offset: number): Pos {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let line = 0;
    while (line < this.lastLine && this.lineStarts[line + 1]! <= clamped) line++;
    return { line, col: clamped - this.lineStarts[line]! };
  }

  offset(pos: Pos): number {
    const line = Math.max(0, Math.min(pos.line, this.lastLine));
    return this.lineStarts[line]! + Math.max(0, Math.min(pos.col, this.lines[line]!.length));
  }

  lineOf(index: number): number {
    return this.pos(this.offsetOf(index)).line;
  }

  lineStart(line: number): number {
    return this.indexAt(this.lineStarts[line]!);
  }

  /** Index just past the line's last grapheme: its "\n", or size. */
  lineEnd(line: number): number {
    return this.indexAt(this.lineStarts[line]! + this.lines[line]!.length);
  }

  /** The line's last grapheme, or its start when it is empty. */
  lastChar(line: number): number {
    return Math.max(this.lineStart(line), this.lineEnd(line) - 1);
  }

  firstNonBlank(line: number): number {
    const end = this.lineEnd(line);
    for (let index = this.lineStart(line); index < end; index++) {
      if (this.cls(index, false) !== 0) return index;
    }
    return this.lastChar(line);
  }

  /** Offset just past a grapheme, for turning an inclusive end into an exclusive one. */
  after(offset: number): number {
    return this.offsetOf(Math.min(this.size, this.indexAt(offset) + 1));
  }

  /** Where a normal-mode cursor may rest: never past a line's last grapheme. */
  clampNormal(offset: number): number {
    const index = this.indexAt(offset);
    const line = this.lineOf(index);
    return this.offsetOf(Math.min(index, this.lastChar(line)));
  }

  isBlankLine(line: number): boolean {
    return this.lines[line]!.trim() === "";
  }

  /** 0 whitespace, 1 punctuation (or any WORD character), 2 keyword, 3 pictograph. */
  cls(index: number, bigWord: boolean): number {
    const char = this.char(index);
    if (char === "" || /^\s/u.test(char)) return 0;
    if (bigWord) return 1;
    if (KEYWORD.test(char)) return 2;
    if (PICTOGRAPH.test(char)) return 3;
    return 1;
  }

  private isNewline(index: number): boolean {
    return this.char(index) === "\n";
  }

  private isEmptyLineAt(index: number): boolean {
    if (index >= this.size) return this.size === 0 || this.isNewline(this.size - 1);
    return this.isNewline(index) && (index === 0 || this.isNewline(index - 1));
  }

  /** `w` / `W`: start of the next word; an empty line counts as a word. */
  wordForward(index: number, bigWord: boolean, count: number): number {
    let at = index;
    for (let step = 0; step < count && at < this.size; step++) {
      const start = this.cls(at, bigWord);
      if (start !== 0) {
        while (at < this.size && !this.isNewline(at) && this.cls(at, bigWord) === start) at++;
      }
      while (at < this.size && this.cls(at, bigWord) === 0) {
        const newline = this.isNewline(at);
        at++;
        if (newline && this.isEmptyLineAt(at)) break;
      }
    }
    return at;
  }

  /** `e` / `E`: end of the current or next word (inclusive). */
  wordEnd(index: number, bigWord: boolean, count: number): number {
    let at = index;
    for (let step = 0; step < count; step++) {
      if (at >= this.size - 1) return Math.max(0, this.size - 1);
      at++;
      while (at < this.size && this.cls(at, bigWord) === 0) at++;
      if (at >= this.size) return Math.max(0, this.size - 1);
      const kind = this.cls(at, bigWord);
      while (at + 1 < this.size && !this.isNewline(at + 1) && this.cls(at + 1, bigWord) === kind) at++;
    }
    return at;
  }

  /** `b` / `B`: start of the current or previous word. */
  wordBackward(index: number, bigWord: boolean, count: number): number {
    let at = index;
    for (let step = 0; step < count && at > 0; step++) {
      at--;
      while (at > 0 && this.cls(at, bigWord) === 0 && !this.isEmptyLineAt(at)) at--;
      const kind = this.cls(at, bigWord);
      if (kind === 0) continue;
      while (at > 0 && !this.isNewline(at - 1) && this.cls(at - 1, bigWord) === kind) at--;
    }
    return at;
  }

  /** `ge` / `gE`: end of the previous word (inclusive). */
  wordEndBackward(index: number, bigWord: boolean, count: number): number {
    let at = index;
    for (let step = 0; step < count && at > 0; step++) {
      const kind = this.cls(at, bigWord);
      if (kind !== 0) {
        while (at > 0 && !this.isNewline(at - 1) && this.cls(at - 1, bigWord) === kind) at--;
      }
      if (at === 0) break;
      at--;
      while (at > 0 && this.cls(at, bigWord) === 0 && !this.isEmptyLineAt(at)) at--;
    }
    return at;
  }

  /**
   * `f` `F` `t` `T` within the cursor's line. `repeat` is set for `;` and `,`,
   * which skip a match right next to the cursor for `t` and `T`.
   */
  find(index: number, kind: FindKind, char: string, count: number, repeat = false): number | undefined {
    const line = this.lineOf(index);
    const start = this.lineStart(line);
    const end = this.lineEnd(line);
    let found = 0;
    if (kind === "f" || kind === "t") {
      for (let at = index + 1 + (kind === "t" && repeat ? 1 : 0); at < end; at++) {
        if (this.char(at) === char && ++found === count) return kind === "f" ? at : at - 1;
      }
    } else {
      for (let at = index - 1 - (kind === "T" && repeat ? 1 : 0); at >= start; at--) {
        if (this.char(at) === char && ++found === count) return kind === "F" ? at : at + 1;
      }
    }
    return undefined;
  }

  /** `%`: the bracket matching the first bracket at or after the cursor on its line. */
  matchBracket(index: number): number | undefined {
    const end = this.lineEnd(this.lineOf(index));
    let at = index;
    while (at < end && !"()[]{}".includes(this.char(at))) at++;
    if (at >= end) return undefined;
    const char = this.char(at);
    const [open, close] = BRACKETS[char]!;
    const forward = char === open;
    let depth = 0;
    for (let scan = at + (forward ? 1 : -1); scan >= 0 && scan < this.size; scan += forward ? 1 : -1) {
      const current = this.char(scan);
      if (current === char) depth++;
      else if (current === (forward ? close : open)) {
        if (depth === 0) return scan;
        depth--;
      }
    }
    return undefined;
  }

  /** `}`: the next blank line after this paragraph, or the end of the text. */
  paragraphForward(line: number, count: number): Pos {
    let at = line;
    for (let step = 0; step < count; step++) {
      while (at < this.lastLine && this.isBlankLine(at)) at++;
      while (at < this.lastLine && !this.isBlankLine(at)) at++;
    }
    if (this.isBlankLine(at) && at !== line) return { line: at, col: 0 };
    return { line: this.lastLine, col: this.lines[this.lastLine]!.length };
  }

  /** `{`: the previous blank line before this paragraph, or the start of the text. */
  paragraphBackward(line: number, count: number): Pos {
    let at = line;
    for (let step = 0; step < count; step++) {
      while (at > 0 && this.isBlankLine(at)) at--;
      while (at > 0 && !this.isBlankLine(at)) at--;
    }
    return { line: at, col: 0 };
  }

  /** `iw` `aw` `iW` `aW` on the cursor's line. */
  wordObject(index: number, bigWord: boolean, around: boolean): Range | undefined {
    const line = this.lineOf(index);
    const start = this.lineStart(line);
    const end = this.lineEnd(line);
    if (start === end) return undefined;
    const kind = this.cls(index, bigWord);
    let first = index;
    let last = index;
    while (first > start && this.cls(first - 1, bigWord) === kind) first--;
    while (last + 1 < end && this.cls(last + 1, bigWord) === kind) last++;
    if (around) {
      if (kind === 0) {
        if (last + 1 < end) {
          const next = this.cls(last + 1, bigWord);
          while (last + 1 < end && this.cls(last + 1, bigWord) === next) last++;
        }
      } else if (last + 1 < end && this.cls(last + 1, bigWord) === 0) {
        while (last + 1 < end && this.cls(last + 1, bigWord) === 0) last++;
      } else {
        while (first > start && this.cls(first - 1, bigWord) === 0) first--;
      }
    }
    return { kind: "chars", start: this.offsetOf(first), end: this.offsetOf(last + 1) };
  }

  /** `i"` `a"` (and ' `) on the cursor's line: the surrounding or next quoted string. */
  quoteObject(index: number, quote: string, around: boolean): Range | undefined {
    const line = this.lineOf(index);
    const start = this.lineStart(line);
    const end = this.lineEnd(line);
    const quotes: number[] = [];
    for (let at = start; at < end; at++) {
      if (this.char(at) === quote && !(at > start && this.char(at - 1) === "\\")) quotes.push(at);
    }
    let open: number | undefined;
    let close: number | undefined;
    const on = quotes.indexOf(index);
    if (on >= 0) {
      [open, close] = on % 2 === 0 ? [index, quotes[on + 1]] : [quotes[on - 1], index];
    } else {
      const before = quotes.filter((at) => at < index).length;
      [open, close] = before % 2 === 1 ? [quotes[before - 1], quotes[before]] : [quotes[before], quotes[before + 1]];
    }
    if (open === undefined || close === undefined) return undefined;
    if (!around) return { kind: "chars", start: this.offsetOf(open + 1), end: this.offsetOf(close) };
    let first = open;
    let last = close;
    if (last + 1 < end && this.cls(last + 1, false) === 0) {
      while (last + 1 < end && this.cls(last + 1, false) === 0) last++;
    } else {
      while (first > start && this.cls(first - 1, false) === 0) first--;
    }
    return { kind: "chars", start: this.offsetOf(first), end: this.offsetOf(last + 1) };
  }

  /** `i(` `a(` `ib` `i{` `iB` `i[` `i<` and their `a` forms, across lines. */
  bracketObject(index: number, which: string, around: boolean): Range | undefined {
    const pair = BRACKETS[which];
    if (!pair) return undefined;
    const [open, close] = pair;
    let start: number | undefined;
    if (this.char(index) === open) start = index;
    else {
      let depth = 0;
      for (let at = index - 1; at >= 0; at--) {
        const char = this.char(at);
        if (char === close) depth++;
        else if (char === open) {
          if (depth === 0) {
            start = at;
            break;
          }
          depth--;
        }
      }
    }
    if (start === undefined) return undefined;
    let end: number | undefined;
    let depth = 0;
    for (let at = start + 1; at < this.size; at++) {
      const char = this.char(at);
      if (char === open) depth++;
      else if (char === close) {
        if (depth === 0) {
          end = at;
          break;
        }
        depth--;
      }
    }
    if (end === undefined) return undefined;
    if (around) return { kind: "chars", start: this.offsetOf(start), end: this.offsetOf(end + 1) };
    let first = start + 1;
    if (first < end && this.isNewline(first)) {
      // A block whose brackets sit on their own lines: the lines between them.
      const openLine = this.lineOf(start);
      const closeLine = this.lineOf(end);
      let indentOnly = true;
      for (let at = this.lineStart(closeLine); at < end; at++) {
        if (this.cls(at, false) !== 0) indentOnly = false;
      }
      if (indentOnly && openLine + 1 <= closeLine - 1) return { kind: "lines", first: openLine + 1, last: closeLine - 1 };
      first++;
    }
    return { kind: "chars", start: this.offsetOf(first), end: this.offsetOf(end) };
  }

  /** `ip` `ap`: the run of blank or non-blank lines around a line. */
  paragraphObject(line: number, around: boolean): Range {
    const blank = this.isBlankLine(line);
    let first = line;
    let last = line;
    while (first > 0 && this.isBlankLine(first - 1) === blank) first--;
    while (last < this.lastLine && this.isBlankLine(last + 1) === blank) last++;
    if (around) {
      if (last < this.lastLine) {
        const next = this.isBlankLine(last + 1);
        while (last < this.lastLine && this.isBlankLine(last + 1) === next) last++;
      } else if (first > 0) {
        const previous = this.isBlankLine(first - 1);
        while (first > 0 && this.isBlankLine(first - 1) === previous) first--;
      }
    }
    return { kind: "lines", first, last };
  }

  textOf(range: Range): string {
    if (range.kind === "chars") return this.text.slice(range.start, range.end);
    return `${this.lines.slice(range.first, range.last + 1).join("\n")}\n`;
  }
}

export function isBracketObject(key: string): boolean {
  return key in BRACKETS;
}

export function changeCase(text: string, how: "toggle" | "lower" | "upper"): string {
  if (how === "lower") return text.toLowerCase();
  if (how === "upper") return text.toUpperCase();
  return Array.from(text, (char) => {
    const upper = char.toUpperCase();
    return char === upper ? char.toLowerCase() : upper;
  }).join("");
}
