// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { plan, quote } = await loadMod("pi-resume");
const shell = { key: "shell", shell: true, agent: false };
const pi = { key: "pi", shell: false, agent: true };
const term = (over) => ({ address: "t7", pid: 51003, state: "live", status: null, program: shell,
  labels: { "pi.session": "/s/fix login.jsonl", "pi.shell": "45726" }, ...over });

test("a recovered terminal with a shell in front is resumed", () => {
  assert.deepEqual(plan([term()]), [{ address: "t7", pid: "51003", file: "/s/fix login.jsonl", act: "resume" }]);
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
