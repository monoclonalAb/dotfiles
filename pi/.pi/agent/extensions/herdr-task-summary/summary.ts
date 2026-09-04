export const HERDR_SUMMARY_TOKEN = "task_summary";
export const HERDR_SUMMARY_SOURCE = "pi-task-summary";
export const EMPTY_SESSION_SUMMARY = "New conversation";
export const MAX_SUMMARY_LENGTH = 72;
export const MAX_SUMMARY_WORDS = 6;

type TextBlock = { type?: unknown; text?: unknown };
export type UserContent = string | TextBlock[];

export interface HerdrEnvironment {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
  HERDR_BIN_PATH?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number; stderr?: string }>;

const IMAGE_EXTENSION = "(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)";
const IMAGE_PATH = new RegExp(
  `^(?:@|file:\\/\\/)?(?:~\\/|\\.{0,2}\\/|\\/)[^\\n]+\\.${IMAGE_EXTENSION}(?:\\?[^\\s]*)?$`,
  "i",
);
const INLINE_IMAGE_PATH = new RegExp(
  `(?:@|file:\\/\\/)?(?:~\\/|\\.{0,2}\\/|\\/)[^\\s]+?\\.${IMAGE_EXTENSION}(?:\\?[^\\s]*)?`,
  "giu",
);
const EMPTY_FOLLOW_UP = /^(?:ok(?:ay)?(?:,? sounds good)?|yes|yep|no|thanks?(?: you)?|great|perfect|sounds good|looks good|go ahead|do it|continue|please continue|that works|ship it)[.!?\s]*$/i;
const DEICTIC_FOLLOW_UP = /^(?:ok(?:ay)?[, ]+)?(?:(?:can|could|would) you (?:please )?)?(?:do|fix|apply|implement|handle|try) (?:that|it|this)(?: for me)?[.!?\s]*$/i;
const AGENT_HANDOFF = /^(?:spin up|start|open|launch) (?:a |an )?(?:new )?(?:pi|omp|claude|codex)(?: instance| session| agent)? and (?:do|handle) (?:that|it|this)(?: for me)?[.!?\s]*$/i;
const COMMAND_ONLY = /^(?:[a-z]\s+)?\/[a-z][\w-]*(?:\s+[^\n]*)?$/i;

function textFromContent(content: UserContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function isStandaloneImagePath(line: string): boolean {
  const unwrapped = line
    .trim()
    .replace(/^```(?:\w+)?\s*/, "")
    .replace(/```$/, "")
    .replace(/^[`'\"]|[`'\"]$/g, "")
    .trim();
  return IMAGE_PATH.test(unwrapped);
}

function normalizePhrases(value: string): string {
  return value
    .replace(/\bcome up with\b/giu, "create")
    .replace(
      /\b(?:like\s+)?a few[-\s]+words?\s+(?:distinct\s+)?summary about what (?:this|the) agent is doing\b/giu,
      "a concise agent task summary",
    );
}

function inferIssueTask(value: string): string | undefined {
  const issue = value.match(
    /\b(empty|blank|missing|unclear|misleading|generic|truncated|stale|incorrect|wrong|broken|duplicate)\s+(title|summary|label|name|text|status|indicator|metadata)\b/iu,
  );
  if (!issue) return undefined;

  const issueIndex = issue.index ?? value.length;
  const contexts = Array.from(
    value.slice(0, issueIndex).matchAll(
      /\b([\p{L}\p{N}_.-]+)\s+(conversation|session|sidebar|pane|tab|workspace|agent|extension)\b/giu,
    ),
  );
  const contextMatch = contexts.at(-1);
  const context = contextMatch
    ? `${contextMatch[1]} ${contextMatch[2]}`
      .replace(/^pi\b/iu, "Pi")
      .replace(/^omp\b/iu, "OMP")
      .replace(/^herdr\b/iu, "Herdr")
    : "";
  const parts = ["Fix", issue[1].toLocaleLowerCase(), context, issue[2].toLocaleLowerCase()]
    .filter(Boolean);
  return parts.join(" ");
}

function focusOnTaskAction(value: string): string | undefined {
  const actions = Array.from(
    value.matchAll(
      /\b(add|build|create|debug|delete|design|diagnose|document|fix|implement|improve|investigate|migrate|optimize|refactor|remove|rename|repair|replace|review|test|update|verify)\b/giu,
    ),
  );
  const action = actions.at(-1);
  return action?.index === undefined ? undefined : value.slice(action.index);
}

function removeBoilerplate(value: string): string {
  let result = value;
  const prefixes = [
    /^(?:also\s+)?this\s+(?:doesn['’]?t|doesnt)\s+(?:really\s+)?(?:tell|show)\s+me\s+(?:very\s+)?much[,;:]?\s*/i,
    /^(?:also\s+)?is\s+it\s+possible\s+to\s+/i,
    /^wait[, ]+(?:i'?m|i am)\s+so\s+confused[,;:]?\s*/i,
    /^(?:wait[, ]+)?i\s+mean[,;:]?\s*/i,
    /^actually[,;:]?\s*/i,
    /^(?:hi|hey|hello)\b[,:!\s-]*/i,
    /^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i,
    /^(?:please\s+)?i(?:'d| would)\s+like\s+(?:you\s+)?to\s+/i,
    /^(?:please\s+)?i\s+want\s+(?:you\s+)?to\s+/i,
    /^(?:also|currently|right now)\b[,:!\s-]*/i,
    /^please\s+/i,
  ];
  for (const prefix of prefixes) result = result.replace(prefix, "");
  return result.trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  const words = value.split(/\s+/u);
  const wordBounded = words.length > MAX_SUMMARY_WORDS
    ? words.slice(0, MAX_SUMMARY_WORDS).join(" ")
    : value;
  const characters = Array.from(wordBounded);
  if (characters.length <= maxLength) return wordBounded;

  const candidate = characters.slice(0, maxLength - 1).join("");
  const boundary = candidate.lastIndexOf(" ");
  const clipped = boundary >= Math.floor(maxLength * 0.6)
    ? candidate.slice(0, boundary)
    : candidate;
  return `${clipped.replace(/[,:;\s-]+$/u, "")}…`;
}

/** Derive a compact display label without changing the user message. */
export function summarizeUserRequest(
  content: UserContent,
  maxLength = MAX_SUMMARY_LENGTH,
): string | undefined {
  const withoutImagePaths = textFromContent(content)
    .split(/\r?\n/u)
    .filter((line) => !isStandaloneImagePath(line))
    .join(" ")
    .replace(INLINE_IMAGE_PATH, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!withoutImagePaths) return undefined;

  const normalized = normalizePhrases(withoutImagePaths);
  const withoutBoilerplate = removeBoilerplate(normalized);
  const summary = (focusOnTaskAction(withoutBoilerplate)
    ?? inferIssueTask(normalized)
    ?? withoutBoilerplate)
    .replace(/[,\s]+(?:please|thanks)[.!?\s]*$/iu, "")
    .replace(/[.!?\s]+$/u, "")
    .trim();
  if (
    !summary ||
    EMPTY_FOLLOW_UP.test(summary) ||
    DEICTIC_FOLLOW_UP.test(summary) ||
    AGENT_HANDOFF.test(summary) ||
    COMMAND_ONLY.test(summary)
  ) {
    return undefined;
  }

  const capitalized = summary.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
  return truncateAtWord(capitalized, Math.max(12, maxLength));
}

export function latestTaskSummary(
  entries: readonly unknown[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as {
      type?: unknown;
      message?: { role?: unknown; content?: unknown };
    };
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content !== "string" && !Array.isArray(content)) continue;
    const summary = summarizeUserRequest(content as UserContent);
    if (summary) return summary;
  }
  return undefined;
}

/** Best-effort display metadata reporting; no session or model context is touched. */
export async function reportTaskSummary(
  summary: string | undefined,
  environment: HerdrEnvironment,
  run: CommandRunner,
): Promise<boolean> {
  const paneId = environment.HERDR_PANE_ID?.trim();
  if (environment.HERDR_ENV !== "1" || !paneId) return false;

  const command = environment.HERDR_BIN_PATH?.trim() || "herdr";
  const args = [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    HERDR_SUMMARY_SOURCE,
    "--agent",
    "pi",
    ...(summary
      ? ["--token", `${HERDR_SUMMARY_TOKEN}=${summary}`]
      : ["--clear-token", HERDR_SUMMARY_TOKEN]),
  ];

  try {
    const result = await run(command, args);
    return result.code === 0;
  } catch {
    return false;
  }
}
