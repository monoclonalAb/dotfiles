import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { describe, expect, test } from "bun:test";
import extension, { fileHref, linkLocalFiles } from "./index";

const cwd = "/tmp/project space";
const href = "file:///tmp/project%20space/docs/operations/factory.md";
const input = "Details: [docs/operations/factory.md](docs/operations/factory.md).";

describe("local file destinations", () => {
  test("resolves project, parent, absolute and home paths", () => {
    expect(fileHref("docs/operations/factory.md", cwd)).toBe(href);
    expect(fileHref("../README.md", cwd)).toBe("file:///tmp/README.md");
    expect(fileHref("/tmp/a.md", cwd)).toBe("file:///tmp/a.md");
    expect(fileHref("~/a.md", cwd)).toBe(pathToFileURL(join(homedir(), "a.md")).href);
  });
  test("encodes path data once, with no shell or Markdown interpretation", () => {
    expect(fileHref("docs/a%20b%23c%25.md", cwd)).toContain("/docs/a%20b%23c%25.md");
    expect(fileHref("docs/a\\(b\\).md", cwd)).toContain("/docs/a%28b%29.md");
    expect(fileHref("docs/日本.md", cwd)).toContain(encodeURIComponent("日本.md"));
    expect(fileHref("./$(touch pwned).md", cwd)).toContain("/$%28touch%20pwned%29.md");
  });
  test("preserves heading and source-line anchors", () => {
    expect(fileHref("README.md#setup", cwd)).toEndWith("/README.md#setup");
    expect(fileHref("README.md:42:7", cwd)).toEndWith("/README.md#L42:7");
    expect(fileHref("src/a.ts#L9-L15", cwd)).toEndWith("/src/a.ts#L9-L15");
  });
  test.each([
    "https://example.com:42", "http://example.com/a", "mailto:me@example.com",
    "file:///tmp/a.md", "ssh://host/a", "javascript:alert(1)", "vscode://file/a",
    "https:42", "javascript:42", "mailto:42",
    "//server/share/a", "#setup", "?q=a", "a.md?q=a", "a%ZZ.md", "a%00.md", "%2F%2Fhost/a",
  ])("leaves unsupported target %s alone", (target) => {
    expect(fileHref(target, cwd)).toBeUndefined();
  });
});

describe("display-only Markdown", () => {
  test("transforms the screenshot example and code-styled labels", () => {
    expect(linkLocalFiles(input, cwd)).toBe(`Details: [docs/operations/factory.md](${href}).`);
    expect(linkLocalFiles("[`source`](src/a.ts:9)", cwd)).toContain("[\u0060source\u0060](file:///tmp/project%20space/src/a.ts#L9)");
  });
  test("supports angle destinations, parentheses and optional titles", () => {
    expect(linkLocalFiles('[guide](<docs/a b.md> "Title")', cwd)).toBe('[guide](<file:///tmp/project%20space/docs/a%20b.md> "Title")');
    expect(linkLocalFiles("[guide](docs/a(b).md)", cwd)).toContain("/docs/a%28b%29.md)");
  });
  test.each([
    "`[guide](docs/a.md)`", "`` `[guide](docs/a.md)` ``", "`code\n[guide](docs/a.md)`",
    "```md\n[guide](docs/a.md)\n```", "~~~\n[guide](docs/a.md)\n~~~",
    "> ```md\n> [guide](docs/a.md)\n> ```", "    [guide](docs/a.md)",
    "![image](docs/a.png)", "\\[guide](docs/a.md)", "[web](https://example.com)",
    "[guide][ref]\n\n[ref]: docs/a.md", "[partial](docs/a.md",
  ])("preserves examples, images, external, incomplete or unsupported links: %s", (source) => {
    expect(linkLocalFiles(source, cwd)).toBe(source);
  });
  test("resumes transforming after a fence and does not double-encode on rerender", () => {
    const source = "```\n" + input + "\n```\n" + input;
    const result = linkLocalFiles(source, cwd);
    expect(result.split(href)).toHaveLength(2);
    expect(linkLocalFiles(result, cwd)).toBe(result);
  });
  test("registers only rendering/lifecycle hooks and uses the session cwd", () => {
    const handlers: Record<string, Function> = {};
    let transform: Function = () => { throw new Error("not registered"); };
    extension({
      on: (name: string, handler: Function) => { handlers[name] = handler; },
      registerMarkdownTransformer: (fn: Function) => { transform = fn; },
    } as never);
    expect(Object.keys(handlers).sort()).toEqual(["session_shutdown", "session_start"]);
    const context = { messageType: "assistant", isStreaming: false, availableWidth: 80 };
    expect(transform(input, context)).toBe(input);
    handlers.session_start({}, { cwd, mode: "tui" });
    expect(transform(input, context)).toContain(href);
    for (const messageType of ["user", "assistant-thinking"]) {
      expect(transform(input, { ...context, messageType })).toBe(input);
    }
    expect(transform(input, { ...context, isStreaming: true })).toBe(input);
    handlers.session_start({}, { cwd: "/other/worktree", mode: "tui" });
    expect(transform(input, context)).toContain("file:///other/worktree/docs/");
    handlers.session_shutdown();
    expect(transform(input, context)).toBe(input);
    handlers.session_start({}, { cwd, mode: "rpc" });
    expect(transform(input, context)).toBe(input);
  });
});

// Exercise the installed renderer, not a substitute Markdown implementation.
const root = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
const tui = await import(pathToFileURL(join(root,
  "@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js")).href);
const identity = (value: string) => value;
const theme = Object.fromEntries([
  "heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote",
  "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline",
].map((key) => [key, identity]));

test.each([false, true])("installed Markdown renders a usable URL (OSC 8 = %s)", (hyperlinks) => {
  tui.setCapabilityOverrides({ hyperlinks });
  try {
    const render = new tui.Markdown(linkLocalFiles(input, cwd), 0, 0, theme).render(200).join("\n");
    expect(render).toContain(href);
    if (hyperlinks) expect(render).toContain(`\x1b]8;;${href}`);
    else expect(render).toContain(`(${href})`);
  } finally {
    tui.setCapabilityOverrides({});
  }
});
