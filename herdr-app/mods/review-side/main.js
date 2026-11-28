// Review mode's right column: "Your review", a checklist of the review's
// steps with one button for the next thing to do, and the open pull
// request's checks, reviewers and labels at its foot. The tour (plan step 4)
// and submitting (step 10) fill in steps 3 and 4 later; the chat (step 7)
// becomes a tab of the middle column.
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step,
// and the Paper file "Review" (frames "D · Mix") is its design.
// review-nav shares the open pull request ("review-mode.open"), its snapshot,
// the file shown, the Viewed files and the tab ("review-mode.tab").

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, readTextFile, setShared, settings, shared, theme } from "herdr";
// The Paper design's look (file "Review", frames "D · Mix"): the theme's
// see-through surfaces made solid, and the theme file's own text colour,
// which the app swaps for near-black in panels.
const solid = (c) => (/^#[0-9a-f]{8}$/i.test(c ?? "") ? c.slice(0, 7) : c);
export function lookOf(t, ink) {
  return { ...t, background: solid(t.background), canvas: solid(t.canvas), chrome: solid(t.chrome), foreground: ink ?? t.foreground };
}


const OPEN = "review-mode.open", SNAPSHOT = "review-mode.snapshot", FILE = "review-mode.file", VIEWED = "review-mode.viewed";
const TAB = "review-mode.tab";
// The pull request whose description you left for another tab ({ pr,
// snapshot }, snapshot null if it wasn't in yet), so step 1 stays done when
// you come back to it.
const READ = "review-mode.read";
const REVIEWERS_SHOWN = 4;

const base = (path) => path.slice(path.lastIndexOf("/") + 1);
// A theme colour with alpha ("40" of "ff"), or null if it isn't #rrggbb[aa].
const faint = (color, alpha) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color ?? "") ? `${color.slice(0, 7)}${alpha}` : null);

// The next file not yet viewed after `current`, going round to the start;
// null when all are viewed.
export function nextUnviewed(files, viewed, current) {
  const seen = new Set(viewed ?? []);
  const paths = files.map((f) => f.path);
  const at = paths.indexOf(current);
  for (let i = 1; i <= paths.length; i++) {
    const path = paths[(at + i + paths.length) % paths.length];
    if (!seen.has(path)) return path;
  }
  return null;
}

// The four steps of a review ({ title, sub, state: "done" | "now" | "todo" }),
// how many are done, and the button's action. The description counts as read
// once you have moved on from it (`read`) or ticked a file; `files` is null
// until the snapshot is in, `failed` its error, `total` the changed files
// past the listed ones.
export function reviewSteps({ tab, files, viewed, read = false, total = null, failed = null }) {
  const seen = new Set(viewed ?? []);
  const n = Math.max(total ?? 0, files?.length ?? 0);
  const k = (files ?? []).filter((f) => seen.has(f.path)).length;
  const described = read || (tab ?? "description") !== "description" || k > 0;
  const allRead = !!files && k === n;
  const next = files ? nextUnviewed(files, [...seen], null) : null;
  const steps = [
    { title: "Read the description", sub: described ? "Done" : "What the pull request says it does", state: described ? "done" : "now" },
    {
      title: "Read the files",
      sub: failed ? `Snapshot failed: ${failed} · ↵ on the pull request tries again` : !files ? "Taking a snapshot…" : allRead || !next ? `${k} of ${n} viewed` : `${k} of ${n} viewed · next: ${base(next)}`,
      state: allRead ? "done" : described ? "now" : "todo",
    },
    { title: "Walk the tour", sub: "Not available yet", state: "todo" },
    { title: "Submit your review", sub: "Not available yet", state: "todo" },
  ];
  const action = !files || allRead || !next ? null
    : tab === "files" ? { label: "Next file", key: null, go: "next" }
      : { label: "Start with the files", key: "↵", go: "files" };
  return { steps, done: steps.filter((s) => s.state === "done").length, action };
}

// The checklist as the shared state has it now. Leaving the description
// marks it read, for this snapshot or, before one is in, this pull request.
export function shownSteps() {
  const pr = shared(OPEN);
  const snap = shared(SNAPSHOT);
  const ready = !!pr && snap?.status === "ready" && snap.pr === pr.url;
  const v = shared(VIEWED);
  const viewed = ready && v?.snapshot === snap.snapshot && v.pr === pr.url ? v.paths : [];
  const tab = shared(TAB) ?? "description";
  const r = shared(READ);
  const read = !!pr && r?.pr === pr.url && (r.snapshot === null || (ready && r.snapshot === snap.snapshot));
  if (pr && !read && tab !== "description") setShared(READ, { pr: pr.url, snapshot: ready ? snap.snapshot : null });
  const failed = pr && snap?.pr === pr.url && snap.status === "error" ? snap.error : null;
  return { pr, snap, ready, viewed, tab, ...reviewSteps({ tab, files: ready ? snap.files : null, viewed, read, total: ready ? snap.changed_files : null, failed }) };
}

const REVIEW = { REQUESTED: "requested", APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed", PENDING: "pending" };

export default class ReviewSide extends View {
  // The theme file's text colour, read once per theme.
  ink(cx) {
    const name = settings().theme;
    if (name !== this.inkTheme) {
      this.inkTheme = name;
      this.inkColor = null;
      if (name && !checking()) cx.spawn(async (cx) => {
        try {
          const file = JSON.parse(await readTextFile(`${appHome()}/themes/${name}.json`));
          if (this.inkTheme === name && /^#[0-9a-f]{6}$/i.test(file?.foreground ?? "")) { this.inkColor = file.foreground; cx.notify(); }
        } catch { /* a built-in theme, or unreadable: the app's colour */ }
      });
    }
    return this.inkColor;
  }

  render(cx) {
    const t = lookOf(theme(), this.ink(cx));
    // The canvas round the panel stands in for the layout's gaps.
    const panel = (inner) => v_flex().size_full().bg(t.canvas).pt(8).pr(8).pb(8).line_height(1.25)
      .child(inner.flex_1().min_h(0).rounded(12).bg(t.background));
    const pr = shared(OPEN);
    const heading = (right) => h_flex().items_baseline()
      .child(div().text_size(24).font_extrabold().text_color(t.foreground).child("Your review"))
      .child(div().flex_1())
      .when(!!right, (el) => el.child(div().text_size(14).font_bold().text_color(t.muted).child(right)));
    if (!pr) {
      return panel(v_flex().id("review-side").px(26).py(24).gap(12)
        .child(heading(null))
        .child(div().text_size(15).text_color(t.muted).child("Open a pull request to start.")));
    }
    const { snap, viewed, steps, done, action } = shownSteps();
    const green = t.ansi2 ?? t.done;
    const onAccent = t.accent_foreground ?? t.background;

    const step = (s, i) => h_flex().gap(14)
      .child(div().size(30).flex_none().rounded_full().flex().items_center().justify_center()
        .when(s.state === "done", (el) => el.bg(green))
        .when(s.state === "now", (el) => el.bg(t.accent))
        .when(s.state === "todo", (el) => el.border(2).border_color(t.border))
        .child(div().text_size(14).font_extrabold().text_color(s.state === "todo" ? t.dim : onAccent).child(s.state === "done" ? "✓" : String(i + 1))))
      .child(v_flex().flex_1().min_w(0).gap(2).pt(4)
        .child(div().text_size(16).font_extrabold().text_color(s.state === "todo" ? t.muted : t.foreground).when(s.state === "done", (el) => el.line_through()).child(s.title))
        .child(div().text_size(14).line_height("20px").text_color(t.muted).child(s.sub)));

    const go = (cx) => {
      if (action.go === "files") setShared(TAB, "files");
      else {
        const path = nextUnviewed(snap.files, viewed, shared(FILE)?.path);
        if (path) setShared(FILE, { pr: pr.url, snapshot: snap.snapshot, path });
      }
      cx.notify();
    };

    const fact = (tone, bold, text) => h_flex().gap(10).items_center()
      .child(div().size(8).flex_none().rounded(4).bg(tone))
      .child(div().flex_none().text_size(14).font_bold().text_color(t.foreground).child(bold))
      .child(div().truncate().text_size(14).text_color(t.muted).child(text));
    const c = pr.checks ?? {};
    const checkTone = !c.total ? t.dim : c.state === "SUCCESS" ? green : c.state === "FAILURE" || c.state === "ERROR" ? t.blocked : t.working;
    const reviewTone = { APPROVED: green, CHANGES_REQUESTED: t.blocked, REQUESTED: t.working };

    return panel(v_flex().id("review-side").px(26).py(24).gap(22)
      .child(v_flex().gap(12)
        .child(heading(`${done} of ${steps.length}`))
        .child(h_flex().h(6).rounded(3).bg(t.chrome).child(div().h(6).rounded(3).bg(t.accent).w(`${(100 * done) / steps.length}%`))))
      .child(v_flex().gap(18).children(steps.map(step)))
      .when(!!action, (el) => el.child(h_flex().id("review-action").gap(10).py(12).rounded(10).bg(t.accent).items_center().justify_center().cursor_pointer()
        .on_click((_e, cx) => go(cx))
        .child(div().text_size(15).font_extrabold().text_color(onAccent).child(action.label))
        .when(!!action.key, (el) => el.child(div().px(6).py(1).rounded(5).bg(faint(onAccent, "40") ?? t.accent).text_size(12).text_color(onAccent).child(action.key)))))
      .child(div().flex_1())
      .child(v_flex().gap(8).pt(16).border_t(1).border_color(t.border)
        .child(fact(checkTone, "Checks", c.total ? `${c.passed} of ${c.total} passed` : "none"))
        .children((pr.reviewers ?? []).slice(0, REVIEWERS_SHOWN).map((r) => fact(reviewTone[r.state] ?? t.dim, r.name, REVIEW[r.state] ?? r.state.toLowerCase())))
        .when((pr.reviewers ?? []).length > REVIEWERS_SHOWN, (el) => el.child(div().text_size(14).text_color(t.muted).child(`and ${pr.reviewers.length - REVIEWERS_SHOWN} more reviewers`)))
        .child(div().text_size(14).text_color(t.muted).child(pr.labels?.length ? pr.labels.join(" · ") : "No labels"))));
  }
}
