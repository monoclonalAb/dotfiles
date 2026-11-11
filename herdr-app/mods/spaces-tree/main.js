// Spaces tree: repositories, their worktree Spaces, and the conversations in
// each, in one sidebar. A copy of Herdr's shipped `spaces` mod (0.1.12) with what
// the patched terminal Herdr's Spaces tree and its plugins added:
//
// - Only the active Personal/Work environment's Spaces show, plus the focused
//   one (shared "spaces-env", kept by the spaces-env mod in the status bar).
// - Each Space lists its conversations with the next-agent dot: ◆ blocked,
//   ● finished and not reviewed, ◐ working, ○ idle (shared "next-agent.dots").
//   Click a Space's counts to fold its conversations, a repository's chevron to
//   fold its worktrees.
// - A linked worktree whose branch has a GitHub pull request shows as
//   "#123 title" with its state (gh pr view in the checkout; open green, draft
//   grey, merged purple, closed red).
// - spaces-tree.move-up / .move-down reorder a linked worktree among its
//   repository's (no key since C-a K / C-a J became pane resizing; bind one in
//   keys.json); dragging a row still works.
// - Motion, all native (no timers): the highlight of the shown Space and the
//   focused conversation fades from the old row to the new one; folding slides
//   rows shut and open; new rows (a new Space or conversation, the other
//   environment's Spaces) open in; a changed dot fades in.
// - No coloured letter avatars: a repository or plain Space shows its name alone.
// - Every Space row names its branch, main and master included, so a checkout
//   left on another branch is plain to see.
//
// Publishes shared "spaces-tree.order" (every Space in tree order) and
// "spaces-tree.agents" (shown conversations in tree order), and sets the
// agent.next / agent.prev order to the conversations it shows.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, openOverlay, exec, hc, theme, shared, setShared, setAgentOrder, watchFolder, window, layout, nextCommand, notify, appHome, readTextFile, writeTextFile } from "herdr";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------
// Pure helpers for the tree below: pull-request lookups (the rules of
// herdr/plugins/pr-status/pr_status.py), conversation titles, worktree moves.

// How long a pull-request lookup stays fresh: the shown Space, other Spaces,
// and Spaces whose pull request is merged or closed.
export const PR_TTL = { current: 30_000, other: 300_000, final: 1_800_000 };
export const PR_STATES = ["open", "draft", "merged", "closed"];

// `gh pr view --json number,title,state,isDraft` output, as { number, title, state } or null.
export function prFromGh(data) {
  if (!data || typeof data !== "object") return null;
  let state = { MERGED: "merged", CLOSED: "closed", OPEN: "open" }[data.state];
  if (state === "open" && data.isDraft === true) state = "draft";
  const number = data.number;
  if (!Number.isInteger(number) || number <= 0 || !PR_STATES.includes(state)) return null;
  return { number, title: typeof data.title === "string" ? data.title : "", state };
}

// One `gh pr view` run: found (with pr), none (no pull request for the branch),
// or error (offline, signed out, not GitHub: keep the last result).
export function ghOutcome({ code, stdout = "", stderr = "" }) {
  if (code === 0) {
    let pr = null;
    try { pr = prFromGh(JSON.parse(stdout)); } catch { /* fall through */ }
    return pr ? { outcome: "found", pr } : { outcome: "error", detail: "unexpected gh output" };
  }
  const message = (stderr || stdout).trim();
  if (message.startsWith("no pull requests found")) return { outcome: "none", pr: null };
  return { outcome: "error", detail: message.split("\n")[0] || `gh exited ${code}` };
}

// The cache entry for a Space, dropped when its checkout or branch changed
// (the old pull request belonged to another branch).
export function currentEntry(entry, checkout, branch) {
  if (!entry || entry.checkout !== checkout || entry.branch !== branch) return { checkout, branch, pr: null, at: 0 };
  return entry;
}

export function prDue(entry, isCurrent, now) {
  const ttl = isCurrent ? PR_TTL.current : ["merged", "closed"].includes(entry.pr?.state) ? PR_TTL.final : PR_TTL.other;
  return now - (entry.at ?? 0) >= ttl;
}

export function applyOutcome(entry, result, now) {
  if (result.outcome === "error") return { ...entry, at: now, error: result.detail };
  return { checkout: entry.checkout, branch: entry.branch, pr: result.pr ?? null, at: now };
}

// A terminal title without the program's leading mark ("π - repo", "π > task").
export function stripTitle(title) {
  return (title ?? "").trim()
    // The mark: π, ω or a spinner/symbol run, but not a path's . ~ or /.
    .replace(/^(?:[πω]|[^\p{L}\p{N}\s.~/])+\s*/u, "")
    // Then the separator after it.
    .replace(/^[-–—>:|·]+\s*/u, "")
    .trim();
}

// What a conversation row says: Pi's task summary (the herdr-task-summary
// extension's label), else the agent's own title when it tells more than its
// folder, else a named tab, else the program.
export function conversationTitle({ summary, pending, title, address, cwd, spaceName, tabName, tabNamed, program }) {
  if (summary) return { text: summary, strong: true };
  const stripped = stripTitle(title);
  const folder = base(cwd ?? "");
  const telling = stripped && stripped !== folder && stripped !== spaceName && stripped !== address && !/^[~/]/.test(stripped)
    && stripped.toLowerCase() !== (program ?? "").toLowerCase();
  if (telling) return { text: stripped, strong: true };
  if (pending) return { text: "Naming…", strong: false };
  if (tabNamed && tabName) return { text: tabName, strong: false };
  return { text: program || "agent", strong: false };
}

// What a Space row says after its name: its repository, unless the name says
// it or the row sits under it; then its branch, unless the name or the pull
// request says it (a worktree is named after its branch). main and master show
// too: a main checkout left on another branch should be plain to see.
export function gitWhere(g, { tree = false, name = "", pr = null } = {}) {
  const same = (a) => a.toLowerCase() === name.toLowerCase();
  const branch = g.branch ?? "detached";
  return { repo: tree || same(g.name) ? "" : g.name, branch: pr || same(branch) ? "" : branch };
}

// Moving a linked worktree up or down among its repository's worktrees in the
// tree. `rows`: the shown rows in order, { id, repo, nested }. Returns the id of
// the neighbour to take the place of, or a message.
export function worktreeMove(rows, id, direction) {
  const me = rows.find((r) => r.id === id);
  if (!me?.nested) return { message: "Only a linked worktree moves, within its repository" };
  const siblings = rows.filter((r) => r.nested && r.repo === me.repo);
  const at = siblings.indexOf(me);
  const next = siblings[at + (direction === "up" ? -1 : 1)];
  if (!next) return { message: direction === "up" ? "Already the first worktree" : "Already the last worktree" };
  return { neighbour: next.id };
}

// --- The mod ------------------------------------------------------------------

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// Motion. The app animates only a change of target, so a row drawn for the
// first time is drawn shut and opened by a render FRAME ms later.
const SLIDE = { duration: 170, easing: "ease-out" }; // rows opening and shutting
const FADE = 150; // highlights and dots
const FRAME = 32; // long enough for one frame to be drawn in between

// The next-agent dots, as the terminal Herdr sidebar drew them.
const GLYPH = { blocked: "\u25c6", review: "\u25cf", working: "\u25d0", idle: "\u25cb" };
const SPIN = ["\u25d0", "\u25d3", "\u25d1", "\u25d2"];
const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };
const RANK = { blocked: 4, review: 3, working: 2, idle: 1 };
// Without the next-agent mod: the app's own status.
const fallbackDot = (status) => (status === "blocked" ? "blocked" : status === "done" ? "review" : status === "working" ? "working" : "idle");
const PR_TONE = { open: "ansi2", draft: "dim", merged: "accent", closed: "ansi1" };

// GitHub's pull-request state icons (Lucide). svg() only loads files inside the
// app's folder and this mod's files are links into the dotfiles repository, so
// init writes them there as hidden files (hidden files do not reload the mod).
const PR_ICONS = {
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>',
  draft: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><path d="M6 9v12"/></svg>',
  merged: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>',
  closed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/></svg>',
};
const prIcon = (state) => `mods/spaces-tree/.pr-${state}.svg`;
// The eric layout's preview in Settings (its "preview" names this file), for the same reason.
const LAYOUT_PREVIEW = { path: "mods/spaces-tree/.layout-preview.svg", text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
  <rect width="320" height="200" rx="8" fill="#dce0e8"/>
  <rect x="30" y="8" width="32" height="10" rx="4" fill="#ccd0da"/><rect x="66" y="8" width="32" height="10" rx="4" fill="#e6e9ef"/>
  <rect x="8" y="26" width="118" height="166" rx="6" fill="#eff1f5" stroke="#8839ef" stroke-width="2"/>
  <rect x="132" y="26" width="94" height="166" rx="6" fill="#eff1f5" stroke="#ccd0da"/>
  <rect x="133" y="27" width="92" height="12" rx="5" fill="#d20f39" opacity=".18"/>
  <rect x="232" y="26" width="80" height="166" rx="6" fill="#e6e9ef" stroke="#ccd0da"/>
  <g fill="#4c4f69" transform="translate(230 16)">
    <rect x="10" y="22" width="9" height="9" rx="2" fill="#8839ef"/><rect x="24" y="24" width="40" height="5" rx="2"/>
    <rect x="22" y="38" width="5" height="5" rx="2.5" fill="#d20f39"/><rect x="32" y="38" width="42" height="5" rx="2" opacity=".7"/>
    <rect x="22" y="50" width="5" height="5" rx="2.5" fill="#fe640b"/><rect x="32" y="50" width="36" height="5" rx="2" opacity=".7"/>
    <rect x="20" y="64" width="44" height="5" rx="2"/>
    <rect x="30" y="76" width="5" height="5" rx="2.5" fill="#1e66f5"/><rect x="40" y="76" width="34" height="5" rx="2" opacity=".7"/>
    <rect x="10" y="92" width="9" height="9" rx="2" fill="#40a02b"/><rect x="24" y="94" width="36" height="5" rx="2"/>
  </g>
</svg>` };

export function glyph(status) {
  return status === "blocked" || status === "done" ? "\u25cf" : "\u00b7";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class SpacesTree extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedSpaces = new Set(JSON.parse(localStorage.getItem("folded.spaces") ?? "[]"));
    this.foldedRepos = new Set(JSON.parse(localStorage.getItem("folded.repos") ?? "[]"));
    this.prs = JSON.parse(localStorage.getItem("prs") ?? "{}"); // space id -> { checkout, branch, pr, at }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.timer.every(10000, (cx) => this.refreshPrs(cx));
    this.icons = false;
    cx.spawn(async (cx) => {
      try {
        const assets = [...Object.entries(PR_ICONS).map(([state, text]) => ({ path: prIcon(state), text })), LAYOUT_PREVIEW];
        for (const { path, text } of assets) {
          const current = await readTextFile(`${appHome()}/${path}`);
          if (current !== text) await writeTextFile(`${appHome()}/${path}`, text, current);
        }
        this.icons = true;
      } catch { /* the branch icon stands in */ }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "move-up" || command === "move-down") this.move(command.slice(5));
        else notify({ title: `spaces-tree: unknown command ${command}`, level: "warning" });
        cx.notify();
      }
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      if (info.branch === "(detached)") info.branch = null;
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // Linked worktrees' pull requests, at most four lookups per tick. Spaces off
  // screen wait until the window is in front again, except a first look.
  refreshPrs(cx) {
    if (this.prBusy) return;
    const now = Date.now();
    const sp = spaces();
    const ps = panes();
    const due = [];
    const kept = {};
    for (const s of sp) {
      const g = this.git[where(s, ps)];
      if (!g?.linked || !g.branch) continue;
      const entry = currentEntry(this.prs[s.id], place(s, ps), g.branch);
      kept[s.id] = entry;
      if ((window().active || !entry.at) && prDue(entry, s.active, now)) due.push({ s, cwd: entry.checkout });
    }
    // A Space whose machine is still loading keeps its entry; a closed one goes.
    const ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name ?? null));
    for (const [id, entry] of Object.entries(this.prs)) {
      if (!(id in kept) && !sp.some((s) => s.id === id) && !ready.has(id.includes("/") ? id.split("/")[0] : null)) kept[id] = entry;
    }
    if (!same(Object.keys(kept), Object.keys(this.prs))) localStorage.setItem("prs", JSON.stringify(kept));
    this.prs = kept;
    if (!due.length) return;
    this.prBusy = true;
    cx.spawn(async (cx) => {
      for (const { s, cwd } of due.slice(0, 4)) {
        let result;
        try {
          result = ghOutcome(await exec("gh", ["pr", "view", "--json", "number,title,state,isDraft"], { cwd, on: s.machine }));
        } catch (e) {
          result = { outcome: "error", detail: String(e?.message ?? e) };
        }
        if (this.prs[s.id]?.checkout === cwd) this.prs[s.id] = applyOutcome(this.prs[s.id], result, Date.now());
      }
      localStorage.setItem("prs", JSON.stringify(this.prs));
      this.prBusy = false;
      cx.notify();
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  // `full`: every Space; `shown`: the active environment's and the focused one,
  // without the worktrees of folded repositories.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const env = shared("spaces-env");
    const inEnv = (r) => !env?.assign || (env.assign[r.w.id] ?? "personal") === (env.active ?? "personal") || r.w.active;
    return { full: this.nest(list, false), shown: this.nest(list.filter(inEnv), true) };
  }

  nest(list, folding) {
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      const head = { ...r, tree: null, kids: 0 };
      out.push(head);
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      head.kids = kids.length;
      // A folded repository's worktrees stay in the list, hidden, so folding
      // can slide them shut; what counts what is shown leaves them out.
      const hidden = folding && this.foldedRepos.has(r.g.repo) && !kids.some((k) => k.w.active);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "\u2514\u2500" : "\u251c\u2500", kids: 0, hidden }));
    }
    return out;
  }

  move(direction) {
    const shown = this.ordered().shown.filter((r) => !r.hidden);
    const current = spaces().find((s) => s.active);
    const plan = worktreeMove(shown.map((r) => ({ id: r.w.id, repo: r.g?.repo, nested: Boolean(r.tree) })), current?.id, direction);
    if (plan.message) return notify({ title: plan.message, level: "info", timeout: 2000 });
    const to = spaces().findIndex((s) => s.id === plan.neighbour);
    run("space.move", { id: current.id, index: to + 1 });
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed, rows) {
    // The active Space and its conversations share one highlighted card, so two
    // separate rounded highlights never touch (they left notches where they met).
    // Every Space has its card, so the highlight can fade from one to the next.
    const draw = (r) => {
      if (collapsed) return [this.compact(r, t)];
      return [v_flex().id(`space-card-${r.w.id}`).flex_none().relative()
        .child(this.tint(`space-tint-${r.w.id}`, t.selected, r.w.active && !r.hidden))
        .child(this.row(r, t)).children(this.conversations(r, t))];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "\u2026" : "Loading\u2026");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt \u00b7"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting\u2026" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      if (!collapsed && rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // After the name: "dotfiles \u00b7 main \u21912 \u21931" (gitWhere). Short of room, the
  // repository truncates first, so the branch stays readable.
  gitTail(g, tree, name, t, pr) {
    const { repo, branch } = gitWhere(g, { tree, name, pr });
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(repo), (el) => el.child(div().min_w(0).flex_shrink(100).truncate().child(repo)))
      .when(Boolean(repo && branch), (el) => el.child(div().flex_none().child("\u00b7")))
      .when(Boolean(branch), (el) => el.child(div().min_w(0).truncate().child(branch)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  // A conversation's dot: the next-agent ledger's, else the app's own status.
  dotOf(a) {
    return (shared("next-agent.dots") ?? {})[a.address] ?? fallbackDot(a.status);
  }

  // A dot; one that changed (`key`: its row) fades in.
  mark(t, d, key) {
    const id = `mark-${key}-${d}`;
    const el = div().id(id).w(12).flex_none().text_size(11).text_color(t[TONE[d]] ?? t.dim)
      .opacity(this.isNew(id) ? 0 : 1).transition("opacity", FADE);
    return d === "working" ? el.frames(SPIN, 180) : el.child(GLYPH[d]);
  }

  // Whether `key` is new: drawn by this render but not the last. Nothing is new
  // on the first render: the sidebar just appears.
  isNew(key) {
    this.drawn.add(key);
    const fresh = this.before !== null && !this.before.has(key);
    if (fresh) this.fresh = true;
    return fresh;
  }

  // `el` as a row `height` px tall that slides open and shut: shut (no height,
  // transparent) while `open` is false and on the render that first draws it.
  grow(el, key, height, open) {
    const shown = !this.isNew(key) && open;
    return el.id(key).h(shown ? height : 0).opacity(shown ? 1 : 0).overflow_hidden()
      .transition("height", SLIDE).transition("opacity", SLIDE);
  }

  // A highlight that fades in and out rather than switching: the first child of
  // a row, filling it behind the rest.
  tint(key, color, on, radius = 8) {
    return div().id(key).absolute().top(0).left(0).size_full().rounded(radius).bg(color)
      .opacity(on ? 1 : 0).transition("opacity", FADE);
  }

  agentsOf(w) {
    return (this.agentList ?? agents()).filter((a) => a.space === w.id);
  }

  // A Space's conversations (and their helpers); shut while folded, so folding
  // slides them away.
  conversations({ w, tree, hidden }, t) {
    const open = !hidden && !this.foldedSpaces.has(w.id);
    const list = this.agentsOf(w);
    if (!list.length) return [];
    const ps = this.paneList ?? panes();
    const all = this.terminalList ?? terminals();
    const byAddress = new Map(all.map((x) => [x.address, x]));
    const indent = tree ? 44 : 22;
    const several = (w.tabs ?? []).length > 1;
    return list.flatMap((a) => {
      const term = byAddress.get(a.address);
      const tab = (w.tabs ?? []).find((x) => x.id === a.tab);
      const pane = ps.find((p) => p.pane === a.pane);
      const { text, strong } = conversationTitle({
        summary: term?.labels?.task_summary, pending: term?.labels?.task_summary_pending === "1",
        title: a.title, address: a.address, cwd: pane?.cwd, spaceName: w.name, tabName: tab?.name, tabNamed: tab?.named, program: a.program?.name,
      });
      const d = this.dotOf(a);
      const row = this.grow(h_flex(), `conv-${a.address}`, 24, open)
        .flex_none()
        .relative()
        .pl(indent)
        .pr(8)
        .gap(7)
        .items_center()
        .rounded(8)
        .text_size(12.5)
        .cursor_pointer()
        // Inside the active Space's card (already `selected`): one step stronger.
        .child(this.tint(`conv-tint-${a.address}`, t.input, a.focused))
        .when(!a.focused, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(this.mark(t, d, a.address))
        .child(div().flex_1().min_w(0).truncate().text_color(strong || d === "blocked" || d === "review" ? t.foreground : t.muted).child(text))
        .when(several && Boolean(tab), (el) => el.child(div().flex_none().max_w(70).truncate().text_size(11).text_color(t.dim).child(tab.name)));
      const kids = all.filter((k) => k.parent === a.address && k.state === "live");
      return [row, ...kids.map((k) => this.grow(h_flex(), `sub-${k.address}`, 22, open)
        .flex_none()
        .pl(indent + 19)
        .pr(8)
        .gap(6)
        .items_center()
        .rounded(7)
        .text_size(12)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => run("terminal.peek", { terminal: k.address }))
        .child(this.mark(t, fallbackDot(k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status), k.address))
        .child(div().flex_1().min_w(0).truncate().child(k.name || k.template || k.program?.name || k.address)))];
    });
  }

  // After a Space's name: its conversations' counts (click: fold them).
  counts(w, t) {
    const list = this.agentsOf(w);
    if (!list.length) return null;
    const dots = list.map((a) => this.dotOf(a));
    const folded = this.foldedSpaces.has(w.id);
    const blocked = dots.filter((d) => d === "blocked").length;
    const review = dots.filter((d) => d === "review").length;
    const top = dots.reduce((m, d) => (RANK[d] > RANK[m] ? d : m), "idle");
    return h_flex()
      .id(`fold-${w.id}`)
      .flex_none()
      .h(18)
      .px(4)
      .gap(4)
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(folded ? "Show conversations" : "Hide conversations")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        folded ? this.foldedSpaces.delete(w.id) : this.foldedSpaces.add(w.id);
        localStorage.setItem("folded.spaces", JSON.stringify([...this.foldedSpaces]));
        cx.notify();
      })
      .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child(`${GLYPH.blocked}${blocked}`)))
      .when(review > 0, (el) => el.child(div().text_color(t.done).child(`${GLYPH.review}${review}`)))
      .when(folded && !blocked && !review, (el) => el.child(div().text_color(t[TONE[top]]).child(`${GLYPH[top]}${list.length}`)));
  }

  // A repository's fold chevron, on its main checkout's row.
  repoFold(r, t) {
    const repo = r.g?.repo;
    const folded = this.foldedRepos.has(repo);
    return div()
      .id(`repo-fold-${r.w.id}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(folded ? `Show ${r.kids} worktree${r.kids === 1 ? "" : "s"}` : "Hide worktrees")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        folded ? this.foldedRepos.delete(repo) : this.foldedRepos.add(repo);
        localStorage.setItem("folded.repos", JSON.stringify([...this.foldedRepos]));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11));
  }

  // A Space's row. Its highlight is its card's (grouped).
  row(r, t) {
    const { w, i, g, tree } = r;
    const on = w.active;
    const pr = g?.linked ? this.prs[w.id]?.pr : null;
    const name = pr ? `#${pr.number} ${pr.title}` : w.name;
    return this.grow(v_flex(), `space-${w.id}`, rowHeight({ tree }), !r.hidden)
      .relative()
      .px(8)
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(this.pressed < i, line => line.bottom(0))
          .when(this.pressed > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === i && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else if (from === i) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(14).child(pr
            ? svg(this.icons ? prIcon(pr.state) : "mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t[PR_TONE[pr.state]] ?? t.dim)
            : svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .child(div().flex_shrink(0).max_w(pr ? 170 : 150).truncate().text_color(t.foreground).child(name))
          .child(g ? this.gitTail(g, tree, w.name, t, pr) : div().flex_1())
          .when(r.kids > 0, (el) => el.child(this.repoFold(r, t)))
          .when(Boolean(this.counts(w, t)), (el) => el.child(this.counts(w, t))),
      );
  }

  compact({ w, i, hidden }, t) {
    const dots = this.agentsOf(w).map((a) => this.dotOf(a));
    const top = dots.reduce((m, d) => (RANK[d] > RANK[m] ? d : m), null);
    return this.grow(h_flex(), `space-${w.id}`, 26, !hidden)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(top ? t[TONE[top]] : t.dim).child(top === "blocked" || top === "review" ? GLYPH[top] : "\u00b7"));
  }

  render(cx) {
    const t = theme();
    const collapsed = narrow();
    // What this render draws, against the last (isNew).
    this.before = this.drawn ?? null;
    this.drawn = new Set();
    this.fresh = false;
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);

    // One read of each live list per render.
    this.agentList = agents();
    this.paneList = panes();
    this.terminalList = terminals();
    const { full, shown } = this.ordered();
    const order = full.map((r) => r.w.id);
    if (!same(order, shared("spaces-tree.order"))) setShared("spaces-tree.order", order);
    // Every conversation of the shown Spaces, folded or not, in tree order
    // (not those of a folded repository's worktrees).
    const conversations = shown.filter((r) => !r.hidden).flatMap((r) => this.agentsOf(r.w).map((a) => a.address));
    setAgentOrder(conversations);
    if (!same(conversations, shared("spaces-tree.agents"))) setShared("spaces-tree.agents", conversations);

    const env = shared("spaces-env")?.active;
    const heading = env ? env[0].toUpperCase() + env.slice(1) : "Spaces";
    const rows = this.grouped(t, collapsed, shown);
    // Rows drawn shut this time open on the next render.
    if (this.fresh && !this.opening) {
      this.opening = true;
      cx.timer.after(FRAME, (cx) => {
        this.opening = false;
        cx.notify();
      });
    }
    // No buttons in the heading: new Spaces are C-a s or Cmd+N.
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).flex_none().pl(16).pr(10).items_center().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child(heading)))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(rows))
      .when(collapsed, (el) => el.child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("unfold").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("\u00bb"))));
  }
}
