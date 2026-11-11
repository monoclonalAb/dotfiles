// Next agent: which conversations need you, per terminal, and keys to visit them.
// The terminal Herdr next-agent plugin, as an app mod in the status bar (a
// mod's key commands only reach a copy that is on screen, and no key hides
// the status bar).
//
//   next-agent.jump           the next blocked, then finished-unreviewed, agent
//   next-agent.back           back to where the jumps started (again: return)
//   next-agent.toggle-unread  keep this conversation unread until you reply
//   next-agent.latest         the agent that most recently came to need you
//
// Publishes shared("next-agent.dots") = { address: "blocked" | "review" |
// "working" | "idle" } for the Spaces tree and pane headers.
//
// A count that changed fades in (natively): drawn hidden by the render that
// first shows it, shown by a render FRAME ms later.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, terminals, focused, panes, run, notify, theme, shared, setShared, nextCommand } from "herdr";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------
// Per-terminal review state for agent conversations: the rules of the terminal
// Herdr next-agent plugin (herdr/plugins/next-agent/next_agent.py), ported for
// the app. Pure functions; the mod below feeds them agents() and keeps the result.
//
// The app's own `done` turns `idle` as soon as anyone looks at the agent's tab,
// which clears every split sibling at once. This ledger is per terminal:
// only focusing that terminal reviews it.

// `blocked` needs an answer now; `done` is a finished conversation not yet reviewed.
export const PRIORITY = ["blocked", "done"];

export function blank(created = null) {
  return { created, status: null, unread: false, raised: null, worked: false, seen: null, kept: false };
}

// A stored entry, upgraded; reset when the address now belongs to a new terminal.
export function normalise(entry, created = null) {
  if (!entry || typeof entry !== "object") return blank(created);
  if (created != null && entry.created != null && entry.created !== created) return blank(created);
  const status = typeof entry.status === "string" ? entry.status : null;
  const unread = entry.unread === true;
  return {
    created: created ?? entry.created ?? null,
    status,
    unread,
    raised: PRIORITY.includes(entry.raised) ? entry.raised : unread ? "done" : null,
    worked: entry.worked === true || status === "working",
    seen: Number.isInteger(entry.seen) ? entry.seen : null,
    kept: entry.kept === true,
  };
}

function fold(entry, status, focused, seq) {
  if (focused) {
    Object.assign(entry, {
      status, unread: false, raised: null, worked: status === "working",
      seen: Number.isInteger(seq) ? seq : entry.seen,
    });
    return;
  }
  if (status === "working") {
    Object.assign(entry, { status, unread: false, raised: null, worked: true });
    return;
  }
  if (status === "blocked") {
    Object.assign(entry, { status, unread: true, raised: "blocked" });
    return;
  }
  if (status === "done") {
    // Only a new finish: the app keeps reporting a done you already looked at
    // as done while its window is in the background.
    if (entry.status !== "done" || entry.worked) Object.assign(entry, { unread: true, raised: "done" });
    entry.status = status;
    return;
  }
  // idle: the app downgrades an unseen finish to idle once its tab is shown, so
  // fall back to work observed since this terminal was last focused.
  if (!entry.unread && entry.worked) {
    const moved = entry.seen === null || (Number.isInteger(seq) && seq > entry.seen);
    if (moved) Object.assign(entry, { unread: true, raised: "done" });
  }
  entry.status = status;
}

// One observation of an agent folded into its entry (a new object is returned).
// The focused terminal counts as reviewed, even while the window is in the
// background. One kept unread stays unread through focus until a new turn
// starts, i.e. the person replied.
export function observe(entry, status, focused, seq, created = null) {
  const next = normalise(entry, created);
  if (status === "working" && next.status !== "working") next.kept = false;
  fold(next, status, focused, seq);
  if (next.kept) Object.assign(next, { unread: true, raised: next.raised ?? "done" });
  return next;
}

// Keep the conversation in front of you unread until you reply, or mark it read now.
export function setKept(entry, keep, status, seq, created = null) {
  let next = { ...normalise(entry, created), kept: false };
  next = observe(next, status, true, seq, created);
  if (keep) Object.assign(next, { kept: true, unread: true, raised: "done" });
  return next;
}

// The priority bucket of a live agent, or null when it needs no attention.
export function bucket(status, entry) {
  if (status === "blocked") return "blocked";
  if ((status === "done" || status === "idle") && entry?.unread === true) return entry.raised ?? "done";
  return null;
}

// What the tree and pane headers show: blocked, review, working or idle.
export function dot(status, attention) {
  if (attention === "blocked") return "blocked";
  if (attention) return "review";
  return status === "working" ? "working" : "idle";
}

// The next agent to visit. `candidates`: [{ address, bucket }] in display order;
// returns { target } or { message } when there is nowhere to go.
export function pickJump(candidates, focusedAddress) {
  const ranked = candidates
    .map((c, i) => ({ ...c, i }))
    .filter((c) => PRIORITY.includes(c.bucket))
    .sort((a, b) => PRIORITY.indexOf(a.bucket) - PRIORITY.indexOf(b.bucket) || a.i - b.i);
  if (!ranked.length) return { message: "No agent needs attention" };
  if (ranked.length === 1 && ranked[0].address === focusedAddress) return { message: "No other agent needs attention" };
  const at = ranked.findIndex((c) => c.address === focusedAddress);
  return { target: ranked[at < 0 ? 0 : (at + 1) % ranked.length] };
}

// The agent that most recently came to need you (terminal Herdr's C-a o, which
// opened the latest notification's pane): `candidates` [{ address, bucket, seq }].
export function pickLatest(candidates, focusedAddress) {
  const waiting = candidates.filter((c) => PRIORITY.includes(c.bucket) && c.address !== focusedAddress);
  if (!waiting.length) return { message: "No other agent needs attention" };
  return { target: waiting.reduce((best, c) => ((c.seq ?? 0) > (best.seq ?? 0) ? c : best)) };
}

// The return chain after a jump from `from` to `to` (pane ids): continue an
// active chain, otherwise start one from where the person was.
export function afterJump(chain, from, to) {
  if (!from || from === to) return chain ?? {};
  const origin = chain?.last === from ? chain.origin : from;
  return { origin, last: to };
}

// Where `back` goes: { target, chain } or { message }. Going back is a toggle:
// the pane left becomes the next return target, ending the chain.
export function planBack(chain, focusedPane, livePanes) {
  const origin = chain?.origin;
  if (!origin) return { message: "No pane to return to" };
  if (!livePanes.has(origin)) return { message: "Previous pane is gone", chain: {} };
  if (origin === focusedPane) return { message: "Already on the previous pane" };
  return { target: origin, chain: { origin: focusedPane, last: null } };
}

// --- The mod ------------------------------------------------------------------

export const DOTS = "next-agent.dots";
// The Spaces tree publishes the agents it shows, in its order.
const ORDER = "spaces-tree.agents";
export const GLYPH = { blocked: "◆", review: "●", working: "◐", idle: "○" };
export const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FADE = 200; // a changed count fading in, ms
const FRAME = 32; // long enough for one frame to be drawn in between

export default class NextAgent extends View {
  init(_props, cx) {
    this.ledger = JSON.parse(localStorage.getItem("ledger") ?? "{}");
    this.chain = JSON.parse(localStorage.getItem("chain") ?? "{}");
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try { this.command(command); } catch (e) { notify({ title: "next-agent", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      }
    });
  }

  // Fold every live agent into the ledger; publish the dots when they change.
  sync() {
    const list = agents();
    const all = terminals();
    const created = new Map(all.map((t) => [t.address, t.created_ms ?? null]));
    const ledger = {};
    const dots = {};
    const buckets = {};
    for (const a of list) {
      const entry = observe(this.ledger[a.address], a.status, a.focused, a.seq, created.get(a.address) ?? null);
      ledger[a.address] = entry;
      buckets[a.address] = bucket(a.status, entry);
      dots[a.address] = dot(a.status, buckets[a.address]);
    }
    // Keep entries of terminals that are only briefly missing (a restart lists
    // nothing at first); drop those whose terminal has ended.
    const live = new Set(all.filter((t) => t.state === "live").map((t) => t.address));
    for (const [address, entry] of Object.entries(this.ledger)) {
      if (!(address in ledger) && (live.has(address) || !all.length)) ledger[address] = entry;
    }
    if (!same(ledger, this.ledger)) {
      this.ledger = ledger;
      localStorage.setItem("ledger", JSON.stringify(ledger));
    }
    if (!same(dots, shared(DOTS) ?? {})) setShared(DOTS, dots);
    return { list, buckets };
  }

  saveChain(chain) {
    this.chain = chain ?? {};
    localStorage.setItem("chain", JSON.stringify(this.chain));
  }

  command(command) {
    const { list, buckets } = this.sync();
    const f = focused();
    if (command === "jump") {
      const order = shared(ORDER);
      const byAddress = new Map(list.map((a) => [a.address, a]));
      const ordered = Array.isArray(order)
        ? [...order.map((address) => byAddress.get(address)).filter(Boolean), ...list.filter((a) => !order.includes(a.address))]
        : list;
      const pick = pickJump(ordered.map((a) => ({ address: a.address, bucket: buckets[a.address] })), f?.terminal);
      if (pick.message) return notify({ title: pick.message, level: "info", timeout: 2500 });
      const target = byAddress.get(pick.target.address);
      run("pane.focus", { pane: target.pane });
      this.saveChain(afterJump(this.chain, f?.pane, target.pane));
    } else if (command === "latest") {
      const pick = pickLatest(list.map((a) => ({ address: a.address, bucket: buckets[a.address], seq: a.seq })), f?.terminal);
      if (pick.message) return notify({ title: pick.message, level: "info", timeout: 2500 });
      const target = list.find((a) => a.address === pick.target.address);
      run("pane.focus", { pane: target.pane });
      this.saveChain(afterJump(this.chain, f?.pane, target.pane));
    } else if (command === "back") {
      const plan = planBack(this.chain, f?.pane, new Set(panes().map((p) => p.pane)));
      if (plan.chain) this.saveChain(plan.chain);
      if (plan.message) return notify({ title: plan.message, level: "info", timeout: 2500 });
      run("pane.focus", { pane: plan.target });
    } else if (command === "toggle-unread") {
      const a = list.find((x) => x.address === f?.terminal);
      if (!a) return notify({ title: "Not an agent conversation", level: "info", timeout: 2500 });
      const created = terminals().find((t) => t.address === a.address)?.created_ms ?? null;
      const keep = !this.ledger[a.address]?.kept;
      this.ledger = { ...this.ledger, [a.address]: setKept(this.ledger[a.address], keep, a.status, a.seq, created) };
      localStorage.setItem("ledger", JSON.stringify(this.ledger));
      this.sync();
      notify({ title: keep ? "Kept unread until you reply" : "Marked read", level: "info", timeout: 2000 });
    } else {
      notify({ title: `next-agent: unknown command ${command}`, level: "warning" });
    }
  }

  render(cx) {
    const t = theme();
    const { buckets } = this.sync();
    const values = Object.values(buckets);
    const blocked = values.filter((b) => b === "blocked").length;
    const review = values.filter((b) => b === "done").length;
    // Each count is keyed by what it says; one the last render did not draw is new.
    const before = this.drawn ?? null;
    this.drawn = new Set();
    let fresh = false;
    const enter = (el, key) => {
      this.drawn.add(key);
      const isNew = before !== null && !before.has(key);
      fresh ||= isNew;
      return el.id(key).opacity(isNew ? 0 : 1).transition("opacity", FADE);
    };
    const count = (kind, n) => enter(h_flex(), `na-${kind}-${n}`).gap(4).items_center().text_color(t[TONE[kind]]).child(GLYPH[kind]).child(String(n));
    const shown = [
      blocked > 0 && count("blocked", blocked),
      review > 0 && count("review", review),
      !blocked && !review && enter(div(), "na-read").child(`${GLYPH.idle} all read`),
    ].filter(Boolean);
    if (fresh) cx.timer.after(FRAME, (cx) => cx.notify());
    return h_flex()
      .id("next-agent")
      .size_full()
      .px(10)
      .gap(10)
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.dim)
      .cursor_pointer()
      .tooltip("Next agent needing you (C-a u), back (C-a U), keep unread (C-a m)")
      .on_click(() => this.command("jump"))
      .children(shown);
  }
}
