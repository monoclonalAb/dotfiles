#!/usr/bin/python3
"""Live, read-only check of `review-analyse snapshot` against GitHub.

  /usr/bin/python3 lib/review-analyse/snapshot-live.py <pull request link>...

For each link: takes a snapshot (which fetches into ~/.cache/herdr-review/)
and compares its files and per-file +/- with `gh pr view --json files`
(GitHub stops that list at 100 files) and with GitHub's paginated file list
(all of them). Prints counts and every difference; exits 1 if any. Writes
nothing but the cache.
"""

import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def files(stdout_lines):
    return {f["path"]: (f["additions"], f["deletions"]) for f in map(json.loads, stdout_lines)}


def main(links):
    same = True
    for link in links:
        started = time.time()
        snap = subprocess.run([str(ROOT / "bin/review-analyse"), "snapshot", link], capture_output=True, text=True)
        if snap.returncode != 0:
            print(f"{link}: snapshot failed: {snap.stderr.strip()}")
            same = False
            continue
        snapshot = json.loads(snap.stdout)
        took = time.time() - started
        ours = {f["path"]: (f["additions"], f["deletions"]) for f in snapshot["files"]}
        owner, repo, _, number = link.rstrip("/").split("/")[-4:]
        view = subprocess.run(["gh", "pr", "view", link, "--json", "files", "--jq", ".files[] | {path, additions, deletions}"],
                              capture_output=True, text=True, check=True).stdout.splitlines()
        rest = subprocess.run(["gh", "api", f"repos/{owner}/{repo}/pulls/{number}/files", "--paginate",
                               "--jq", ".[] | {path: .filename, additions, deletions}"],
                              capture_output=True, text=True, check=True).stdout.splitlines()
        for name, theirs in (("gh pr view --json files", files(view)), ("GitHub's paginated list", files(rest))):
            listed = {p: ours[p] for p in theirs if p in ours}
            missing = sorted(set(theirs) - set(ours))
            counts = sorted(p for p in theirs if p in ours and ours[p] != theirs[p])
            extra = sorted(set(ours) - set(theirs)) if name.startswith("GitHub") else []
            print(f"{link}: snapshot {len(ours)} files in {took:.0f} s; {name} {len(theirs)}: "
                  f"{len(listed)} listed, {len(missing)} missing, {len(extra)} extra, {len(counts)} with other +/-")
            for p in missing + extra + counts:
                print(f"  {p}: ours {ours.get(p)}, GitHub {theirs.get(p)}")
            same = same and not missing and not extra and not counts
    print("same files" if same else "DIFFERENT")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
