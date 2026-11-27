// Pane keys: terminal Herdr keys the app's commands alone don't give. Lives in
// the status bar (0 px), where its key commands always arrive.
//
//   pane-keys.last              the pane focused before this one (C-a `)
//   pane-keys.back / .forward   step back and forward through the panes you were in,
//                               as a browser's Back and Forward (C-a [ / C-a ])
//   pane-keys.next / .prev      cycle the panes of this tab (C-a Tab / C-a S-Tab)
//   pane-keys.go:<direction>    pane.go, after showing a zoomed tab whole (C-a h/j/k/l)
//   pane-keys.agent:<n>         the n-th conversation in the Spaces tree (C-a M-1..9)
//   pane-keys.worktree:<action> the worktree dialog: new, open or remove (C-a G / g / C-g)
//   pane-keys.panel:<id>        the right-hand panel on that view, or closed if it shows it
//                               (C-a b: the sidebar, C-a f: Files; one
//                               area on the right, so each replaces the other)
//   pane-keys.resize:<direction> the app's pane.resize on the focused pane (C-a H/J/K/L);
//                               then H/J/K/L alone repeat it for 500 ms, as tmux's
//                               `bind -r` does
//
// Also keeps shared "pane-keys.recent": conversations and Neovim panes (their
// terminal addresses) by last visit, most recent first, for the conversation
// picker (C-a w).
//
// And keeps a zoomed tab's shown pane and focused pane the same, as tmux does.
// The app moves focus onto a pane its zoom hides (pane.focus, agent.next, a
// sidebar click), so typing went to a pane you could not see; see zoomFix.

import { View, div } from "gpui-kit";
import { focused, panes, agents, spaces, run, notify, openOverlay, shared, setShared, layout, nextCommand } from "herdr";

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

// Back and forward. `trail`: { list: pane ids, oldest first, each once, at its
// latest visit; at: the index of the pane you are in }. Example: you visit A,
// B, C, D; back goes to C, then B; forward goes to C again. Focus that lands
// anywhere by other means (a click, C-a u) drops what was ahead, as a browser
// drops Forward after you open a new page.
const TRAIL_CAP = 50;

export function emptyTrail() {
  return { list: [], at: -1 };
}

// The trail after focus lands on `pane` other than by back or forward.
export function visitTrail(trail, pane, cap = TRAIL_CAP) {
  if (!pane || trail.list[trail.at] === pane) return trail;
  const list = [...trail.list.slice(0, trail.at + 1).filter((p) => p !== pane), pane].slice(-cap);
  return { list, at: list.length - 1 };
}

// One step back (-1) or forward (+1), over panes since closed:
// { trail, pane }, or null at that end.
export function stepTrail(trail, delta, isLive) {
  for (let i = trail.at + delta; i >= 0 && i < trail.list.length; i += delta) {
    if (isLive(trail.list[i])) return { trail: { list: trail.list, at: i }, pane: trail.list[i] };
  }
  return null;
}

const RECENT = "pane-keys.recent";

// `list` with `address` moved to the front, at most `cap` long; `list` itself
// when `address` is already first, so an unchanged list is never saved again.
export function remember(list, address, cap = 40) {
  const prev = Array.isArray(list) ? list : [];
  if (!address || prev[0] === address) return prev;
  return [address, ...prev.filter((x) => typeof x === "string" && x !== address)].slice(0, cap);
}

// The terminal a focus counts as a visit to, else null: an agent's, or a Neovim
// pane's (spaces-tree's isEditor), as the conversation picker lists both.
// `f`: focused().
export function visitOf(f, agentList, paneList) {
  const address = f?.terminal;
  if (!address) return null;
  if (agentList.some((a) => a.address === address)) return address;
  const pane = paneList.find((p) => p.terminal === address);
  return pane?.program?.key === "nvim" && !pane.program.agent ? address : null;
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

// Resizing is the app's pane.resize (0.1.17): it moves the border nearest the
// pane in that direction by 40 px, as dragging it would (same limits), whichever
// side of the border the pane is on, as tmux's resize-pane does. Without a split
// that way, or in a zoomed tab, nothing moves. After a resize key, H/J/K/L alone
// keep resizing until REPEAT_MS pass without one, as tmux's `bind -r` with its
// default repeat-time.
const REPEAT_MS = 500;
const REPEAT_KEYS = { h: "left", j: "down", k: "up", l: "right" };

// The direction a key event repeats in (Shift and h/j/k/l, nothing else), or null.
export function repeatDirection(event) {
  const m = event?.modifiers ?? {};
  if (!m.shift || m.control || m.alt || m.platform || m.function) return null;
  return REPEAT_KEYS[String(event?.key ?? "").toLowerCase()] ?? null;
}

const DIRECTIONS = ["left", "right", "up", "down"];
const UNZOOMED_FRAME = 32; // ms: two frames at 60 Hz

// Sizes the shipped space menu opens the worktree dialog at.
const WORKTREE = { new: { width: 440, height: 260 }, open: { width: 560, height: 480 }, remove: { width: 440, height: 260 } };

export default class PaneKeys extends View {
  init(_props, cx) {
    this.history = []; // pane ids, most recent first
    this.trail = emptyTrail(); // for back and forward
    this.stepping = null; // { from, to } until a back or forward lands
    this.seen = null; // { pane, zoomed } at the last render, for zoomFix
    this.fixing = null; // the state a zoom fix was sent for
    this.keys = cx.focus_handle(); // holds the keyboard while H/J/K/L repeat
    this.repeat = null; // { pane, until } while they do
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
    if (command === "back" || command === "forward") {
      const step = stepTrail(this.trail, command === "back" ? -1 : 1, (p) => p !== f?.pane && live.some((x) => x.pane === p));
      if (!step) return notify({ title: command === "back" ? "No earlier pane" : "No later pane", level: "info", timeout: 2000 });
      this.trail = step.trail;
      this.stepping = { from: f?.pane, to: step.pane };
      return run("pane.focus", { pane: step.pane });
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

  // A resize press: resize, and take the keyboard so H/J/K/L alone repeat it.
  press(pane, direction, cx) {
    run("pane.resize", { direction, pane });
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
    // Back and forward: a focus they did not make is a new visit. Until theirs
    // lands, the pane they left is still focused; that is no visit.
    if (pane && this.stepping?.to === pane) this.stepping = null;
    else if (pane && this.stepping?.from !== pane) {
      this.stepping = null;
      this.trail = visitTrail(this.trail, pane);
    }
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
    // A visit to a conversation or an editor; only a change is saved.
    const address = visitOf(focused(), agents(), panes());
    if (address) {
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
