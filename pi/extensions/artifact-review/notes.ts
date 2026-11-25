// Notes sent from the review page, and the message they become in Pi.
//
// The browser describes each note's target (tag, CSS path, text, nearest
// heading) and what was on screen when it was written (pressed tabs, picker
// values, the address after #). Everything here is checked and capped before it
// becomes the user's message, because the page posts it over HTTP.

export interface Target {
  tag: string;
  selector: string;
  text?: string;
  label?: string;
  heading?: string;
}

export interface Picker {
  label: string;
  value: string;
}

export interface Screen {
  hash?: string;
  pressed?: string[];
  pickers?: Picker[];
}

export type NoteKind = "element" | "selection" | "page";

export interface Note {
  kind: NoteKind;
  note: string;
  target?: Target;
  quote?: string;
  screen?: Screen;
}

export interface Batch {
  notes: Note[];
}

/** What the message says about the page itself. */
export interface PageInfo {
  id?: string;
  title?: string;
  /** Absolute path of the page's HTML file. */
  file: string;
  project?: string;
  /** Pi session file that made the page, from artifact.json. */
  madeInSession?: string;
  /** This Pi session's file, when it has one. */
  thisSession?: string;
}

export const LIMITS = {
  notes: 50,
  note: 5000,
  selector: 500,
  text: 300,
  quote: 1000,
  heading: 200,
  label: 200,
  tag: 40,
  hash: 300,
  pressed: 10,
  pickers: 10,
  pickerLabel: 120,
  pickerValue: 200,
};

export class NoteError extends Error {}

/** Drops control characters (keeping newlines and tabs) and trims. */
function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (!multiline) text = text.replace(/\s+/g, " ");
  text = text.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function optional(value: unknown, max: number): string | undefined {
  return clean(value, max) || undefined;
}

function parseTarget(value: unknown): Target | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const tag = clean(raw.tag, LIMITS.tag).toLowerCase();
  const selector = clean(raw.selector, LIMITS.selector);
  if (!tag || !selector) return undefined;
  return {
    tag,
    selector,
    text: optional(raw.text, LIMITS.text),
    label: optional(raw.label, LIMITS.label),
    heading: optional(raw.heading, LIMITS.heading),
  };
}

function parseScreen(value: unknown): Screen | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const pressed = Array.isArray(raw.pressed)
    ? raw.pressed.map((item) => clean(item, LIMITS.pickerLabel)).filter(Boolean).slice(0, LIMITS.pressed)
    : [];
  const pickers = Array.isArray(raw.pickers)
    ? raw.pickers
        .map((item) => {
          const picker = (item ?? {}) as Record<string, unknown>;
          return { label: clean(picker.label, LIMITS.pickerLabel), value: clean(picker.value, LIMITS.pickerValue) };
        })
        .filter((picker) => picker.value)
        .slice(0, LIMITS.pickers)
    : [];
  const hash = clean(raw.hash, LIMITS.hash).replace(/^#/, "");
  const screen: Screen = {};
  if (hash) screen.hash = hash;
  if (pressed.length) screen.pressed = pressed;
  if (pickers.length) screen.pickers = pickers;
  return Object.keys(screen).length ? screen : undefined;
}

/** Checks a posted batch; throws NoteError with a reason the page can show. */
export function parseBatch(body: unknown): Batch {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).notes : undefined;
  if (!Array.isArray(raw) || raw.length === 0) throw new NoteError("no notes to send");
  if (raw.length > LIMITS.notes) throw new NoteError(`at most ${LIMITS.notes} notes at a time`);
  const notes = raw.map((item, index): Note => {
    const value = (item ?? {}) as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== "element" && kind !== "selection" && kind !== "page") throw new NoteError(`note ${index + 1}: unknown kind`);
    const note = clean(value.note, LIMITS.note, true);
    if (!note) throw new NoteError(`note ${index + 1} is empty`);
    const parsed: Note = { kind, note };
    if (kind !== "page") {
      const target = parseTarget(value.target);
      if (!target) throw new NoteError(`note ${index + 1}: missing what it points at`);
      parsed.target = target;
    }
    if (kind === "selection") {
      const quote = clean(value.quote, LIMITS.quote);
      if (!quote) throw new NoteError(`note ${index + 1}: missing the selected text`);
      parsed.quote = quote;
    }
    const screen = parseScreen(value.screen);
    if (screen) parsed.screen = screen;
    return parsed;
  });
  return { notes };
}

const quoted = (text: string) => `"${text}"`;

function describe(note: Note): string {
  if (note.kind === "page") return "On the whole page";
  const target = note.target!;
  const where = target.heading ? `, under ${quoted(target.heading)}` : "";
  if (note.kind === "selection") return `On the text ${quoted(note.quote!)} (in a ${target.tag}${where})`;
  const words = target.text || target.label;
  const extra = target.label && target.text && target.label !== target.text ? ` (${quoted(target.label)})` : "";
  return `On a ${target.tag}${words ? ` ${quoted(words)}` : ""}${extra}${where}`;
}

function screenLine(screen: Screen | undefined): string | undefined {
  if (!screen) return undefined;
  const parts = [
    ...(screen.pressed ?? []).map((text) => `selected ${quoted(text)}`),
    ...(screen.pickers ?? []).map((picker) => (picker.label ? `${picker.label}: ${quoted(picker.value)}` : `picker ${quoted(picker.value)}`)),
    ...(screen.hash ? [`address #${screen.hash}`] : []),
  ];
  return parts.length ? `Showing: ${parts.join("; ")}` : undefined;
}

/** The user message Pi receives for one Send. */
export function formatBatch(batch: Batch, page: PageInfo): string {
  const lines: string[] = [];
  const count = batch.notes.length === 1 ? "A note" : `${batch.notes.length} notes`;
  lines.push(`${count} from reviewing the page ${page.title ? quoted(page.title) : page.file} in the browser.`);
  lines.push(`File: ${page.file}`);
  if (page.project) lines.push(`Project: ${page.project}`);
  if (page.madeInSession && page.madeInSession !== page.thisSession) lines.push(`Made in another Pi session: ${page.madeInSession}`);
  batch.notes.forEach((note, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${describe(note)}`);
    const showing = screenLine(note.screen);
    if (showing) lines.push(`   ${showing}`);
    if (note.target) lines.push(`   CSS: ${note.target.selector}`);
    for (const line of note.note.split("\n")) lines.push(`   ${line}`.trimEnd());
  });
  lines.push("");
  lines.push("(Sent with /artifact-review. The browser reloads the page when files in its folder change. If a script writes the page, change the script and rerun it.)");
  return lines.join("\n");
}
