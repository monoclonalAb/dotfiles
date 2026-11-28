// Review mode's left column: your open pull requests and review requests
// (step 2), then the open pull request's files (step 3) and tour (step 4).
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.
//
// The list is GitHub's issue search, the one `gh search prs` uses (it alone
// says when results may be incomplete), every page up to GitHub's 1000-result
// cap; then each pull request's details (merge verdict, checks, reviews) by
// node id. Loaded when Review mode opens and every 2 minutes while the window
// shows. j/k or the arrows move, Enter or a click opens: the open pull request
// goes to the shared OPEN for the other two columns.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { checking, exec, home, props, readTextFile, settings, setShared, shared, theme, window, writeTextFile } from "herdr";

export const OPEN = "review-mode.open";
// The open pull request's snapshot ({ pr, status: "loading" | "ready" |
// "error", ...review-analyse snapshot }), the file its diff shows ({ pr,
// snapshot, path }) and its Viewed files ({ snapshot, paths }).
export const SNAPSHOT = "review-mode.snapshot", FILE = "review-mode.file", VIEWED = "review-mode.viewed";
// The open pull request's tab ("description", "files" or "checks"; the Files
// tab turns this column into its files), and a Viewed click in the middle
// column ({ pr, snapshot, path, nonce }), which only this mod saves.
export const TAB = "review-mode.tab", TOGGLE = "review-mode.toggle";
const SNAPSHOT_TIMEOUT = 600000; // the first one clones the repository
export const PAGE = 100; // GitHub's most search results per page
export const CAP = 1000; // GitHub's search returns no more than this
// Pull requests per details query, and queries at once. GitHub's time grows
// with the pull requests in one query (1: 0.9 s, 6: 1.4 s, 18: 3.5 s; 50 long
// ones can time out, HTTP 502), so small queries run side by side.
const BATCH = 6, AT_ONCE = 4;
const REFRESH = 120000, CHECK = 15000;
// GitHub answers UNKNOWN until it has worked out a merge verdict (11 of 27
// pull requests on a first load), so those are asked again after these waits.
const RECHECKS = [5000, 10000, 20000];

export const SEARCHES = [
  { key: "review", title: "Needs your review", query: "is:pr is:open archived:false review-requested:@me" },
  { key: "mine", title: "Yours", query: "is:pr is:open archived:false author:@me" },
];

export const CHIPS = {
  ready: "Ready to merge", failing: "CI failing", running: "Checks running", conflicts: "Conflicts",
  changes: "Changes requested", review: "Review required", draft: "Draft", blocked: "Blocked", unknown: "Unknown",
};

// GitHub's merge verdict comes first: Ready to merge only when it says the
// pull request merges cleanly, never from an approval alone.
export function chip(pr) {
  if (pr.draft) return "draft";
  if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY") return "conflicts";
  if (pr.checks?.state === "FAILURE" || pr.checks?.state === "ERROR") return "failing";
  if (pr.checks?.state === "PENDING" || pr.checks?.state === "EXPECTED") return "running";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (pr.mergeState === "CLEAN" && pr.mergeable === "MERGEABLE") return "ready";
  if (pr.reviewDecision === "REVIEW_REQUIRED") return "review";
  if (pr.mergeState === "BLOCKED" || pr.mergeState === "BEHIND") return "blocked";
  return "unknown";
}

const searchArgs = (query, page) => ["api", "-X", "GET", "search/issues", "-f", `q=${query}`, "-f", "sort=updated", "-f", "order=desc", "-f", `per_page=${PAGE}`, "-f", `page=${page}`];

const DETAILS = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest {
  id number title url isDraft body createdAt repository { nameWithOwner } author { login }
  headRefName baseRefName additions deletions changedFiles mergeable mergeStateStatus reviewDecision
  labels(first: 100) { nodes { name } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { name } ... on Bot { login } } } }
  latestReviews(first: 20) { nodes { author { login } state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts {
    checkRunCount checkRunCountsByState { state count } statusContextCount statusContextCountsByState { state count } } } } } }
} } }`;
const detailArgs = (ids) => ["api", "graphql", "-f", `query=${DETAILS}`, ...ids.flatMap((id) => ["-f", `ids[]=${id}`])];

// gh's reply as JSON; a failure rejects with gh's own message.
function reply(result) {
  let data = null;
  try { data = JSON.parse(result.stdout); } catch { /* no JSON */ }
  if (result.code !== 0 && !data?.data) throw new Error((result.stderr || result.stdout || `gh exited ${result.code}`).trim());
  if (!data) throw new Error("gh gave no JSON");
  return data;
}

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function toPullRequest(n) {
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const counts = [...(rollup?.contexts?.checkRunCountsByState ?? []), ...(rollup?.contexts?.statusContextCountsByState ?? [])];
  const reviews = (n.latestReviews?.nodes ?? []).filter((r) => r?.author?.login).map((r) => ({ name: r.author.login, state: r.state }));
  const requested = (n.reviewRequests?.nodes ?? []).map((r) => r?.requestedReviewer?.login ?? r?.requestedReviewer?.name).filter(Boolean)
    .map((name) => ({ name, state: "REQUESTED" }));
  const pr = {
    id: n.id, number: n.number, title: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? "",
    author: n.author?.login ?? "", base: n.baseRefName, head: n.headRefName, draft: n.isDraft === true,
    body: n.body ?? "", created: n.createdAt ?? null, additions: n.additions ?? 0, deletions: n.deletions ?? 0, files: n.changedFiles ?? 0,
    mergeable: n.mergeable ?? null, mergeState: n.mergeStateStatus ?? null, reviewDecision: n.reviewDecision ?? null,
    checks: {
      state: rollup?.state ?? null,
      passed: counts.filter((c) => PASSED.has(c.state)).reduce((sum, c) => sum + c.count, 0),
      total: (rollup?.contexts?.checkRunCount ?? 0) + (rollup?.contexts?.statusContextCount ?? 0),
    },
    labels: (n.labels?.nodes ?? []).map((l) => l?.name).filter(Boolean),
    reviewers: [...requested, ...reviews],
  };
  return { ...pr, chip: chip(pr) };
}

async function details(gh, ids) {
  const byId = new Map();
  const batches = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  let failed = false; // then start no more: GitHub may be throttling
  const next = async () => {
    for (let batch; !failed && (batch = batches.shift());) {
      try {
        for (const n of reply(await gh(detailArgs(batch))).data?.nodes ?? []) if (n?.id) byId.set(n.id, toPullRequest(n));
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, batches.length) }, next));
  return byId;
}

// Every page of one search: node ids in GitHub's order, its total and
// whether GitHub said any page may be incomplete.
async function search(gh, query) {
  const ids = [];
  let total = 0, incomplete = false;
  for (let page = 1; page <= CAP / PAGE; page++) {
    const found = reply(await gh(searchArgs(query, page)));
    total = found.total_count ?? 0;
    incomplete ||= found.incomplete_results === true;
    for (const item of found.items ?? []) if (item?.node_id && !ids.includes(item.node_id)) ids.push(item.node_id);
    if ((found.items ?? []).length < PAGE || page * PAGE >= Math.min(total, CAP)) break;
  }
  return { ids, total, incomplete };
}

// The list: { at, sections: [{ key, title, prs, more, missing, incomplete }] },
// where `more` counts what GitHub found beyond what it returned, and `missing`
// those it found but gave no details for.
// gh(args) runs gh and resolves with { code, stdout, stderr }.
export async function loadPullRequests(gh) {
  const found = await Promise.all(SEARCHES.map(async (s) => ({ ...s, ...(await search(gh, s.query)) })));
  const byId = await details(gh, [...new Set(found.flatMap((s) => s.ids))]);
  return {
    at: Date.now(),
    sections: found.map((s) => ({
      key: s.key, title: s.title, incomplete: s.incomplete, more: Math.max(0, s.total - s.ids.length),
      missing: s.ids.filter((id) => !byId.has(id)).length,
      prs: s.ids.map((id) => byId.get(id)).filter(Boolean),
    })),
  };
}

// The list with its UNKNOWN merge verdicts asked again: { list, unknown },
// `unknown` counting those GitHub still hasn't decided.
export async function recheckUnknown(gh, list) {
  const ids = list.sections.flatMap((s) => s.prs).filter((p) => p.mergeState === "UNKNOWN").map((p) => p.id);
  if (!ids.length) return { list, unknown: 0 };
  const fresh = await details(gh, [...new Set(ids)]);
  const next = { ...list, sections: list.sections.map((s) => ({ ...s, prs: s.prs.map((p) => fresh.get(p.id) ?? p) })) };
  return { list: next, unknown: next.sections.flatMap((s) => s.prs).filter((p) => p.mergeState === "UNKNOWN").length };
}

// The open pull request as the list has it now; marked `gone` once it is no
// longer listed (merged, closed, or no longer waiting for your review).
export function openNow(open, list) {
  if (!open) return null;
  const now = list.sections.flatMap((s) => s.prs).find((p) => p.id === open.id || p.url === open.url);
  return now ?? (open.gone ? open : { ...open, gone: true });
}

// The last list, kept in a file so Review mode opens on it while a fresh one
// loads: C-a p restarts this mod, and GitHub takes seconds. The eric layout's
// copy ({ part: "warm" }) refreshes it every 2 minutes, so it is at most that
// old; a copy's own storage would not reach the other. Only a list shaped as
// loadPullRequests makes it is drawn.
const KEPT_VERSION = 1, KEPT_MAX = 512 * 1024;
const keptPath = () => `${home()}/.cache/herdr-review/list.json`;
const text = (v) => typeof v === "string";
const keptPr = (p) => text(p?.id) && text(p.url) && text(p.title) && text(p.repo) && text(p.body) && Number.isInteger(p.number)
  && p.chip in CHIPS && Array.isArray(p.labels) && p.labels.every(text)
  && Array.isArray(p.reviewers) && p.reviewers.every((r) => text(r?.name) && text(r.state));

export function keptList(stored) {
  try {
    const kept = JSON.parse(stored ?? "null");
    const list = kept?.version === KEPT_VERSION ? kept.list : null;
    if (!Array.isArray(list?.sections)) return null;
    const fine = list.sections.every((s) => text(s?.key) && text(s.title) && Array.isArray(s.prs) && s.prs.every(keptPr));
    return fine ? list : null;
  } catch {
    return null;
  }
}

// The key's move through the list (1 or -1), "open", "back" (Esc, to the
// list from the Files view), "viewed" (v), or null for any key the list leaves
// alone: everything with Ctrl, Alt, Cmd or Shift, so chords like C-a p reach
// their bindings.
export function navKey(e) {
  const m = e?.modifiers ?? {};
  if (m.control || m.alt || m.platform || m.function || m.shift) return null;
  return { j: 1, down: 1, k: -1, up: -1, enter: "open", escape: "back", v: "viewed" }[e?.key] ?? null;
}

// The pull request's state file (docs/HERDR-APP.md, "State of a pull
// request's review"): one per pull request, kept per snapshot, under 1 MiB.
export const MAX_STATE = 1 << 20;
const PR_LINK = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/i;
const samePr = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

// UTF-8 bytes of a string: the app's engine has no TextEncoder.
export function utf8Bytes(text) {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function statePath(home, link) {
  const [, owner, repo, number] = PR_LINK.exec(link) ?? [];
  if (!number) throw new Error(`not a pull request link: ${link}`);
  return `${home}/.local/state/herdr-review/${owner.toLowerCase()}/${repo.toLowerCase()}/${number}.json`;
}

function parseState(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export function viewedIn(text, link, snapshot) {
  const state = text ? parseState(text) : null;
  if (!state || !samePr(state.pr, link)) return [];
  const viewed = state.snapshots?.[snapshot]?.viewed;
  return Array.isArray(viewed) ? viewed.filter((p) => typeof p === "string") : [];
}

// The file's text with `path` ticked (or unticked) in that snapshot,
// everything else as it was.
export function withViewed(text, link, snapshot, path, on) {
  const state = text ? parseState(text) : { pr: link, snapshots: {} };
  if (!state || typeof state !== "object") throw new Error("the review's state file is not readable JSON");
  if (!samePr(state.pr, link)) throw new Error("the review's state file belongs to another pull request");
  const snapshots = { ...(state.snapshots ?? {}) };
  const entry = { ...(snapshots[snapshot] ?? {}) };
  const viewed = new Set(viewedIn(text, link, snapshot));
  if (on) viewed.add(path);
  else viewed.delete(path);
  snapshots[snapshot] = { ...entry, viewed: [...viewed] };
  return JSON.stringify({ ...state, snapshots }, null, 1);
}

// Saves one tick: read, change, write only if nobody saved in between; if
// someone did, read their save and re-apply just this tick.
// disk: { read(path), write(path, text, expected) }, as readTextFile and
// writeTextFile.
export async function saveViewed(disk, home, link, snapshot, path, on) {
  const file = statePath(home, link);
  for (let attempt = 0; ; attempt++) {
    const before = await disk.read(file);
    const after = withViewed(before, link, snapshot, path, on);
    if (utf8Bytes(after) > MAX_STATE) throw new Error("the review's state file would pass 1 MiB; tick not saved");
    try {
      await disk.write(file, after, before);
      return viewedIn(after, link, snapshot);
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}

const gh = (args) => exec("gh", args, { timeout: 60000 });
// review-analyse (bin/review-analyse) snapshots the pull request; the app runs
// it without a login shell, so by its linked path.
const analyse = (args, timeout) => exec(`${home()}/.local/bin/review-analyse`, args, { timeout });
const answer = (result) => {
  if (result.code !== 0) throw new Error((result.stderr || `review-analyse exited ${result.code}`).trim().replace(/^review-analyse: /, ""));
  return JSON.parse(result.stdout);
};

export default class ReviewNav extends View {
  init(_props, cx) {
    this.list = null;
    this.error = null;
    this.loading = false;
    this.warm = props()?.part === "warm";
    if (this.warm) {
      if (checking()) return;
      // Loads when the saved list is 2 minutes old and the window shows,
      // looked at every 15 s (no GitHub call): coming back from Review mode
      // restarts this copy, and a hidden window skips loads until it shows.
      this.savedAt = 0; // the newest list in the file
      this.triedAt = 0; // the last load started, so a failing one waits too
      const due = (cx) => {
        if (window()?.visible !== false && !this.loading && Date.now() - Math.max(this.savedAt, this.triedAt) >= REFRESH) {
          this.triedAt = Date.now();
          this.load(cx);
        }
      };
      cx.spawn(async (cx) => {
        this.savedAt = keptList(await readTextFile(keptPath()).catch(() => null))?.at ?? 0;
        due(cx);
      });
      cx.timer.every(CHECK, due);
      return;
    }
    this.selected = shared(OPEN)?.url ?? null;
    this.toggled = shared(TOGGLE)?.nonce ?? null; // a click from before a restart is not replayed
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    this.fileScroll = ScrollHandle.new();
    if (checking()) return;
    // A snapshot still loading when a layout switch restarted this mod has
    // nobody left to finish it: take it again.
    const open = shared(OPEN), snap = shared(SNAPSHOT);
    if (open && snap?.pr === open.url && snap.status === "loading") this.snapshot(open, cx);
    cx.spawn(async (cx) => {
      const kept = keptList(await readTextFile(keptPath()).catch(() => null));
      if (!kept || this.list) return; // a fresh list came first
      this.list = kept;
      this.selected ??= this.prs()[0]?.url ?? null;
      cx.notify();
    });
    this.load(cx);
    cx.timer.every(REFRESH, (cx) => { if (window()?.visible !== false) this.load(cx); });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.fresh(await loadPullRequests(gh), cx);
        this.error = null;
        this.recheck(cx, 0);
      } catch (e) {
        this.error = String(e?.message ?? e).split("\n")[0];
      }
      this.loading = false;
      cx.notify();
    });
  }

  recheck(cx, attempt) {
    if (attempt >= RECHECKS.length || !this.prs().some((p) => p.mergeState === "UNKNOWN")) return;
    const at = this.list.at;
    cx.timer.after(RECHECKS[attempt], (cx) => cx.spawn(async (cx) => {
      try {
        const { list } = await recheckUnknown(gh, this.list);
        if (this.list.at !== at) return; // a full refresh came in meanwhile
        this.fresh(list, cx);
        cx.notify();
        this.recheck(cx, attempt + 1);
      } catch { /* the next refresh asks again */ }
    }));
  }

  // Shows a freshly loaded list and keeps it for the next start.
  fresh(list, cx) {
    this.show(list);
    const stored = JSON.stringify({ version: KEPT_VERSION, list });
    // Too big: an empty file, as an older list would be wrong.
    const text = utf8Bytes(stored) <= KEPT_MAX ? stored : "";
    cx.spawn(async () => {
      const path = keptPath();
      // Newest wins: a recheck keeps its load's time, and a full refresh may
      // have saved since. A write refused because another came in between
      // reads again once.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const before = await readTextFile(path);
          if (keptList(before)?.at > list.at) return;
          await writeTextFile(path, text, before);
          this.savedAt = Math.max(this.savedAt ?? 0, list.at);
          return;
        } catch { /* read again */ }
      }
    });
  }

  show(list) {
    this.list = list;
    const open = shared(OPEN);
    const now = openNow(open, list);
    // The eric layout's copy only keeps the file; Review mode's decides.
    if (!this.warm && open && JSON.stringify(now) !== JSON.stringify(open)) setShared(OPEN, now);
    if (!this.prs().some((p) => p.url === this.selected)) this.selected = this.prs()[0]?.url ?? null;
  }

  prs() {
    return this.list?.sections.flatMap((s) => s.prs) ?? [];
  }

  move(step) {
    const prs = this.prs();
    if (!prs.length) return;
    const at = prs.findIndex((p) => p.url === this.selected);
    const next = Math.min(prs.length - 1, Math.max(0, at + step));
    this.selected = prs[next].url;
    this.reveal(next);
  }

  // The list's children are each section's heading, notes and rows.
  reveal(index) {
    let child = 0, seen = 0;
    for (const s of this.list.sections) {
      child += 1 + (s.more ? 1 : 0) + (s.incomplete ? 1 : 0) + (s.missing ? 1 : 0);
      if (index < seen + s.prs.length) return this.scroll.scroll_to_item(child + index - seen);
      child += s.prs.length;
      seen += s.prs.length;
    }
  }

  // Opening shows the pull request's Description tab, with this list still
  // here, and takes its snapshot for the Files tab.
  open(pr, cx) {
    if (!pr) return;
    this.selected = pr.url;
    setShared(OPEN, pr);
    setShared(TAB, "description");
    setShared(FILE, null);
    setShared(VIEWED, null);
    this.snapshot(pr, cx);
  }

  // Takes a snapshot (SNAPSHOT); once in, its first file waits in FILE for
  // the Files tab.
  snapshot(pr, cx) {
    // Each request is its own: a slower earlier one never wins.
    const request = `${Date.now()}-${Math.random()}`;
    setShared(SNAPSHOT, { pr: pr.url, status: "loading", request });
    cx.spawn(async (cx) => {
      let next;
      try {
        next = { ...answer(await analyse(["snapshot", pr.url], SNAPSHOT_TIMEOUT)), status: "ready" };
      } catch (e) {
        next = { pr: pr.url, status: "error", error: String(e?.message ?? e).split("\n")[0] };
      }
      if (shared(SNAPSHOT)?.request !== request) return; // opened again, or another pull request
      setShared(SNAPSHOT, next);
      if (next.status === "ready") {
        const file = shared(FILE);
        const kept = file?.pr === pr.url && next.files.some((f) => f.path === file.path);
        if (next.files.length) setShared(FILE, { pr: pr.url, snapshot: next.snapshot, path: kept ? file.path : next.files[0].path });
        const text = await readTextFile(statePath(home(), pr.url)).catch(() => null);
        // Unless a tick saved meanwhile (it set VIEWED from a newer read).
        if (shared(SNAPSHOT)?.snapshot === next.snapshot && shared(SNAPSHOT)?.pr === pr.url && !shared(VIEWED)) {
          setShared(VIEWED, { pr: pr.url, snapshot: next.snapshot, paths: viewedIn(text, pr.url, next.snapshot) });
        }
      }
      cx.notify();
    });
  }

  inFiles() {
    return shared(TAB) === "files" && !!shared(OPEN);
  }

  snapshotFiles() {
    const snap = shared(SNAPSHOT);
    return snap?.status === "ready" && snap.pr === shared(OPEN)?.url ? snap.files : [];
  }

  pick(step) {
    const snap = shared(SNAPSHOT);
    const files = this.snapshotFiles();
    if (!files.length) return;
    const at = files.findIndex((f) => f.path === shared(FILE)?.path);
    const next = Math.min(files.length - 1, Math.max(0, at + step));
    setShared(FILE, { pr: snap.pr, snapshot: snap.snapshot, path: files[next].path });
    this.fileScroll.scroll_to_item(next);
  }

  // Ticks or unticks Viewed in the state file; the tick shows once saved.
  tick(path, cx) {
    const snap = shared(SNAPSHOT);
    if (snap?.status !== "ready" || !path) return;
    const on = !(shared(VIEWED)?.paths ?? []).includes(path);
    cx.spawn(async (cx) => {
      try {
        const paths = await saveViewed({ read: readTextFile, write: writeTextFile }, home(), snap.pr, snap.snapshot, path, on);
        if (shared(SNAPSHOT)?.snapshot === snap.snapshot && shared(SNAPSHOT)?.pr === snap.pr) setShared(VIEWED, { pr: snap.pr, snapshot: snap.snapshot, paths });
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e).split("\n")[0];
      }
      cx.notify();
    });
  }

  key(e, cx) {
    const step = navKey(e);
    if (step === null) return;
    if (this.inFiles()) {
      if (step === "back") setShared(TAB, "description");
      else if (step === "viewed") this.tick(shared(FILE)?.path, cx);
      else if (typeof step === "number") this.pick(step);
    } else if (step === "open") {
      // Enter on the open pull request goes on to its files.
      const pr = this.prs().find((p) => p.url === this.selected);
      if (pr && pr.url === shared(OPEN)?.url) setShared(TAB, "files");
      else this.open(pr, cx);
    } else if (typeof step === "number") this.move(step);
    cx.notify();
  }

  render(cx) {
    if (this.warm) return div();
    // A Viewed click from the middle column (review-page), saved here once.
    const toggle = shared(TOGGLE);
    if (toggle && toggle.nonce !== this.toggled) {
      this.toggled = toggle.nonce;
      const snap = shared(SNAPSHOT);
      if (snap?.pr === toggle.pr && snap.snapshot === toggle.snapshot) this.tick(toggle.path, cx);
    }
    const t = theme();
    return v_flex().id("review-nav").size_full().pt(20).px(12).pb(16).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .children(this.inFiles() ? this.renderFiles(t) : this.renderList(t));
  }

  renderList(t) {
    const open = shared(OPEN)?.url;
    const note = (id, text, color) => div().id(id).px(12).py(2).text_size(13).text_color(color).child(text);
    const rows = [];
    for (const s of this.list?.sections ?? []) {
      rows.push(h_flex().id(`h-${s.key}`).px(12).pt(18).pb(8).gap(8).items_baseline()
        .child(div().text_size(12).font_extrabold().text_color(t.dim).child(s.title.toUpperCase()))
        .child(div().text_size(12).font_semibold().text_color(t.dim).child(String(s.prs.length))));
      if (s.more) rows.push(note(`more-${s.key}`, `${s.more} more on GitHub`, t.muted));
      if (s.incomplete) rows.push(note(`partial-${s.key}`, "GitHub's search may be missing pull requests", t.working));
      if (s.missing) rows.push(note(`missing-${s.key}`, `${s.missing} could not be loaded`, t.working));
      for (const p of s.prs) {
        const tone = toneOf(t, p.chip);
        rows.push(h_flex().id(`pr-${s.key}-${p.id}`).gap(12).px(12).py(10).rounded(10)
          .when(p.url === this.selected, (el) => el.bg(t.background))
          .when(p.url !== this.selected, (el) => el.hover((st) => st.bg(t.hover)))
          .on_click((_e, cx) => { this.handle.focus(); this.open(p, cx); cx.notify(); })
          .child(div().w(8).flex_none().pt(8).child(div().size(8).rounded(4).bg(tone)))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(div().truncate().text_size(15).text_color(t.foreground).when(p.url === open, (el) => el.font_extrabold()).when(p.url !== open, (el) => el.font_semibold()).child(p.title))
            .child(h_flex().min_w(0)
              .child(div().truncate().text_size(13).text_color(t.muted).child(`${p.repo} #${p.number} · `))
              .child(div().flex_none().text_size(13).font_bold().text_color(tone).child(CHIPS[p.chip])))));
      }
    }
    const status = this.error ? this.error : this.loading && !this.list ? "Loading your pull requests…" : this.list && !this.prs().length && !this.list.sections.some((s) => s.missing) ? "No open pull requests." : null;
    return [
      h_flex().px(12).pt(4).items_baseline()
        .child(div().text_size(22).font_extrabold().text_color(t.foreground).child("Pull requests"))
        .child(div().flex_1())
        .when(this.loading && !!this.list, (el) => el.child(div().text_size(13).text_color(t.dim).child("Refreshing…"))),
      ...(status ? [div().px(12).pt(12).text_size(14).text_color(this.error ? t.blocked : t.muted).child(status)] : []),
      v_flex().id("review-nav-list").flex_1().overflow_y_scrollbar().track_scroll(this.scroll).gap(2).pb(8).children(rows),
      keysHint(t, [["j", "k"], "move", ["↵"], "open"]),
    ];
  }

  renderFiles(t) {
    const snap = shared(SNAPSHOT);
    const files = this.snapshotFiles();
    const v = shared(VIEWED);
    const viewed = new Set(v && snap?.status === "ready" && v.snapshot === snap.snapshot && v.pr === snap.pr ? v.paths : []);
    const at = shared(FILE)?.path;
    const status = this.error ?? (snap?.status === "loading" ? "Taking a snapshot…" : snap?.status === "error" ? snap.error : null);
    const ready = t.ansi2 ?? t.done;
    const rows = files.map((f, i) => {
      const slash = f.path.lastIndexOf("/");
      const seen = viewed.has(f.path);
      return h_flex().id(`file-${i}`).gap(12).px(12).py(10).rounded(10)
        .when(f.path === at, (el) => el.bg(t.background))
        .when(f.path !== at, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((_e, cx) => { this.handle.focus(); setShared(FILE, { pr: snap.pr, snapshot: snap.snapshot, path: f.path }); cx.notify(); })
        .child(div().id(`tick-${i}`).w(18).flex_none().pt(2).cursor_pointer()
          .on_click((_e, cx) => { this.handle.focus(); this.tick(f.path, cx); })
          .child(tickBox(t, seen)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().truncate().text_size(15).text_color(seen ? t.muted : t.foreground).when(f.path === at, (el) => el.font_extrabold()).when(f.path !== at, (el) => el.font_semibold()).child(f.path.slice(slash + 1)))
          .child(div().truncate().text_size(12).font_family(mono()).text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash + 1) : "top folder")))
        .child(v_flex().w(64).flex_none().items_end().gap(3)
          .when(f.too_large, (el) => el.child(div().text_size(12).font_family(mono()).text_color(t.dim).child(f.binary ? "binary" : "large")))
          .when(!f.too_large, (el) => el
            .child(div().text_size(12).font_family(mono()).text_color(ready).child(`+${f.additions}`))
            .child(div().text_size(12).font_family(mono()).text_color(t.blocked).child(`−${f.deletions}`))));
    });
    return [
      h_flex().px(12).pt(4).pb(10).gap(8).items_center()
        .child(div().id("review-nav-back").text_size(15).font_bold().text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => { this.handle.focus(); setShared(TAB, "description"); cx.notify(); })
          .child("← All pull requests"))
        .child(keyChip(t, "esc")),
      h_flex().px(12).pt(4).pb(12).items_baseline()
        .child(div().text_size(22).font_extrabold().text_color(t.foreground).child("Files"))
        .child(div().flex_1())
        .when(files.length > 0, (el) => el.child(div().text_size(13).font_bold().text_color(t.muted).child(`${files.filter((f) => viewed.has(f.path)).length} of ${files.length} viewed`))),
      ...(status ? [div().px(12).pb(8).text_size(14).text_color(this.error || snap?.status === "error" ? t.blocked : t.muted).child(status)] : []),
      ...(files.length && snap.changed_files > files.length
        ? [div().px(12).pb(6).text_size(13).text_color(t.working).child(`${snap.changed_files - files.length} more files not listed`)] : []),
      v_flex().id("review-nav-files").flex_1().overflow_y_scrollbar().track_scroll(this.fileScroll).gap(2).pb(8).children(rows),
      keysHint(t, [["j", "k"], "file", ["v"], "viewed"]),
    ];
  }
}

// The UI font is the layout's; code and keys use the terminal font.
const mono = () => settings().font_family ?? "Maple Mono NF";

// A state's colour: green ready, red when something blocks, blue while
// waiting on someone, dim for drafts and the unknown.
function toneOf(t, chip) {
  return { ready: t.ansi2 ?? t.done, failing: t.blocked, conflicts: t.blocked, changes: t.blocked, running: t.working, review: t.working, blocked: t.working }[chip] ?? t.dim;
}

function keyChip(t, k) {
  return div().px(6).py(1).rounded(5).bg(t.chrome).text_size(12).font_family(mono()).text_color(t.muted).child(k);
}

// Keys at the column's foot: [["j", "k"], "move", ["↵"], "open"].
function keysHint(t, parts) {
  const row = h_flex().px(12).pt(8).gap(6).items_center();
  parts.forEach((part, i) => {
    if (Array.isArray(part)) part.forEach((k) => row.child(keyChip(t, k)));
    else row.child(div().text_size(13).text_color(t.dim).child(part)).when(i < parts.length - 1, (el) => el.child(div().w(8)));
  });
  return row;
}

function tickBox(t, on) {
  return on
    ? div().size(16).rounded(4).bg(t.ansi2 ?? t.done).flex().items_center().justify_center().child(div().text_size(11).font_black().text_color(t.accent_foreground ?? t.background).child("✓"))
    : div().size(16).rounded(4).border(1).border_color(t.input ?? t.border);
}
