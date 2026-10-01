import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Convert a local Markdown destination, never a URL scheme, into a file URL. */
export function fileHref(href: string, cwd: string): string | undefined {
  // Markdown punctuation escapes, not shell escapes or environment expansion.
  href = href.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1");
  if (!href || href.startsWith("//") || href.startsWith("#") || href.includes("?")) return;
  // A bare "scheme:42" is still a URL, not an extensionless source location.
  // Treat dotted names (README.md:42) and paths with slashes as source locations.
  if (/^[a-z][a-z\d+.-]*:/i.test(href) &&
      !/^[^:/#]+\.[^:/#]+:\d+(?::\d+)?(?:#.*)?$/.test(href)) return;
  const hash = href.indexOf("#");
  let path = hash < 0 ? href : href.slice(0, hash);
  let fragment = hash < 0 ? "" : href.slice(hash + 1);
  // Common source references: foo.ts:42[:7] -> #L42[:7].
  const location = path.match(/:(\d+)(?::(\d+))?$/);
  if (location) {
    path = path.slice(0, -location[0].length);
    if (!fragment) fragment = `L${location[1]}${location[2] ? `:${location[2]}` : ""}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return;
  try {
    path = decodeURIComponent(path);
    if (!path || /[\x00-\x1f\x7f-\x9f]/.test(path) || path.startsWith("//")) return;
    if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
    const url = pathToFileURL(resolve(cwd, path));
    url.hash = fragment;
    // Keep terminal hint punctuation and Markdown delimiters percent-encoded.
    return url.href.replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return;
  }
}

// Conservative inline syntax: skip escaped characters/code spans/images; support
// ordinary links, code-styled labels, angle destinations, titles and one level
// of parentheses. Unsupported Markdown forms remain unchanged.
const inline = /\\.|(`+)[\s\S]*?\1(?!`)|(!?\[(?:\\.|[^\]\\\n])*\]\([ \t]*)(<[^<>\n]*>|(?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+)([ \t]*(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')?[ \t]*\))/g;

export function linkLocalFiles(markdown: string, cwd: string): string {
  const transform = (text: string) => text.replace(inline, (whole, code, prefix, target, suffix) => {
    if (code || !prefix || prefix.startsWith("!")) return whole;
    const angle = target.startsWith("<");
    const url = fileHref(angle ? target.slice(1, -1) : target, cwd);
    return url ? `${prefix}${angle ? `<${url}>` : url}${suffix}` : whole;
  });
  let output = "";
  let prose = "";
  let fence = "";
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = line.replace(/\r?\n$/, "").match(/^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence || marker || /^(?: {4}|\t)/.test(line)) {
      output += transform(prose) + line;
      prose = "";
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
            !marker[2].trim()) fence = "";
      } else if (marker) fence = marker[1];
    } else prose += line;
  }
  return output + transform(prose);
}

export default function localFileLinks(pi: ExtensionAPI) {
  let cwd: string | undefined;
  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.mode === "tui" ? ctx.cwd : undefined;
  });
  pi.on("session_shutdown", () => { cwd = undefined; });
  pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) =>
    cwd && messageType === "assistant" && !isStreaming ? linkLocalFiles(markdown, cwd) : markdown,
  );
}
