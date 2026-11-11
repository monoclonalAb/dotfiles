// Pane keys: terminal Herdr keys the app has no command for. Lives in the
// status bar (0 px), where its key commands always arrive.
//
//   pane-keys.last              the pane focused before this one (C-a `)
//   pane-keys.next / .prev      cycle the panes of this tab (C-a Tab / C-a S-Tab)
//   pane-keys.go:<direction>    pane.go, after showing a zoomed tab whole (C-a h/j/k/l)
//   pane-keys.agent:<n>         the n-th conversation in the Spaces tree (C-a M-1..9)
//   pane-keys.worktree:<action> the worktree dialog: new, open or remove (C-a G / g / C-g)
//   pane-keys.panel:<id>        the right-hand panel on that view, or closed if it shows it
//                               (C-a b: the sidebar, C-a f: Files, C-a i: Brief; one
//                               area on the right, so each replaces the other)
//   pane-keys.resize:<direction> move the focused pane's edge that way by 5% of its split,
//                               as tmux's resize-pane does (see resizePlan); then H/J/K/L
//                               alone repeat it for 500 ms, as tmux's `bind -r` does
//
// Also keeps shared "pane-keys.recent": conversations (agent terminal addresses)
// by last visit, most recent first, for the conversation picker (C-a w).
//
// And keeps a zoomed tab's shown pane and focused pane the same, as tmux does.
// The app moves focus onto a pane its zoom hides (pane.focus, agent.next, a
// sidebar click), so typing went to a pane you could not see; see zoomFix.

import { View, div } from "gpui-kit";
import { focused, panes, agents, spaces, run, notify, openOverlay, shared, setShared, layout, nextCommand, exec } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The commands that open the right-hand panel (`panel`, stack `panel-body`) on
// view `id`, or close it when it already shows `id`, as the shipped tab bar's
// Files button does. `tree`: layout(). Returns { commands } or { error }.
export function panelPlan(tree, id) {
  const panel = find(tree, "panel"), body = find(tree, "panel-body");
  if (!panel || !body?.children?.some((c) => c.id === id)) return { error: `This layout has no ${id || "such"} panel` };
  if (!panel.hidden && body.active === id) return { commands: [["layout.hide", { id: "panel" }]] };
  return { commands: [["layout.select", { stack: "panel-body", child: id }], ["layout.show", { id: "panel" }]] };
}

const RECENT = "pane-keys.recent";

// `list` with `address` moved to the front, at most `cap` long; `list` itself
// when `address` is already first, so an unchanged list is never saved again.
export function remember(list, address, cap = 40) {
  const prev = Array.isArray(list) ? list : [];
  if (!address || prev[0] === address) return prev;
  return [address, ...prev.filter((x) => typeof x === "string" && x !== address)].slice(0, cap);
}

// What to run when the focused tab's zoom hides the focused pane, else null.
// `seen` and `now`: { pane: focused pane, zoomed: zoomed pane of its tab or
// null } at the last render and now. Focus that moved to a hidden pane (a jump,
// a click in the sidebar) shows the whole tab again, as tmux's select-pane does;
// a zoom that moved to another pane (its header's zoom button) takes the focus.
export function zoomFix(seen, now) {
  if (!now?.pane || !now.zoomed || now.zoomed === now.pane) return null;
  if (seen?.pane === now.pane && seen.zoomed !== now.zoomed) return ["pane.focus", { pane: now.zoomed }];
  return ["pane.zoom", { pane: now.zoomed }];
}

// Resizing. The app has no command for it (0.1.12), but herdr-core keeps each
// machine's spaces, tabs and splits in one JSON document, "herdr-app"
// (doc.get / doc.set over `hc connect`), and the app redraws when it changes.
// A split there is a row or column whose children carry { size: { weight } }:
// shares of the split, 1 when missing. The format is undocumented, so an app
// update may change it; resizePlan then reports an error instead of guessing.
export const LAYOUT_DOC = "herdr-app";
const RESIZE_STEP = 0.05; // of the split, per press
const MIN_SHARE = 0.1; // a pane never shrinks below this share of its split

// The splits from `node` down to the block `id`: [{ node, index }], nearest last.
function splitsTo(node, id, path) {
  if (node?.id === id) return path;
  const children = Array.isArray(node?.children) ? node.children : [];
  for (let i = 0; i < children.length; i++) {
    const found = splitsTo(children[i], id, [...path, { node, index: i }]);
    if (found) return found;
  }
  return null;
}

// A copy of layout document `doc` with pane `pane`'s edge moved `direction`
// ("left", "right", "up" or "down") by `step` of its split, as tmux's
// resize-pane does: in the nearest row (left/right) or column (up/down) holding
// the pane, its right or bottom edge, or its left or top edge when it is last.
// Returns { doc }, null when there is no such split or the edge is at its
// limit, or { error } when the document is not shaped as expected.
export function resizePlan(doc, pane, direction, step = RESIZE_STEP) {
  const kind = direction === "left" || direction === "right" ? "row" : "column";
  const copy = JSON.parse(JSON.stringify(doc ?? null));
  let path = null;
  for (const space of copy?.spaces ?? []) {
    for (const tab of space?.tabs ?? []) if (!path) path = splitsTo(tab?.root, pane, []);
  }
  if (!path) return { error: "The focused pane is not in Herdr's layout document" };
  let at = null;
  for (let i = path.length - 1; i >= 0 && !at; i--) {
    if (path[i].node.type === kind && path[i].node.children.length > 1) at = path[i];
  }
  if (!at) return null;
  const children = at.node.children;
  const weights = children.map((c) => (c?.size == null ? 1 : c.size.weight));
  if (!weights.every((w) => Number.isFinite(w) && w > 0)) return { error: "This split's sizes are not weights" };
  const total = weights.reduce((a, b) => a + b, 0);
  const first = Math.min(at.index, children.length - 2); // the edge between first and first + 1
  const [grow, shrink] = direction === "right" || direction === "down" ? [first, first + 1] : [first + 1, first];
  const delta = Math.min(step * total, weights[shrink] - MIN_SHARE * total);
  if (delta <= total * 1e-6) return null;
  const round = (w) => Math.round(w * 1e4) / 1e4;
  children[grow].size = { weight: round(weights[grow] + delta) };
  children[shrink].size = { weight: round(weights[shrink] - delta) };
  return { doc: copy };
}

// resizePlan for several presses in order (they came while one was being
// saved): { doc }, null when none moves an edge, or the first { error }.
export function resizeSteps(doc, pane, directions) {
  let current = doc;
  for (const direction of directions) {
    const plan = resizePlan(current, pane, direction);
    if (plan?.error) return plan;
    if (plan) current = plan.doc;
  }
  return current === doc ? null : { doc: current };
}

// After a resize key, H/J/K/L alone keep resizing until REPEAT_MS pass
// without one, as tmux's `bind -r` with its default repeat-time.
const REPEAT_MS = 500;
const REPEAT_KEYS = { h: "left", j: "down", k: "up", l: "right" };

// The direction a key event repeats in (Shift and h/j/k/l, nothing else), or null.
export function repeatDirection(event) {
  const m = event?.modifiers ?? {};
  if (!m.shift || m.control || m.alt || m.platform || m.function) return null;
  return REPEAT_KEYS[String(event?.key ?? "").toLowerCase()] ?? null;
}

// One JSON-RPC call to herdr-core. Mods' exec has no stdin, so sh pipes it in.
const RPC = 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; printf "%s\\n" "$1" | hc connect';
async function rpc(method, params) {
  const r = await exec("/bin/sh", ["-c", RPC, "sh", JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })]);
  for (const line of r.stdout.split("\n")) {
    let message = null;
    try { message = JSON.parse(line); } catch { continue; }
    if (message?.id === 1) return message;
  }
  throw new Error(r.stderr.trim() || `hc connect answered nothing (exit ${r.code})`);
}

const DIRECTIONS = ["left", "right", "up", "down"];
const UNZOOMED_FRAME = 32; // ms: two frames at 60 Hz

// Sizes the shipped space menu opens the worktree dialog at.
const WORKTREE = { new: { width: 440, height: 260 }, open: { width: 560, height: 480 }, remove: { width: 440, height: 260 } };

export default class PaneKeys extends View {
  init(_props, cx) {
    this.history = []; // pane ids, most recent first
    this.seen = null; // { pane, zoomed } at the last render, for zoomFix
    this.fixing = null; // the state a zoom fix was sent for
    this.keys = cx.focus_handle(); // holds the keyboard while H/J/K/L repeat
    this.repeat = null; // { pane, until } while they do
    this.presses = []; // resize presses not saved yet: { pane, direction }
    this.saving = false;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try { this.command(command, cx); }
        catch (e) { notify({ title: "pane-keys", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      }
    });
  }

  command(raw, cx) {
    const [command, value] = raw.includes(":") ? [raw.slice(0, raw.indexOf(":")), raw.slice(raw.indexOf(":") + 1)] : [raw, ""];
    if (command !== "resize") this.endRepeat();
    const f = focused();
    const live = panes();
    if (command === "last") {
      const previous = this.history.find((p) => p !== f?.pane && live.some((x) => x.pane === p));
      if (!previous) return notify({ title: "No previous pane", level: "info", timeout: 2000 });
      return run("pane.focus", { pane: previous });
    }
    if (command === "next" || command === "prev") {
      const mine = live.filter((p) => p.tab === f?.tab);
      if (mine.length < 2) return;
      const at = Math.max(0, mine.findIndex((p) => p.pane === f?.pane));
      return run("pane.focus", { pane: mine[(at + (command === "next" ? 1 : mine.length - 1)) % mine.length].pane });
    }
    if (command === "go") {
      if (!DIRECTIONS.includes(value)) throw new Error(`go needs left, right, up or down, got ${value}`);
      // A zoomed tab has no neighbour on screen, so pane.go alone does nothing.
      // pane.go reads where panes are drawn, so it waits for the unzoomed frame.
      const zoomed = f?.pane ? live.find((p) => p.tab === f.tab && p.zoomed) : null;
      if (!zoomed) return run("pane.go", { direction: value });
      run("pane.zoom", { pane: zoomed.pane });
      cx.timer.after(UNZOOMED_FRAME, () => run("pane.go", { direction: value }));
      return;
    }
    if (command === "agent") {
      const order = shared("spaces-tree.agents");
      const list = agents();
      const address = (Array.isArray(order) ? order : list.map((a) => a.address))[parseInt(value, 10) - 1];
      const agent = list.find((a) => a.address === address);
      if (!agent) return notify({ title: `No conversation ${value}`, level: "info", timeout: 2000 });
      return run("pane.focus", { pane: agent.pane });
    }
    if (command === "worktree") {
      if (!WORKTREE[value]) throw new Error(`worktree needs new, open or remove, got ${value}`);
      const space = spaces().find((s) => s.active);
      if (!space) return;
      return openOverlay({ mod: "worktree", kind: "dialog", ...WORKTREE[value], props: { space: space.id, folder: f?.cwd ?? undefined, action: value } });
    }
    if (command === "panel") {
      const plan = panelPlan(layout(), value);
      if (plan.error) return notify({ title: plan.error, level: "info", timeout: 2000 });
      for (const [name, args] of plan.commands) run(name, args);
      return;
    }
    if (command === "resize") {
      if (!DIRECTIONS.includes(value)) throw new Error(`resize needs left, right, up or down, got ${value}`);
      // While H/J/K/L repeat, this mod has the keyboard, not the pane.
      const pane = this.repeat && this.keys.is_focused() ? this.repeat.pane : f?.pane;
      if (pane) this.press(pane, value, cx);
      return;
    }
    throw new Error(`unknown command ${raw}`);
  }

  // A resize press: queue it, and take the keyboard so H/J/K/L alone repeat it.
  press(pane, direction, cx) {
    this.presses.push({ pane, direction });
    this.save();
    this.repeat = { pane, until: Date.now() + REPEAT_MS };
    if (!this.keys.is_focused()) this.keys.focus();
    cx.timer.after(REPEAT_MS, () => {
      if (this.repeat && Date.now() >= this.repeat.until - 10) this.endRepeat();
    });
  }

  // Give the keyboard back to the pane, unless something else took it (a click).
  endRepeat() {
    const repeat = this.repeat;
    this.repeat = null;
    if (repeat && this.keys.is_focused()) run("pane.focus", { pane: repeat.pane });
  }

  // Save queued presses, one write per run of presses on the same pane.
  async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      while (this.presses.length) {
        const pane = this.presses[0].pane;
        let n = 1;
        while (n < this.presses.length && this.presses[n].pane === pane) n++;
        await this.resize(pane, this.presses.splice(0, n).map((p) => p.direction));
      }
    } catch (e) {
      this.presses = [];
      notify({ title: "pane-keys resize", body: String(e?.message ?? e), level: "error" });
    } finally {
      this.saving = false;
    }
  }

  // Read pane `id`'s layout document, move its edges, and write it back unless
  // something changed it meanwhile (then read it again).
  async resize(id, directions) {
    // Another machine's pane is "machine/p…" here and "p…" in its own document.
    const slash = id.indexOf("/");
    const on = slash < 0 ? null : id.slice(0, slash), pane = id.slice(slash + 1);
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await rpc("doc.get", { name: LAYOUT_DOC, on });
      if (got.error) throw new Error(`doc.get: ${got.error.message}`);
      const plan = resizeSteps(got.result.value, pane, directions);
      if (!plan) return;
      if (plan.error) throw new Error(plan.error);
      const set = await rpc("doc.set", { name: LAYOUT_DOC, on, value: plan.doc, version: got.result.version });
      if (!set.error) return;
      if (set.error.data?.kind !== "conflict") throw new Error(`doc.set: ${set.error.message}`);
    }
    throw new Error("The layout kept changing; press again");
  }

  // The focused pane and its tab's zoomed pane, for zoomFix.
  zoomState() {
    const f = focused();
    const pane = f?.pane ?? null;
    return { pane, zoomed: pane ? (panes().find((p) => p.tab === f.tab && p.zoomed)?.pane ?? null) : null };
  }

  render(cx) {
    // Focus history for `last`: render runs whenever focus changes.
    const pane = focused()?.pane;
    if (pane && this.history[0] !== pane) this.history = [pane, ...this.history.filter((p) => p !== pane)].slice(0, 20);
    // A zoom hiding the focused pane: fix it once per state, after this render,
    // and only if nothing moved in between.
    const now = this.zoomState();
    const fix = zoomFix(this.seen, now);
    this.seen = now;
    const key = `${now.pane} ${now.zoomed}`;
    if (!fix) this.fixing = null;
    else if (this.fixing !== key) {
      this.fixing = key;
      cx.timer.after(0, () => {
        const later = this.zoomState();
        if (later.pane === now.pane && later.zoomed === now.zoomed) run(...fix);
      });
    }
    // A conversation visit: only agents count, and only a change is saved.
    const address = focused()?.terminal;
    if (address && agents().some((a) => a.address === address)) {
      const now = shared(RECENT);
      const next = remember(now, address);
      if (next !== now) setShared(RECENT, next);
    }
    // H/J/K/L while this holds the keyboard; any other key ends the repeat
    // (and is not typed), Escape only that.
    return div().track_focus(this.keys).on_key_down((e, cx) => {
      if (!this.repeat) return;
      const direction = repeatDirection(e);
      if (direction || e.key === "escape") cx.stop_propagation();
      if (direction) this.press(this.repeat.pane, direction, cx);
      else this.endRepeat();
    });
  }
}
