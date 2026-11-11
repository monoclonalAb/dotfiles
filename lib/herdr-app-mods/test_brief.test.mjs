// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadMod } from "./load.mjs";

const {
  pickAgent, agentTitle, LAST_JQ, CONVERSATION_SH, parseConversation, ago, preview, SHORT, changeTotals, webBase, branchUrl, branchFacts, branchSummary, checkBucket, latestChecks, prFacts, prOutcome,
} = await loadMod("brief");

const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { encoding: "utf8", ...options });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const hasJq = run("jq", ["--version"]).code === 0;

// --- Which agent ----------------------------------------------------------------

const agent = (address, over) => ({ address, pane: `p-${address}`, space: "s1", tab: "tab1", status: "idle", title: "", ...over });

test("the focused pane's agent, else the focused tab's, else the Space's first", () => {
  const list = [agent("t1"), agent("t2", { tab: "tab2" }), agent("t3", { tab: "tab2" }), agent("t9", { space: "s2", tab: "tabx" })];
  assert.equal(pickAgent(list, { space: "s1", tab: "tab2", pane: "p-t3", terminal: "t3" }).address, "t3");
  assert.equal(pickAgent(list, { space: "s1", tab: "tab2", pane: "p-shell", terminal: "t5" }).address, "t2", "a shell pane: its tab's agent");
  assert.equal(pickAgent(list, { space: "s1", tab: "tab3", pane: "p-shell", terminal: "t5" }).address, "t1", "no agent in the tab");
  assert.equal(pickAgent(list, { space: "s3", tab: "tab9", pane: null, terminal: null }), null, "never another Space's agent");
  assert.equal(pickAgent(list, null), null);
});

test("titles: Pi's summary, else the title without its mark, else the program", () => {
  assert.equal(agentTitle({ summary: "Fix login spinner", title: "π - beacon", program: "Pi" }), "Fix login spinner");
  assert.equal(agentTitle({ title: "π - beacon", program: "Pi" }), "beacon");
  assert.equal(agentTitle({ title: "", program: "OMP" }), "OMP");
});

// --- The conversation -----------------------------------------------------------

const header = { type: "session", version: 3, id: "abc", timestamp: "2026-11-06T09:00:00.000Z", cwd: "/w" };
const line = (message, at = "2026-11-06T09:05:00.000Z") => JSON.stringify({ type: "message", id: "m", parentId: null, timestamp: at, message });

function readConversation(lines, tail = "\n") {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  try {
    const file = join(dir, "s.jsonl");
    writeFileSync(file, lines.join("\n") + tail);
    const r = run("sh", ["-c", CONVERSATION_SH, "conversation", file, LAST_JQ]);
    assert.equal(r.code, 0, r.stderr);
    return parseConversation(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the start time and the last user message, as plain text or text blocks", { skip: !hasJq && "jq not installed" }, () => {
  const system = line({ role: "system", content: "You are Pi. Never say \"role\":\"user\"." });
  const reply = line({ role: "assistant", content: [{ type: "text", text: "Done." }] }, "2026-11-06T09:40:00.000Z");
  assert.deepEqual(readConversation([JSON.stringify(header), system, line({ role: "user", content: "Fix the login spinner" }),
    line({ role: "user", content: "Also show the error" }, "2026-11-06T09:30:00.000Z"), reply]),
  { started: Date.parse(header.timestamp), last: { at: Date.parse("2026-11-06T09:30:00.000Z"), text: "Also show the error" } });
  const blocks = [{ type: "text", text: "Look at this:" }, { type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "the spinner" }];
  assert.equal(readConversation([JSON.stringify(header), line({ role: "user", content: blocks })]).last.text, "Look at this:\nthe spinner");
});

test("a line still being written is skipped, not glued to the prompt before it", { skip: !hasJq && "jq not installed" }, () => {
  const prompt = line({ role: "user", content: "Fix login" });
  assert.equal(readConversation([JSON.stringify(header), prompt, '{"type":"message","mess'], "").last.text, "Fix login");
  assert.equal(readConversation([JSON.stringify(header), prompt, line({ role: "assistant", content: [] }), '{"type"'], "").last.text, "Fix login");
  assert.equal(readConversation([prompt], "").last.text, "Fix login", "a complete last line without its newline still counts");
});

test("long messages are cut at 4000 characters", { skip: !hasJq && "jq not installed" }, () => {
  assert.equal(readConversation([JSON.stringify(header), line({ role: "user", content: "x".repeat(5000) })]).last.text.length, 4000);
});

test("a conversation without a user message yet has a start but no last prompt", { skip: !hasJq && "jq not installed" }, () => {
  assert.deepEqual(readConversation([JSON.stringify(header)]), { started: Date.parse(header.timestamp), last: null });
});

test("unparseable output is nothing", () => {
  assert.deepEqual(parseConversation("nope\n"), { started: null, last: null });
  assert.deepEqual(parseConversation('{"started":null}\n{"last":{"at":null,"text":"  "}}'), { started: null, last: null });
});

test("how long ago", () => {
  assert.equal(ago(20_000), "just now");
  assert.equal(ago(12 * 60_000), "12m");
  assert.equal(ago(84 * 60_000), "1h 24m");
  assert.equal(ago(120 * 60_000), "2h");
  assert.equal(ago((51 * 60) * 60_000), "2d 3h");
  assert.equal(ago(-5), "");
});

test("long messages show their first lines until expanded", () => {
  assert.deepEqual(preview("Fix it"), { short: "Fix it", cut: false });
  const lines = Array.from({ length: SHORT.lines + 1 }, (_, i) => `line ${i}`);
  assert.deepEqual(preview(lines.join("\n")), { short: `${lines.slice(0, SHORT.lines).join("\n")}…`, cut: true });
  const wide = preview("y".repeat(SHORT.chars + 100));
  assert.equal(wide.cut, true);
  assert.equal(wide.short.length, SHORT.chars + 1);
});

// --- The branch -----------------------------------------------------------------

test("change totals: the diff's files and lines, plus untracked files without lines", () => {
  const numstat = "3\t1\ta.js\x0010\t0\tdir/b.md\x00-\t-\timg.png\x00";
  assert.deepEqual(changeTotals(numstat, " M a.js\x00?? notes/new.md\x00"), { files: 4, add: 13, del: 1 });
  assert.deepEqual(changeTotals("", ""), { files: 0, add: 0, del: 0 });
});

test("a remote's web page from its URL; local paths and host aliases have none", () => {
  assert.equal(webBase("https://github.com/monoclonalAb/dotfiles"), "https://github.com/monoclonalAb/dotfiles");
  assert.equal(webBase("https://token@github.com/o/r.git"), "https://github.com/o/r");
  assert.equal(webBase("git@github.com:o/r.git"), "https://github.com/o/r");
  assert.equal(webBase("ssh://git@github.example.com:2222/o/r.git"), "https://github.example.com/o/r");
  assert.equal(webBase("git@github.com-work:o/r.git"), "https://github.com/o/r");
  assert.equal(webBase("work:o/r.git"), null, "an ssh alias without a dot");
  assert.equal(webBase("/srv/git/r.git"), null);
  assert.equal(webBase("file:///srv/git/r.git"), null);
  assert.equal(webBase(null), null);
  assert.equal(branchUrl("https://github.com/o/r", "eric/fix #2"), "https://github.com/o/r/tree/eric/fix%20%232");
});

const env = {
  ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};
const gitIn = (cwd) => async (args) => run("git", args, { cwd, env });
const sh = (cwd, ...args) => assert.equal(run("git", args, { cwd, env }).code, 0, `git ${args.join(" ")}`);
const commit = (cwd, file, text) => { writeFileSync(join(cwd, file), text); sh(cwd, "add", file); sh(cwd, "commit", "-q", "-m", file); };

test("a branch: commits since its fork from main, lines to the files on disk, uncommitted files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-git-"));
  try {
    const upstream = join(dir, "upstream"), work = join(dir, "work");
    sh(dir, "init", "-q", "-b", "main", upstream);
    commit(upstream, "a.txt", "one\n");
    sh(dir, "clone", "-q", upstream, work);
    sh(work, "switch", "-q", "-c", "fix-login");
    commit(work, "b.txt", "b\nb\n");
    commit(work, "c.txt", "c\n");
    // main moves on after the branch was made: not part of the branch.
    commit(upstream, "later.txt", "later\n");
    sh(work, "fetch", "-q");
    writeFileSync(join(work, "a.txt"), "two\n");
    writeFileSync(join(work, "new.txt"), "untracked\n");

    const facts = await branchFacts(gitIn(work));
    assert.equal(facts.branch, "fix-login");
    assert.equal(facts.main, "main");
    assert.equal(facts.onMain, false);
    assert.equal(facts.commits, 2);
    assert.deepEqual({ files: facts.files, add: facts.add, del: facts.del }, { files: 4, add: 4, del: 1 }, "b, c, the edit to a, and untracked new.txt (no lines yet)");
    assert.equal(facts.dirty, 2);
    assert.equal(facts.url, null, "not pushed: no link");
    assert.deepEqual(branchSummary(facts), { name: "fix-login", headline: "2 commits since main", stat: { files: "4 files", add: 4, del: 1 }, dirty: 2 });

    // Pushed: its upstream's page on the remote's website.
    sh(work, "push", "-q", "-u", "origin", "fix-login");
    sh(work, "remote", "set-url", "origin", "git@github.com:o/r.git");
    assert.equal((await branchFacts(gitIn(work))).url, "https://github.com/o/r/tree/fix-login");
    sh(work, "remote", "set-url", "origin", upstream);

    // On main: only unpushed commits count.
    sh(work, "stash", "-q", "-u");
    sh(work, "switch", "-q", "main");
    sh(work, "merge", "-q", "--ff-only", "origin/main");
    commit(work, "d.txt", "d\n");
    const main = await branchFacts(gitIn(work));
    assert.equal(main.onMain, true);
    assert.equal(branchSummary(main).headline, "1 commit not pushed");
    assert.equal(main.dirty, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("outside a repository, and before the first commit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-git-"));
  try {
    assert.deepEqual(await branchFacts(gitIn(dir)), { error: "Not a git repository" });
    sh(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, "a.txt"), "a\n");
    const facts = await branchFacts(gitIn(dir));
    assert.deepEqual(facts, { root: facts.root, branch: "main", url: null, empty: true, dirty: 1, files: 1, add: 0, del: 0 });
    assert.equal(branchSummary(facts).headline, "No commits yet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("branch wording without a remote or a main branch", () => {
  assert.equal(branchSummary({ branch: "main", main: "main", onMain: true, base: null, commits: null, files: 0, dirty: 0 }).headline, "No origin/main to compare with");
  assert.equal(branchSummary({ branch: "x", main: null, onMain: false, base: null, commits: null, files: 1, add: 1, del: 0, dirty: 0 }).headline, "No main branch to compare with");
  assert.equal(branchSummary({ branch: "x", main: "main", onMain: false, base: "abc", commits: 0, files: 0, dirty: 0 }).headline, "No commits since main yet");
  assert.equal(branchSummary({ branch: null, main: "main", onMain: false, base: "abc", commits: 1, files: 0, dirty: 0 }).name, "detached HEAD");
});

// --- The pull request -----------------------------------------------------------

const run_ = (name, conclusion, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion, detailsUrl: `https://ci/${name}` });

test("checks are bucketed as gh pr checks does", () => {
  assert.equal(checkBucket(run_("a", "SUCCESS")), "pass");
  assert.equal(checkBucket(run_("a", "FAILURE")), "fail");
  assert.equal(checkBucket(run_("a", "TIMED_OUT")), "fail");
  assert.equal(checkBucket(run_("a", "SKIPPED")), "skip");
  assert.equal(checkBucket(run_("a", "CANCELLED")), "skip");
  assert.equal(checkBucket(run_("a", "", "IN_PROGRESS")), "pending");
  assert.equal(checkBucket({ __typename: "StatusContext", context: "ci/x", state: "PENDING" }), "pending");
  assert.equal(checkBucket({ __typename: "StatusContext", context: "ci/x", state: "ERROR" }), "fail");
});

test("a pull request with its review and failing checks", () => {
  const pr = prFacts({
    number: 482, title: "Fix login spinner", state: "OPEN", isDraft: false, url: "https://github.com/o/r/pull/482",
    reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: [run_("lint", "SUCCESS"), run_("e2e / chromium", "FAILURE"), run_("build", "", "QUEUED"), run_("label", "SKIPPED"),
      { __typename: "StatusContext", context: "deploy/preview", state: "FAILURE", targetUrl: "https://deploy/1" }],
  });
  assert.deepEqual(pr, {
    number: 482, title: "Fix login spinner", state: "open", url: "https://github.com/o/r/pull/482", review: "Changes requested",
    checks: { pass: 1, fail: 2, pending: 1, skip: 1 },
    failing: [{ name: "e2e / chromium", url: "https://ci/e2e / chromium" }, { name: "deploy/preview", url: "https://deploy/1" }],
  });
  assert.equal(prFacts({ number: 1, state: "OPEN", isDraft: true, reviewDecision: "" }).state, "draft");
  assert.equal(prFacts({ number: 1, state: "MERGED" }).review, null);
  assert.equal(prFacts({ number: 0, state: "OPEN" }), null);
});

test("a re-run check counts once, as its latest run", () => {
  const failed = { ...run_("e2e", "FAILURE"), startedAt: "2026-11-06T09:00:00Z" };
  const rerun = { ...run_("e2e", "SUCCESS"), startedAt: "2026-11-06T09:30:00Z" };
  assert.deepEqual(latestChecks([failed, run_("lint", "SUCCESS"), rerun]), [rerun, run_("lint", "SUCCESS")]);
  assert.deepEqual(prFacts({ number: 5, state: "OPEN", statusCheckRollup: [failed, rerun] }).checks, { pass: 1, fail: 0, pending: 0, skip: 0 });
});

test("gh outcomes: found, none, or an error that keeps the last result", () => {
  assert.equal(prOutcome({ code: 0, stdout: JSON.stringify({ number: 3, state: "CLOSED", title: "x" }) }).pr.state, "closed");
  assert.deepEqual(prOutcome({ code: 1, stderr: "no pull requests found for branch \"x\"\n" }), { outcome: "none", pr: null });
  assert.deepEqual(prOutcome({ code: 1, stderr: "error connecting to api.github.com\ncheck your internet connection" }), { outcome: "error", detail: "error connecting to api.github.com" });
  assert.equal(prOutcome({ code: 0, stdout: "{}" }).outcome, "error");
});
