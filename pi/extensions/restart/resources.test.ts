// bun test ./pi/extensions/restart/*.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, test } from "bun:test";
import { resourceWatch, settingsWithoutPiRecords, type Where } from "./resources.ts";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function setup(files: Record<string, string>, { trusted = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "restart-resources-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const where: Where = {
    agentDir: join(root, "agent"), cwd: join(root, "project"), configDir: ".pi", trusted,
    contextFiles: [join(root, "project/AGENTS.md")],
  };
  return { root, where, write, path: (path: string) => join(root, path) };
}

const base = {
  "agent/extensions/compact-ui/index.ts": "export default () => {};",
  "agent/extensions/compact-ui/index.test.ts": "test",
  "agent/extensions/compact-ui/README.md": "docs",
  "agent/extensions/copy-session.ts": "export default () => {};",
  "agent/prompts/review.md": "Review it",
  "agent/settings.json": JSON.stringify({ theme: "light", defaultModel: "a" }),
  "project/AGENTS.md": "Be brief",
  "project/.pi/extensions/local/index.ts": "export default () => {};",
};

test("nothing changed: nothing to reload", () => {
  const s = setup(base);
  assert.deepEqual(resourceWatch(s.where).changes(), []);
});

test("an added, edited or removed extension is named once", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("agent/extensions/restart/index.ts", "export default () => {};");
  s.write("agent/extensions/restart/helper.mjs", "x");
  assert.deepEqual(watch.changes(), ["restart extension"]);
  s.write("agent/extensions/copy-session.ts", "export default () => { /* new */ };");
  rmSync(s.path("agent/extensions/compact-ui"), { recursive: true });
  assert.deepEqual(watch.changes().sort(), ["compact-ui extension", "copy-session extension", "restart extension"]);
});

test("a linked extension counts, as `dotfiles-link` deploys them", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("repo/restart/index.ts", "export default () => {};");
  mkdirSync(s.path("agent/extensions/restart"));
  symlinkSync(s.path("repo/restart/index.ts"), s.path("agent/extensions/restart/index.ts"));
  assert.deepEqual(watch.changes(), ["restart extension"]);
});

test("tests, READMEs and same-content rewrites are not changes", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("agent/extensions/compact-ui/index.test.ts", "changed test");
  s.write("agent/extensions/compact-ui/README.md", "changed docs");
  s.write("agent/extensions/compact-ui/index.ts", "export default () => {};");
  utimesSync(s.path("agent/extensions/compact-ui/index.ts"), new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(watch.changes(), []);
});

test("settings: what Pi records itself is ignored, anything else is a change", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("agent/settings.json", JSON.stringify({ theme: "light", defaultModel: "b", lastChangelogVersion: "9" }));
  assert.deepEqual(watch.changes(), []);
  s.write("agent/settings.json", JSON.stringify({ theme: "dark", defaultModel: "b" }));
  assert.deepEqual(watch.changes(), ["settings.json"]);
  assert.equal(settingsWithoutPiRecords("{ not json"), "{ not json");
});

test("prompts, keybindings, mcp.json and context files", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("agent/prompts/eli5.md", "Explain");
  s.write("agent/mcp.json", "{}");
  s.write("project/AGENTS.md", "Be thorough");
  assert.deepEqual(watch.changes().sort(), ["/eli5 prompt", s.path("project/AGENTS.md"), "mcp.json"].sort());
});

test("project resources count only in a trusted project", () => {
  const untrusted = setup(base);
  const a = resourceWatch(untrusted.where);
  untrusted.write("project/.pi/extensions/local/index.ts", "changed");
  assert.deepEqual(a.changes(), []);
  const trusted = setup(base, { trusted: true });
  const b = resourceWatch(trusted.where);
  trusted.write("project/.pi/extensions/local/index.ts", "changed");
  trusted.write("project/.pi/settings.json", "{\"theme\":\"dark\"}");
  assert.deepEqual(b.changes().sort(), [".pi/settings.json", "project local extension"]);
});

test("changed back: nothing to reload", () => {
  const s = setup(base);
  const watch = resourceWatch(s.where);
  s.write("agent/prompts/review.md", "Review it carefully");
  assert.deepEqual(watch.changes(), ["/review prompt"]);
  s.write("agent/prompts/review.md", "Review it");
  assert.deepEqual(watch.changes(), []);
});
