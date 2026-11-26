// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { plan, quote, flags, command } = await loadMod("pi-resume");
const shell = { key: "shell", shell: true, agent: false };
const pi = { key: "pi", shell: false, agent: true };
const term = (over) => ({ address: "t7", pid: 51003, state: "live", status: null, program: shell,
  labels: { "pi.session": "/s/fix login.jsonl", "pi.shell": "45726" }, ...over });

test("a recovered terminal with a shell in front is resumed", () => {
  assert.deepEqual(plan([term()]), [{ address: "t7", pid: "51003", file: "/s/fix login.jsonl", act: "resume", parked: false, flags: [] }]);
  assert.equal(command(plan([term()])[0]), "pi --session '/s/fix login.jsonl'");
});

test("a conversation parked when the Mac restarted comes back parked, with its flags", () => {
  const labels = { "pi.session": "/s/a.jsonl", "pi.shell": "45726", "pi.parked": "1",
    "pi.args": JSON.stringify(["-a", "--session-dir", "/s/my dir", "--no-skills", "--tui-mode", "fullscreen"]) };
  const [t] = plan([term({ labels })]);
  assert.deepEqual([t.parked, t.flags], [true, ["-a", "--session-dir", "/s/my dir", "--tui-mode", "fullscreen"]]);
  assert.equal(command(t), "pi --parked -a --session-dir '/s/my dir' --tui-mode 'fullscreen' --session '/s/a.jsonl'");
  const running = plan([term({ labels: { ...labels, "pi.parked": "" } })])[0];
  assert.equal(command(running), "pi -a --session-dir '/s/my dir' --tui-mode 'fullscreen' --session '/s/a.jsonl'");
});

test("only the flags the pi wrapper repeats are typed; anything else drops them all", () => {
  assert.deepEqual(flags(JSON.stringify(["--approve", "-e", "/x/ext.ts", "--fast", "--no-skills"])), ["--approve", "-e", "/x/ext.ts", "--fast"]);
  assert.deepEqual(flags(JSON.stringify(["-a", "; rm -rf ~"])), []);
  assert.deepEqual(flags(JSON.stringify(["--system-prompt", "x"])), []);
  assert.deepEqual(flags(JSON.stringify(["--session-dir"])), [], "a value flag without its value");
  assert.deepEqual(flags("not json"), []);
  assert.deepEqual(flags(undefined), []);
  assert.deepEqual(flags(JSON.stringify(["--session-dir", "/s/two\rlines"])), [], "a control character in a value");
  assert.equal(command({ file: "/s/a.jsonl", parked: false, flags: ["--session-dir", "=ls"] }), "pi --session-dir '=ls' --session '/s/a.jsonl'",
    "values are always quoted: zsh expands a bare =word");
  assert.equal(command({ file: "/s/a.jsonl", parked: false, flags: ["-e", "$(touch /tmp/x)"] }), "pi -e '$(touch /tmp/x)' --session '/s/a.jsonl'");
});

test("Pi still running, or killed in the same shell, is left alone", () => {
  assert.deepEqual(plan([term({ pid: 45726, program: pi, status: "idle" })]), []);
  assert.deepEqual(plan([term({ pid: 45726 })]), []);
});

test("a recovered terminal running something else is decided once, not typed into", () => {
  assert.deepEqual(plan([term({ program: { key: "nvim", shell: false } })]).map((t) => t.act), ["skip"]);
});

test("each recovered shell is decided once", () => {
  assert.deepEqual(plan([term({ labels: { "pi.session": "/s/a.jsonl", "pi.shell": "45726", "pi.resumed": "51003" } })]), []);
  assert.deepEqual(plan([term()], new Set(["t7:51003"])), []);
  // Recovered again later: a new shell, decided again.
  assert.equal(plan([term({ pid: 60000, labels: { "pi.session": "/s/a.jsonl", "pi.shell": "45726", "pi.resumed": "51003" } })]).length, 1);
});

test("unlabelled, finished or pid-less terminals are ignored", () => {
  assert.deepEqual(plan([term({ labels: {} }), term({ state: "finished" }), term({ pid: undefined })]), []);
  assert.deepEqual(plan([term({ labels: { "pi.session": "/s/a.jsonl" } })]), [], "no shell recorded: never resume");
});

test("file names are quoted for the shell", () => {
  assert.equal(quote("/s/it's here.jsonl"), `'/s/it'\\''s here.jsonl'`);
});
