// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { shows } = await loadMod("toast-filter");
// What Herdr 0.1.17 posted for a test agent in Space "toast test".
const focus = { name: "agent.focus", args: { terminal: "t1bp" } };
const blocked = { title: "fake needs you", body: "toast test / 1", level: "error", action: focus };
const done = { title: "fake finished", body: "toast test / 1", level: "info", action: focus };

test("conversation alerts show", () => {
  assert.equal(shows(blocked), true);
  assert.equal(shows(done), true);
  assert.equal(shows({ ...done, title: "Pi is done" }), true, "reworded: the action still marks it");
  assert.equal(shows({ ...done, action: undefined }), true, "no action: the title still marks it");
});

test("errors show", () => {
  assert.equal(shows({ title: "Popup failed", body: "boom", level: "error" }), true);
  assert.equal(shows({ title: "Pi conversation not resumed", body: "t7 was busy.", level: "error" }), true);
});

test("everything else is dropped", () => {
  for (const n of [
    { title: "Personal · dotfiles", level: "info", timeout: 2000 },
    { title: "Active: Personal", body: "Personal 19 · Work 32", level: "info" },
    { title: "Marked read", level: "info", timeout: 2000 },
    { title: "Resumed Pi", body: "t7: fix login", level: "info", timeout: 4000 },
    { title: "No current Space to send", level: "warning" },
    { title: "Sent api to Work", level: "info", timeout: 2500 },
  ]) assert.equal(shows(n), false, n.title);
  assert.equal(shows(null), false);
});
