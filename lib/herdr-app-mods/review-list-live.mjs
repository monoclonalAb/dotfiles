// node lib/herdr-app-mods/review-list-live.mjs [--json FILE]
// Live, read-only check of Review mode's pull request list: loads your open
// pull requests the way review-nav does, with the real `gh`, and compares
// each section with `gh search prs`. Reads GitHub; writes nothing, except the
// loaded list to FILE when asked (for rendering checks; keep it outside the
// repository). Exits 1 if a section differs.
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { loadMod } from "./load.mjs";

const { loadPullRequests, recheckUnknown, CHIPS } = await loadMod("review-nav");
const gh = (args) => new Promise((resolve) => {
  execFile("gh", args, { maxBuffer: 256 << 20 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
});

let list = await loadPullRequests(gh);
// As review-nav does: ask again for merge verdicts GitHub hadn't worked out.
for (const wait of [5000, 10000, 20000]) {
  const unknown = list.sections.flatMap((s) => s.prs).filter((p) => p.mergeState === "UNKNOWN").length;
  console.log(`UNKNOWN merge verdicts: ${unknown}`);
  if (!unknown) break;
  await new Promise((resolve) => setTimeout(resolve, wait));
  ({ list } = await recheckUnknown(gh, list));
}
const FLAGS = { review: "--review-requested=@me", mine: "--author=@me" };
let same = true;
for (const s of list.sections) {
  const r = await gh(["search", "prs", FLAGS[s.key], "--state=open", "--archived=false", "--limit", "1000", "--json", "url"]);
  if (r.code !== 0) throw new Error(r.stderr);
  const want = new Set(JSON.parse(r.stdout).map((p) => p.url));
  const got = new Set(s.prs.map((p) => p.url));
  const missing = [...want].filter((u) => !got.has(u));
  const extra = [...got].filter((u) => !want.has(u));
  const chips = Object.entries(Object.groupBy(s.prs, (p) => CHIPS[p.chip])).map(([c, ps]) => `${c} ${ps.length}`).join(", ");
  console.log(`${s.title}: review-nav ${got.size}, gh search prs ${want.size}, missing ${missing.length}, extra ${extra.length}; more ${s.more}, incomplete ${s.incomplete}; ${chips}`);
  for (const u of missing) console.log(`  missing ${u}`);
  for (const u of extra) console.log(`  extra ${u}`);
  same &&= !missing.length && !extra.length;
}
const flag = process.argv.indexOf("--json");
if (flag > 0) writeFileSync(process.argv[flag + 1], JSON.stringify(list));
console.log(same ? "same pull requests" : "DIFFERENT");
process.exit(same ? 0 : 1);
