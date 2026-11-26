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
import { checking, exec, setShared, shared, theme, window } from "herdr";

export const OPEN = "review-mode.open";
export const PAGE = 100; // GitHub's most search results per page
export const CAP = 1000; // GitHub's search returns no more than this
const BATCH = 50; // pull requests per details query (GitHub allows 100)
const REFRESH = 120000;
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
  if ((pr.mergeState === "CLEAN" || pr.mergeState === "HAS_HOOKS") && pr.mergeable === "MERGEABLE") return "ready";
  if (pr.reviewDecision === "REVIEW_REQUIRED") return "review";
  if (pr.mergeState === "BLOCKED" || pr.mergeState === "BEHIND") return "blocked";
  return "unknown";
}

const searchArgs = (query, page) => ["api", "-X", "GET", "search/issues", "-f", `q=${query}`, "-f", "sort=updated", "-f", "order=desc", "-f", `per_page=${PAGE}`, "-f", `page=${page}`];

const DETAILS = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest {
  id number title url isDraft body repository { nameWithOwner } author { login }
  headRefName baseRefName additions deletions changedFiles mergeable mergeStateStatus reviewDecision
  labels(first: 20) { nodes { name } }
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
    .filter((name) => !reviews.some((r) => r.name === name)).map((name) => ({ name, state: "REQUESTED" }));
  const pr = {
    id: n.id, number: n.number, title: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? "",
    author: n.author?.login ?? "", base: n.baseRefName, head: n.headRefName, draft: n.isDraft === true,
    body: n.body ?? "", additions: n.additions ?? 0, deletions: n.deletions ?? 0, files: n.changedFiles ?? 0,
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
  for (let i = 0; i < ids.length; i += BATCH) {
    for (const n of reply(await gh(detailArgs(ids.slice(i, i + BATCH)))).data?.nodes ?? []) {
      if (n?.id) byId.set(n.id, toPullRequest(n));
    }
  }
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

// The list: { at, sections: [{ key, title, prs, more, incomplete }] }, where
// `more` counts what GitHub found beyond what it returned.
// gh(args) runs gh and resolves with { code, stdout, stderr }.
export async function loadPullRequests(gh) {
  const found = [];
  for (const s of SEARCHES) found.push({ ...s, ...(await search(gh, s.query)) });
  const byId = await details(gh, [...new Set(found.flatMap((s) => s.ids))]);
  return {
    at: Date.now(),
    sections: found.map((s) => ({
      key: s.key, title: s.title, incomplete: s.incomplete, more: Math.max(0, s.total - s.ids.length),
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

// The key's move through the list (1 or -1), "open", or null for any key the
// list leaves alone: everything with Ctrl, Alt, Cmd or Shift, so chords like
// C-a p reach their bindings.
export function navKey(e) {
  const m = e?.modifiers ?? {};
  if (m.control || m.alt || m.platform || m.function || m.shift) return null;
  return { j: 1, down: 1, k: -1, up: -1 }[e?.key] ?? (e?.key === "enter" ? "open" : null);
}

const gh = (args) => exec("gh", args, { timeout: 60000 });

export default class ReviewNav extends View {
  init(_props, cx) {
    this.list = null;
    this.error = null;
    this.loading = false;
    this.selected = shared(OPEN)?.url ?? null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    this.load(cx);
    cx.timer.every(REFRESH, (cx) => { if (window()?.visible !== false) this.load(cx); });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.show(await loadPullRequests(gh));
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
        this.show(list);
        cx.notify();
        this.recheck(cx, attempt + 1);
      } catch { /* the next refresh asks again */ }
    }));
  }

  show(list) {
    this.list = list;
    const open = shared(OPEN);
    const now = open && this.prs().find((p) => p.url === open.url);
    if (now && JSON.stringify(now) !== JSON.stringify(open)) setShared(OPEN, now);
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
      child += 1 + (s.more ? 1 : 0) + (s.incomplete ? 1 : 0);
      if (index < seen + s.prs.length) return this.scroll.scroll_to_item(child + index - seen);
      child += s.prs.length;
      seen += s.prs.length;
    }
  }

  open(pr) {
    if (!pr) return;
    this.selected = pr.url;
    setShared(OPEN, pr);
  }

  render(cx) {
    const t = theme();
    const open = shared(OPEN)?.url;
    const note = (id, text, color) => div().id(id).px(12).py(2).text_size(11).text_color(color).child(text);
    const rows = [];
    for (const s of this.list?.sections ?? []) {
      rows.push(div().id(`h-${s.key}`).px(12).pt(12).pb(4).text_size(11).font_semibold().text_color(t.muted)
        .child(`${s.title} · ${s.prs.length}`));
      if (s.more) rows.push(note(`more-${s.key}`, `${s.more} more on GitHub`, t.muted));
      if (s.incomplete) rows.push(note(`partial-${s.key}`, "GitHub's search may be missing pull requests", t.working));
      for (const p of s.prs) {
        const tone = { ready: t.done, failing: t.blocked, conflicts: t.blocked, changes: t.blocked, running: t.working, review: t.accent, blocked: t.working }[p.chip] ?? t.muted;
        rows.push(v_flex().id(`pr-${s.key}-${p.id}`).mx(6).px(8).py(6).gap(2).rounded(6)
          .when(p.url === this.selected, (el) => el.bg(t.selected))
          .when(p.url !== this.selected, (el) => el.hover((st) => st.bg(t.hover)))
          .on_click((_e, cx) => { this.handle.focus(); this.open(p); cx.notify(); })
          .child(div().truncate().text_size(13).text_color(p.url === open ? t.accent : t.foreground).child(p.title))
          .child(h_flex().gap(8).items_center()
            .child(div().truncate().text_size(11).text_color(t.muted).child(`${p.repo} #${p.number}`))
            .child(div().flex_1())
            .child(div().text_size(11).text_color(tone).child(CHIPS[p.chip]))));
      }
    }
    const status = this.error ? this.error : this.loading && !this.list ? "Loading your pull requests…" : !this.prs().length && this.list ? "No open pull requests." : null;
    return v_flex().id("review-nav").size_full().track_focus(this.handle)
      .on_key_down((e, cx) => {
        const step = navKey(e);
        if (step === null) return;
        if (step === "open") this.open(this.prs().find((p) => p.url === this.selected));
        else this.move(step);
        cx.notify();
      })
      .child(h_flex().px(12).pt(12).pb(4).items_center()
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Pull requests"))
        .child(div().flex_1())
        .when(this.loading && !!this.list, (el) => el.child(div().text_size(11).text_color(t.dim).child("Refreshing…"))))
      .when(!!status, (el) => el.child(div().px(12).py(6).text_size(12).text_color(this.error ? t.blocked : t.muted).child(status)))
      .child(v_flex().id("review-nav-list").flex_1().overflow_y_scrollbar().track_scroll(this.scroll).pb(8).children(rows))
      .child(div().px(12).py(8).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child("j/k move · Enter open"));
  }
}
