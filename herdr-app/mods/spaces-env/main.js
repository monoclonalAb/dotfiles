// Personal/Work environments: the terminal Herdr spaces-env plugin as an app mod.
// Lives in the status bar, where its key commands always arrive, and shows the
// active environment (click: toggle). The Spaces tree hides the other
// environment's Spaces, except the focused one.
//
//   spaces-env.toggle           the other environment's most recent Space
//   spaces-env.send             move the current Space to the other environment
//   spaces-env.select:<n>       the n-th Space the sidebar shows (1-9)
//   spaces-env.next / .prev     the next / previous one the sidebar shows
//   spaces-env.assign:<id>=<env>  for scripts (bin/herdr-import)
//   spaces-env.status           a summary
//
// State: shared("spaces-env") = { active, assign: { spaceId: env }, mru }.
//
// The highlight slides to the active environment (natively, on a spring); it
// needs both labels' widths, so until they are measured the label is lit itself.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, machines, run, notify, theme, settings, shared, setShared, nextCommand } from "herdr";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------
// Personal/Work environments for Spaces: the rules of the terminal Herdr
// spaces-env plugin (herdr/plugins/spaces-env/spaces_env.py), ported for the
// app. Pure functions over { active, assign: { spaceId: env }, mru: { env: [ids] } };
// every function returns a new state.

export const ENVS = ["personal", "work"];
export const DEFAULT_ENV = "personal";
export const other = (env) => (env === "work" ? "personal" : "work");
export const title = (env) => env[0].toUpperCase() + env.slice(1);

const copy = (state) => JSON.parse(JSON.stringify(state));

export function blank() {
  return { active: DEFAULT_ENV, assign: {}, mru: { personal: [], work: [] } };
}

export function normalise(raw) {
  const state = blank();
  if (!raw || typeof raw !== "object") return state;
  if (ENVS.includes(raw.active)) state.active = raw.active;
  for (const [id, env] of Object.entries(raw.assign ?? {})) if (ENVS.includes(env)) state.assign[id] = env;
  for (const env of ENVS) {
    const list = Array.isArray(raw.mru?.[env]) ? raw.mru[env] : [];
    state.mru[env] = [...new Set(list.filter((id) => typeof id === "string"))];
  }
  return state;
}

// Fold the live Spaces in: forget `gone` ids, give unassigned live ones `fresh`
// (default Personal), and rebuild each MRU from live members, appending missing
// ones in sidebar order. Returns { state, added }.
export function reconcile(state, order, { gone = [], fresh = DEFAULT_ENV } = {}) {
  const next = copy(state);
  for (const id of gone) delete next.assign[id];
  const added = [];
  for (const id of order) {
    if (!(id in next.assign)) {
      next.assign[id] = fresh;
      added.push(id);
    }
  }
  const live = new Set(order);
  for (const env of ENVS) {
    const members = next.mru[env].filter((id) => next.assign[id] === env && (live.has(id) || !gone.length));
    for (const id of order) if (next.assign[id] === env && !members.includes(id)) members.push(id);
    next.mru[env] = members.filter((id) => !gone.includes(id));
  }
  return { state: next, added };
}

// Assign a Space and make it that environment's most recent one.
export function assign(state, id, env) {
  const next = copy(state);
  for (const e of ENVS) next.mru[e] = next.mru[e].filter((x) => x !== id);
  next.assign[id] = env;
  next.mru[env].unshift(id);
  return next;
}

export function touch(state, id) {
  const env = state.assign[id];
  if (!env) return state;
  const next = copy(state);
  next.mru[env] = [id, ...next.mru[env].filter((x) => x !== id)];
  return next;
}

// Most recently used live Space of env, falling back to sidebar order.
export function pickTarget(state, env, order) {
  const live = new Set(order);
  return state.mru[env].find((id) => live.has(id) && state.assign[id] === env)
    ?? order.find((id) => state.assign[id] === env) ?? null;
}

// The environment a toggle leaves. Focus normally keeps `active` in step with the
// focused Space; when they differ and the stored environment still has members,
// the focused Space wins. An empty stored environment is the limbo left by
// toggling into it, and the stored value wins so the next toggle returns.
export function currentEnv(state, focusedId, order) {
  const focusedEnv = state.assign[focusedId];
  if (ENVS.includes(focusedEnv) && focusedEnv !== state.active && order.some((id) => state.assign[id] === state.active)) return focusedEnv;
  return state.active;
}

export function planToggle(state, order, focusedId) {
  const from = currentEnv(state, focusedId, order);
  let next = focusedId ? touch(state, focusedId) : state;
  const dest = other(from);
  const target = pickTarget(next, dest, order);
  next = { ...copy(next), active: dest };
  return { state: next, dest, target };
}

// Move a Space to the other environment; stay in the source when it has another
// Space (remaining), else follow the moved Space.
export function planSend(state, order, id) {
  const src = state.assign[id] ?? DEFAULT_ENV;
  const dest = other(src);
  let next = assign(state, id, dest);
  const remaining = pickTarget(next, src, order);
  next = { ...next, active: remaining ? src : dest };
  return { state: next, src, dest, remaining };
}

// The person focused a Space: it becomes its environment's most recent, and the
// active environment follows it.
export function planFocused(state, id) {
  if (!id) return state;
  const next = id in state.assign ? touch(state, id) : assign(state, id, state.active);
  return { ...next, active: next.assign[id] };
}

// Spaces the sidebar shows, in `order`: the active environment's, and the
// focused Space wherever it belongs.
export function visible(state, order, focusedId) {
  return order.filter((id) => (state.assign[id] ?? DEFAULT_ENV) === state.active || id === focusedId);
}

// --- The mod ------------------------------------------------------------------

export const KEY = "spaces-env";
// The Spaces tree publishes every Space id in its display order.
const ORDER = "spaces-tree.order";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);
const PILL_GAP = 2; // px between the labels
const PILL_SPRING = { response: 220, damping: 0.9 }; // the highlight's slide

export default class SpacesEnv extends View {
  init(_props, cx) {
    this.started = false;
    this.focus = null;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try { this.command(command); } catch (e) { notify({ title: "spaces-env", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      }
    });
  }

  // Spaces in the sidebar's order (the tree nests worktrees under their repo).
  order() {
    const live = spaces().map((s) => s.id);
    const tree = shared(ORDER);
    if (!Array.isArray(tree)) return live;
    const set = new Set(live);
    return [...tree.filter((id) => set.has(id)), ...live.filter((id) => !tree.includes(id))];
  }

  // Fold live Spaces and focus into the state; save it when it changed.
  sync() {
    let state = normalise(shared(KEY));
    const order = this.order();
    // A machine still loading lists no Spaces yet: forget only what a ready
    // machine no longer has.
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    const live = new Set(order);
    const gone = Object.keys(state.assign).filter((id) => !live.has(id) && ready.has(machineOf(id)));
    // Spaces already there when this starts default to Personal; later ones
    // join the environment you are in.
    ({ state } = reconcile(state, order, { gone, fresh: this.started ? state.active : DEFAULT_ENV }));
    if (order.length || ready.size) this.started = true;
    const current = spaces().find((s) => s.active)?.id ?? null;
    if (current && current !== this.focus) {
      state = planFocused(state, current);
      this.focus = current;
    }
    if (!same(state, normalise(shared(KEY)))) setShared(KEY, state);
    return { state, order, current };
  }

  select(id, state, label) {
    run("space.select", { id });
    const s = spaces().find((x) => x.id === id);
    if (label) notify({ title: `${label} · ${s?.name ?? id}`, level: "info", timeout: 2000 });
    this.focus = id;
    setShared(KEY, planFocused(state, id));
  }

  command(raw) {
    const [command, value] = [raw.split(":")[0], raw.slice(raw.indexOf(":") + 1)];
    const { state, order, current } = this.sync();
    const name = (id) => spaces().find((s) => s.id === id)?.name ?? id;
    if (command === "toggle") {
      const plan = planToggle(state, order, current);
      setShared(KEY, plan.state);
      if (!plan.target) return notify({ title: `${title(plan.dest)} has no Spaces`, body: "New Spaces will start there.", level: "info" });
      this.select(plan.target, plan.state, title(plan.dest));
    } else if (command === "send") {
      if (!current) return notify({ title: "No current Space to send", level: "warning" });
      const plan = planSend(state, order, current);
      setShared(KEY, plan.state);
      if (!plan.remaining) {
        return notify({ title: `Sent ${name(current)} to ${title(plan.dest)}`, body: `${title(plan.src)} is empty.`, level: "info" });
      }
      notify({ title: `Sent ${name(current)} to ${title(plan.dest)}`, level: "info", timeout: 2500 });
      this.select(plan.remaining, plan.state);
    } else if (command === "select" || command === "next" || command === "prev") {
      const shown = visible(state, order, current);
      if (!shown.length) return;
      const at = shown.indexOf(current);
      const index = command === "select" ? parseInt(value, 10) - 1
        : (Math.max(at, 0) + (command === "next" ? 1 : shown.length - 1)) % shown.length;
      if (shown[index]) this.select(shown[index], state);
    } else if (command === "assign") {
      const [id, env] = value.split("=");
      if (!id || !ENVS.includes(env)) throw new Error(`assign needs <space id>=personal|work, got ${value}`);
      setShared(KEY, { ...assign(state, id, env), active: state.active });
    } else if (command === "status") {
      const count = (env) => order.filter((id) => (state.assign[id] ?? DEFAULT_ENV) === env).length;
      notify({ title: `Active: ${title(state.active)}`, body: `Personal ${count("personal")} · Work ${count("work")}`, level: "info" });
    } else {
      notify({ title: `spaces-env: unknown command ${raw}`, level: "warning" });
    }
  }

  render() {
    const t = theme();
    const { state } = this.sync();
    const widths = this.widths ?? {}; // px at zoom 1, from on_size_change
    const measured = ENVS.every((env) => widths[env] > 0);
    const left = ENVS.slice(0, ENVS.indexOf(state.active)).reduce((x, env) => x + widths[env] + PILL_GAP, 0);
    const pill = (env) => div()
      .id(`env-${env}`)
      .px(7)
      .h(18)
      .flex()
      .items_center()
      .rounded(5)
      .when(env === state.active, (el) => el.text_color(t.foreground))
      .when(!measured && env === state.active, (el) => el.bg(t.selected))
      .on_size_change((size, cx) => {
        const width = size.width / (settings().zoom ?? 1);
        if (Math.abs((this.widths?.[env] ?? 0) - width) < 0.5) return;
        this.widths = { ...this.widths, [env]: width };
        cx.notify();
      })
      .child(title(env));
    return h_flex()
      .id("spaces-env")
      .size_full()
      .px(8)
      .gap(2)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.dim)
      .cursor_pointer()
      .tooltip(`Toggle to ${title(other(state.active))} (C-a ;), send this Space there (C-a :)`)
      .on_click(() => this.command("toggle"))
      .child(h_flex()
        .relative()
        .gap(PILL_GAP)
        .items_center()
        .when(measured, (el) => el.child(div().id("env-highlight").absolute().top(0).h(18).rounded(5).bg(t.selected)
          .left(left).w(widths[state.active]).spring("left", PILL_SPRING).spring("width", PILL_SPRING)))
        .children(ENVS.map(pill)));
  }
}
