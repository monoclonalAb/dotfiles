// Brief: a view for the right-hand panel, beside Files (C-a i, handled by
// pane-keys). For the shown Space it answers "what is this agent's
// conversation about, what did I last ask, and where is the work?".
// Example, the fix-login Space:
//
//   1. 10:06: Pi starts on "Why does login spin forever after a 401?". At
//      10:40 you add "Also show the error message instead."
//   2. 11:30: C-a u lands there and C-a i opens Brief. It shows:
//      - Conversation: the dot and title, "1h 24m", and "Fixing the login
//        page's endless spinner after a 401; now showing the error message
//        instead." (the herdr-task-summary extension's task_brief label).
//      - Last prompt: "Also show the error message instead.", "50m ago".
//      - Branch: "fix-login ↗" (opens it on GitHub), "3 commits since main",
//        "7 files · +142 −38", "2 files not committed".
//      - Pull request: "#482 Fix login spinner ↗", "Open · Changes requested",
//        "Checks ✓ 5 ✗ 1 ◌ 1" and the failing check (each opens in the browser).
//
// - The agent: the focused pane's, else the first in the focused tab, else the
//   first in the Space.
// - The last prompt: the last user message of its Pi conversation file
//   (pi.session label, from the herdr-app-resume extension), read backwards
//   with jq, which stops at that message (conversations are often larger than
//   the app's 1 MiB readTextFile). Other agents (OMP) show their title only.
// - The branch counts start where herdr-review --branch starts (C-a V): the
//   newest fork point from the local and remote default branch. The branch
//   links to its upstream on the remote's website, once pushed.
// - The pull request is `gh pr view` in the checkout; never on the default
//   branch or a detached HEAD.
// - While Brief shows, git and the conversation file are read every 15 s and
//   GitHub at most once a minute. Hidden, it reads nothing.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, focused, exec, theme, shared, layout } from "herdr";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------

// The next-agent dots, as the Spaces tree draws them.
export const GLYPH = { blocked: "\u25c6", review: "\u25cf", working: "\u25d0", idle: "\u25cb" };
const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };
// Without the next-agent mod: the app's own status.
export const fallbackDot = (status) => (status === "blocked" ? "blocked" : status === "done" ? "review" : status === "working" ? "working" : "idle");

// Which agent the brief is about. `list`: agents(); `f`: focused().
export function pickAgent(list, f) {
  if (!f) return null;
  const mine = list.filter((a) => a.space === f.space);
  return mine.find((a) => f.pane && a.pane === f.pane)
    ?? mine.find((a) => f.terminal && a.address === f.terminal)
    ?? mine.find((a) => a.tab === f.tab)
    ?? mine[0] ?? null;
}

// A terminal title without the program's leading mark ("π - repo", "π > task"),
// as the Spaces tree strips it.
export function stripTitle(title) {
  return (title ?? "").trim()
    .replace(/^(?:[πω]|[^\p{L}\p{N}\s.~/])+\s*/u, "")
    .replace(/^[-–—>:|·]+\s*/u, "")
    .trim();
}

// Pi's task summary (the herdr-task-summary extension's label), else the
// agent's own title, else its program.
export function agentTitle({ summary, title, program }) {
  return summary || stripTitle(title) || program || "agent";
}

// A message's text: a string, or the text blocks of a list (images left out).
const TEXT_JQ = 'if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join("\\n")) end | .[0:4000]';

// jq over a Pi conversation file read backwards (raw lines; an unparseable one,
// such as a line still being written, is skipped): the last user message as
// {"last": {at, text}}, at most 4000 characters. Stops at that message.
export const LAST_JQ = `first(inputs | fromjson? | select(.type == "message" and .message.role == "user")) | {last: {at: (.timestamp // null), text: (.message.content | ${TEXT_JQ})}}`;

// sh -c CONVERSATION_SH conversation <file> <LAST_JQ>: the header's start time,
// then the last user message (BSD `tail -r` reverses lines, GNU has `tac`).
// Both glue a last line still being written (no newline yet) to the line
// before it, so then that line comes first on its own and the glued one is
// skipped.
export const CONVERSATION_SH = [
  'f=$1',
  'head -n 1 "$f" | jq -c \'{started: (.timestamp // null)}\' 2>/dev/null',
  'reverse() { if tail -r /dev/null 2>/dev/null; then tail -r "$f"; else tac "$f"; fi; }',
  'if [ -n "$(tail -c 1 "$f")" ]; then { tail -n 2 "$f" | head -n 1; reverse | tail -n +2; }; else reverse; fi | jq -R -c -n "$2"',
].join("\n");

// CONVERSATION_SH's output as { started: ms | null, last: { at: ms | null, text } | null }.
export function parseConversation(stdout) {
  const out = { started: null, last: null };
  for (const line of (stdout ?? "").split("\n")) {
    let data;
    try { data = JSON.parse(line); } catch { continue; }
    if (!data || typeof data !== "object") continue;
    if ("started" in data) out.started = time(data.started);
    if (data.last && typeof data.last.text === "string" && data.last.text.trim()) {
      out.last = { at: time(data.last.at), text: data.last.text.trim() };
    }
  }
  return out;
}
const time = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};

// How long ago, shortly: "just now", "12m", "1h 24m", "2d 3h".
export function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

// The first lines of a long message, and whether anything was cut.
export const SHORT = { lines: 10, chars: 600 };
export function preview(text) {
  let short = text.split("\n").slice(0, SHORT.lines).join("\n");
  if (short.length > SHORT.chars) short = short.slice(0, SHORT.chars);
  short = short.trimEnd();
  const cut = short.length < text.trimEnd().length;
  return { short: cut ? `${short}…` : text, cut };
}

// Totals from the starting point to the disk: `git diff --numstat -z
// --no-renames` (binary files count no lines) plus the untracked files of
// `git status --porcelain -z`, which have no lines yet.
export function changeTotals(numstatOut, statusOut) {
  let files = 0, add = 0, del = 0;
  const known = new Set();
  for (const entry of (numstatOut ?? "").split("\0")) {
    const [a, d, ...path] = entry.split("\t");
    if (!path.length) continue;
    known.add(path.join("\t"));
    files += 1; add += Number(a) || 0; del += Number(d) || 0;
  }
  for (const entry of (statusOut ?? "").split("\0")) {
    if (entry.startsWith("?? ") && !known.has(entry.slice(3))) files += 1;
  }
  return { files, add, del };
}

// A git remote's web page: "https://github.com/owner/repo" from the https,
// ssh:// and git@host:owner/repo forms, or null (a local path, an ssh host
// alias without a dot). An alias like github.com-work means github.com.
export function webBase(remoteUrl) {
  const url = (remoteUrl ?? "").trim();
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url)
    ?? /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  const host = m[1].startsWith("github.com-") ? "github.com" : m[1];
  if (!host.includes(".") || !/^[\w.-]+\/[\w.-]+$/.test(m[2])) return null;
  return `https://${host}/${m[2]}`;
}

// A branch's page on that website.
export const branchUrl = (base, branch) => `${base}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the branch has done, from git. `git(args)` resolves { code, stdout } for
// a read-only git command in the checkout. The starting point is
// herdr-review --branch's: the newest merge-base of HEAD with the local and
// remote default branch (on the default branch, only its remote copy counts).
// `url`: the branch's upstream page, once it is on the remote.
export async function branchFacts(git) {
  const ok = async (args) => {
    const r = await git(args);
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const root = await ok(["rev-parse", "--show-toplevel"]);
  if (!root) return { error: "Not a git repository" };
  const branch = await ok(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  const untracked = status.code === 0 ? status.stdout : "";
  const dirty = status.code === 0 ? untracked.split("\0").filter(Boolean).length : null;
  const url = branch ? await upstreamUrl(git, ok, branch) : null;
  if (!(await ok(["rev-parse", "--verify", "--quiet", "HEAD"]))) return { root, branch, url, empty: true, dirty, ...changeTotals("", untracked) };

  const remoteHead = await ok(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  let main = remoteHead?.startsWith("origin/") ? remoteHead.slice("origin/".length) : null;
  for (const name of main ? [] : ["main", "master"]) {
    if (await ok(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) || await ok(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`])) { main = name; break; }
  }
  let base = null;
  for (const ref of main ? [`refs/heads/${main}`, `refs/remotes/origin/${main}`] : []) {
    if (ref === `refs/heads/${branch}` || !(await ok(["rev-parse", "--verify", "--quiet", ref]))) continue;
    const fork = await ok(["merge-base", "HEAD", ref]);
    if (fork && (base === null || (await git(["merge-base", "--is-ancestor", base, fork])).code === 0)) base = fork;
  }
  const onMain = branch !== null && branch === main;
  const commits = base ? Number(await ok(["rev-list", "--count", `${base}..HEAD`])) || 0 : null;
  // From the starting point to the files on disk: commits plus uncommitted edits.
  const diff = await git(["diff", "--numstat", "-z", "--no-renames", base ?? "HEAD"]);
  return { root, branch, url, main, base, onMain, commits, dirty, ...changeTotals(diff.code === 0 ? diff.stdout : "", untracked) };
}

// The branch's upstream (or origin/<branch>) on its remote's website, or null.
async function upstreamUrl(git, ok, branch) {
  let remote = null, name = null;
  const upstream = await ok(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const cut = upstream?.indexOf("/") ?? -1;
  if (cut > 0) { remote = upstream.slice(0, cut); name = upstream.slice(cut + 1); }
  else if (await ok(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`])) { remote = "origin"; name = branch; }
  if (!remote) return null;
  const base = webBase(await ok(["remote", "get-url", remote]));
  return base ? branchUrl(base, name) : null;
}

// branchFacts as the panel words it: { name, headline, stat, dirty }.
export function branchSummary(f) {
  if (f.error) return { name: null, headline: f.error, stat: null, dirty: null };
  const name = f.branch ?? "detached HEAD";
  if (f.empty) return { name, headline: "No commits yet", stat: null, dirty: f.dirty };
  let headline;
  if (f.onMain) headline = !f.base ? `No origin/${f.main} to compare with` : f.commits ? `${plural(f.commits, "commit")} not pushed` : "Nothing unpushed";
  else if (f.base) headline = f.commits ? `${plural(f.commits, "commit")} since ${f.main}` : `No commits since ${f.main} yet`;
  else headline = f.main ? `Shares no history with ${f.main}` : "No main branch to compare with";
  return { name, headline, stat: f.files ? { files: plural(f.files, "file"), add: f.add, del: f.del } : null, dirty: f.dirty };
}

// GitHub's checks, as gh pr checks buckets them (cancelled and stale runs count
// as skipped, not failed).
export function checkBucket(c) {
  if (c?.__typename === "StatusContext") return { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail" }[c.state] ?? "pending";
  if (c?.status !== "COMPLETED") return "pending";
  if (c.conclusion === "SUCCESS") return "pass";
  if (["SKIPPED", "NEUTRAL", "CANCELLED", "STALE"].includes(c.conclusion)) return "skip";
  return "fail";
}

// Each check once, its latest run (a re-run lists both), as gh pr checks counts.
export function latestChecks(list) {
  const latest = new Map();
  for (const c of list) {
    const key = c?.name || c?.context || "";
    const at = Date.parse(c?.startedAt ?? "") || 0;
    if (!latest.has(key) || at > latest.get(key).at) latest.set(key, { c, at });
  }
  return [...latest.values()].map((x) => x.c);
}

export const REVIEW = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" };
export const PR_FIELDS = "number,title,state,isDraft,url,reviewDecision,statusCheckRollup";

// `gh pr view --json PR_FIELDS` output as the panel needs it, or null.
export function prFacts(data) {
  if (!data || typeof data !== "object" || !Number.isInteger(data.number) || data.number <= 0) return null;
  let state = { OPEN: "open", MERGED: "merged", CLOSED: "closed" }[data.state];
  if (!state) return null;
  if (state === "open" && data.isDraft === true) state = "draft";
  const checks = { pass: 0, fail: 0, pending: 0, skip: 0 }, failing = [];
  for (const c of latestChecks(Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : [])) {
    const bucket = checkBucket(c);
    checks[bucket] += 1;
    if (bucket === "fail") failing.push({ name: c.name || c.context || "check", url: c.detailsUrl || c.targetUrl || null });
  }
  return {
    number: data.number, title: typeof data.title === "string" ? data.title : "", state,
    url: typeof data.url === "string" ? data.url : null, review: REVIEW[data.reviewDecision] ?? null, checks, failing,
  };
}

// One `gh pr view` run: found (with pr), none, or error (offline, signed out,
// not GitHub: the last result stays).
export function prOutcome({ code, stdout = "", stderr = "" }) {
  if (code === 0) {
    let pr = null;
    try { pr = prFacts(JSON.parse(stdout)); } catch { /* fall through */ }
    return pr ? { outcome: "found", pr } : { outcome: "error", detail: "unexpected gh output" };
  }
  const message = (stderr || stdout).trim();
  if (message.startsWith("no pull requests found")) return { outcome: "none", pr: null };
  return { outcome: "error", detail: message.split("\n")[0] || `gh exited ${code}` };
}

// --- The mod ------------------------------------------------------------------

// Reads write nothing under .git (no index refresh or lock, no fsmonitor
// cookie), as in the shipped Changes panel.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const EVERY = 15_000;
const PR_EVERY = 60_000;
const FAILING_SHOWN = 5;
const PR_TONE = { open: "ansi2", draft: "dim", merged: "accent", closed: "ansi1" };
const PR_WORD = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// In the right-hand panel, Brief works only while the panel is open on it;
// placed anywhere else (a pane, a float), always.
function showing() {
  const tree = layout(), body = find(tree, "panel-body");
  if (!body?.children?.some((c) => c.id === "brief")) return true;
  return !find(tree, "panel")?.hidden && body.active === "brief";
}

// What the brief is about now.
function target() {
  const f = focused(), space = spaces().find((s) => s.active) ?? null;
  const agent = pickAgent(agents(), f);
  const pane = panes().find((p) => p.pane === (agent?.pane ?? f?.pane));
  const cwd = pane?.cwd || f?.cwd || space?.folder || null;
  const on = space?.machine ?? null;
  const term = agent ? terminals().find((t) => t.address === agent.address) ?? null : null;
  return { space, agent, term, cwd, on, key: JSON.stringify([space?.id ?? null, agent?.address ?? null, cwd, on]) };
}

const prKey = (on, root, branch) => `${on ?? ""}\0${root}\0${branch}`;
const openUrl = (url, cx) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

export default class Brief extends View {
  init(_props, cx) {
    this.context = null;
    this.git = null; this.gitAt = 0; this.gitBusy = false;
    this.talk = new Map(); // conversation file -> { at, started, last } | { at, error }
    this.talkBusy = false;
    this.prs = new Map(); // prKey -> { at, pr, found, error }
    this.prBusy = false;
    this.expanded = false;
    this.status = null;
    // Read git and the conversation again (GitHub when due) and redraw the ages.
    cx.timer.every(EVERY, (cx) => {
      if (!showing()) return;
      this.gitAt = 0;
      for (const entry of this.talk.values()) entry.at = 0;
      cx.notify();
    });
  }

  loadGit(t, cx) {
    const context = this.context, { cwd, on } = t;
    if (!cwd) { this.git = { error: "No folder" }; this.gitAt = Date.now(); return; }
    this.gitBusy = true;
    cx.spawn(async (cx) => {
      try {
        const facts = await branchFacts((args) => exec("git", [...READ, ...args], { cwd, on }));
        if (this.context !== context) return;
        this.git = { ...facts, on };
        this.loadPr(this.git, cx);
      } catch (e) {
        if (this.context === context) this.git = { error: `git: ${e?.message ?? e}` };
      } finally {
        this.gitBusy = false;
        if (this.context === context) this.gitAt = Date.now();
        cx.notify();
      }
    });
  }

  loadPr(g, cx) {
    if (!g.root || !g.branch || g.onMain || g.empty || this.prBusy) return;
    const id = prKey(g.on, g.root, g.branch);
    if (Date.now() - (this.prs.get(id)?.at ?? 0) < PR_EVERY) return;
    this.prBusy = true;
    cx.spawn(async (cx) => {
      let result;
      try { result = prOutcome(await exec("gh", ["pr", "view", "--json", PR_FIELDS], { cwd: g.root, on: g.on })); }
      catch (e) { result = { outcome: "error", detail: String(e?.message ?? e) }; }
      const old = this.prs.get(id);
      this.prs.set(id, result.outcome === "error" ? { pr: old?.pr ?? null, found: old?.found ?? false, at: Date.now(), error: result.detail } : { pr: result.pr, found: true, at: Date.now() });
      this.prBusy = false;
      cx.notify();
    });
  }

  // The conversation's start and last prompt; read again every 15 s and
  // whenever the agent's status changes (a new prompt sets it working).
  loadConversation(t, cx) {
    const file = t.term?.labels?.["pi.session"];
    if (!file || this.talkBusy) return;
    const cached = this.talk.get(file);
    if (cached && Date.now() - cached.at < EVERY) return;
    this.talkBusy = true;
    cx.spawn(async (cx) => {
      let read;
      try {
        const r = await exec("sh", ["-c", CONVERSATION_SH, "conversation", file, LAST_JQ], { on: t.on });
        const parsed = parseConversation(r.stdout);
        read = parsed.started || parsed.last ? parsed : { error: (r.stderr || "").trim().split("\n")[0] || "Cannot read the conversation file" };
      } catch (e) { read = { error: `jq: ${e?.message ?? e}` }; }
      const old = this.talk.get(file);
      if (old?.last?.text !== read.last?.text) this.expanded = false;
      this.talk.set(file, { ...read, at: Date.now() });
      this.talkBusy = false;
      cx.notify();
    });
  }

  render(cx) {
    const t = target();
    if (showing()) {
      if (t.key !== this.context) { this.context = t.key; this.git = null; this.gitAt = 0; this.expanded = false; }
      if (t.agent?.status !== this.status) {
        this.status = t.agent?.status ?? null;
        const file = t.term?.labels?.["pi.session"];
        if (file && this.talk.has(file)) this.talk.get(file).at = 0;
      }
      if (!this.gitAt && !this.gitBusy) this.loadGit(t, cx);
      this.loadConversation(t, cx);
    }
    const th = theme();
    const g = this.git;
    const withPr = Boolean(g?.root && g.branch && !g.onMain && !g.empty);
    const sections = [this.conversationSection(t, th), this.lastPromptSection(t, th), this.branchSection(th), withPr ? this.prSection(th) : null];
    return v_flex().id("brief").size_full().min_h(0).rounded(10).overflow_hidden().bg(th.background).border_1().border_color(th.border).text_color(th.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(th.border)
        .child(div().flex_none().font_semibold().child("Brief"))
        .when(Boolean(t.space?.name), (e) => e.child(div().min_w(0).truncate().px(5).py(1).rounded(4).border_1().border_color(th.border).text_size(10).text_color(th.muted).child(t.space.name))))
      .child(v_flex().id("brief-body").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(12).gap(20).children(sections.filter(Boolean)));
  }

  // The dot, title and age, and the extension's summary of the whole conversation.
  conversationSection({ agent, term }, th) {
    if (!agent) return v_flex().gap(6).children([heading(th, "CONVERSATION"), note(th, "No agent in this Space")]);
    const file = term?.labels?.["pi.session"];
    const read = file ? this.talk.get(file) : null;
    const since = read?.started ? ago(Date.now() - read.started) : "";
    const rows = [heading(th, "CONVERSATION", null, since)];
    const dot = shared("next-agent.dots")?.[agent.address] ?? fallbackDot(agent.status);
    const title = agentTitle({ summary: term?.labels?.task_summary, title: agent.title, program: agent.program?.name });
    rows.push(h_flex().gap(8).items_center().min_w(0)
      .child(div().flex_none().text_color(th[TONE[dot]] ?? th.dim).child(GLYPH[dot] ?? GLYPH.idle))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(title)));
    const labels = term?.labels ?? {};
    if (labels.task_brief) rows.push(div().text_size(12).text_color(th.foreground).whitespace_normal().child(labels.task_brief));
    else if (labels.task_brief_pending === "1") rows.push(note(th, "Summarising…"));
    else if (labels.task_brief_error) rows.push(note(th, `No summary: ${labels.task_brief_error}`));
    else if (file) rows.push(note(th, "No summary yet (/reload this Pi once idle)"));
    return v_flex().gap(6).children(rows);
  }

  // Your last message to the agent, with how long ago.
  lastPromptSection({ agent, term }, th) {
    if (!agent) return null;
    const file = term?.labels?.["pi.session"];
    if (!file) return v_flex().gap(6).children([heading(th, "LAST PROMPT"), note(th, "Only Pi conversations are read")]);
    const read = this.talk.get(file);
    const last = read?.last;
    const rows = [heading(th, "LAST PROMPT", null, last?.at ? ago(Date.now() - last.at) : "")];
    if (!read) rows.push(note(th, "Reading the conversation…"));
    else if (read.error) rows.push(note(th, read.error));
    else if (!last) rows.push(note(th, "No message yet"));
    else {
      const { short, cut } = preview(last.text);
      rows.push(div().text_size(12).text_color(th.muted).whitespace_normal().child(this.expanded ? last.text : short));
      if (cut) rows.push(div().id("brief-more").text_size(11).text_color(th.accent).cursor_pointer()
        .on_click((_e, cx) => { this.expanded = !this.expanded; cx.notify(); })
        .child(this.expanded ? "less \u25b4" : "more \u25be"));
    }
    return v_flex().gap(6).children(rows);
  }

  branchSection(th) {
    const g = this.git;
    if (!g) return v_flex().gap(6).children([heading(th, "BRANCH"), note(th, "Reading git…")]);
    const s = branchSummary(g);
    const rows = [heading(th, "BRANCH")];
    if (s.name) rows.push(g.url ? link(th, "brief-branch", s.name, g.url) : h_flex().gap(6).min_w(0).text_size(12)
      .child(div().min_w(0).truncate().child(s.name))
      .when(Boolean(g.branch), (e) => e.child(div().flex_none().text_color(th.dim).child("\u00b7 not pushed"))));
    rows.push(div().text_size(12).child(s.headline));
    if (s.stat) rows.push(h_flex().gap(6).text_size(12)
      .child(div().text_color(th.muted).child(`${s.stat.files} \u00b7`))
      .child(div().text_color(th.ansi2).child(`+${s.stat.add}`))
      .child(div().text_color(th.ansi1).child(`\u2212${s.stat.del}`)));
    if (Number.isInteger(s.dirty)) rows.push(s.dirty ? div().text_size(12).text_color(th.done).child(`${plural(s.dirty, "file")} not committed`) : note(th, "Everything committed"));
    return v_flex().gap(6).children(rows);
  }

  prSection(th) {
    const g = this.git, entry = this.prs.get(prKey(g.on, g.root, g.branch));
    const pr = entry?.pr;
    const rows = [heading(th, "PULL REQUEST")];
    if (!entry) rows.push(note(th, "Looking on GitHub…"));
    else if (!pr && !entry.found) rows.push(note(th, `GitHub: ${entry.error}`));
    else if (!pr) rows.push(note(th, "No pull request"));
    else {
      const text = `#${pr.number} ${pr.title}`.trim();
      rows.push(pr.url ? link(th, "brief-pr", text, pr.url) : div().min_w(0).truncate().text_size(12).child(text));
      rows.push(h_flex().gap(6).text_size(12)
        .child(div().text_color(th[PR_TONE[pr.state]] ?? th.foreground).child(PR_WORD[pr.state]))
        .when(Boolean(pr.review), (e) => e.child(div().text_color(th.muted).child(`\u00b7 ${pr.review}`))));
      const { pass, fail, pending } = pr.checks;
      rows.push(pass + fail + pending === 0 ? note(th, "No checks") : h_flex().gap(10).text_size(12)
        .child(div().text_color(th.muted).child("Checks"))
        .when(pass > 0, (e) => e.child(div().text_color(th.ansi2).child(`\u2713 ${pass}`)))
        .when(fail > 0, (e) => e.child(div().text_color(th.ansi1).child(`\u2717 ${fail}`)))
        .when(pending > 0, (e) => e.child(div().text_color(th.working).child(`\u25cc ${pending}`))));
      pr.failing.slice(0, FAILING_SHOWN).forEach((c, i) => rows.push(h_flex().id(`brief-check-${i}`).gap(6).pl(12).items_center().min_w(0).text_size(12)
        .when(Boolean(c.url), (e) => e.cursor_pointer().hover((s) => s.text_color(th.accent)).on_click((_e, cx) => openUrl(c.url, cx)))
        .child(div().flex_none().text_color(th.ansi1).child("\u2717"))
        .child(div().flex_1().min_w(0).truncate().child(c.name))
        .when(Boolean(c.url), (e) => e.child(div().flex_none().text_size(11).text_color(th.dim).child("\u2197")))));
      if (pr.failing.length > FAILING_SHOWN) rows.push(note(th, `and ${pr.failing.length - FAILING_SHOWN} more failing`));
      if (entry.error) rows.push(note(th, `Not refreshed: ${entry.error}`));
    }
    return v_flex().gap(6).children(rows);
  }
}

// A section's small grey caption; `aside` sits at its right edge.
function heading(th, label, value = null, aside = "") {
  return h_flex().gap(8).items_center().min_w(0)
    .child(div().flex_none().text_size(10).font_semibold().text_color(th.dim).child(label))
    .when(Boolean(value), (e) => e.child(div().min_w(0).truncate().text_size(12).text_color(th.foreground).child(value)))
    .child(div().flex_1())
    .when(Boolean(aside), (e) => e.child(div().flex_none().text_size(11).text_color(th.dim).child(aside)));
}

// Text that opens `url` in the browser: accent-coloured, with an arrow.
function link(th, id, text, url) {
  return h_flex().id(id).gap(6).items_center().min_w(0).text_size(12).text_color(th.accent).cursor_pointer()
    .hover((s) => s.opacity(0.75))
    .on_click((_e, cx) => openUrl(url, cx))
    .child(div().min_w(0).truncate().child(text))
    .child(div().flex_none().text_size(11).child("\u2197"));
}

const note = (th, text) => div().text_size(12).text_color(th.dim).child(text);
