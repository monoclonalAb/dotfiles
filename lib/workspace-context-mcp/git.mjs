// Git metadata read directly from the .git directory so that indexing many
// repositories does not spawn a process per repository. Only `gitDetail`
// spawns git, and only for one repository at a time.

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Returns the git directory for a checkout, or null when it is not a checkout. */
export function locateGitDir(repoPath) {
  const dotGit = join(repoPath, ".git");
  let stat;
  try {
    stat = statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return { gitDir: dotGit, isWorktree: false };
  if (!stat.isFile()) return null;
  const text = readText(dotGit);
  const match = text && /^gitdir:\s*(.+)\s*$/m.exec(text);
  if (!match) return null;
  const target = match[1].trim();
  const gitDir = isAbsolute(target) ? target : resolve(repoPath, target);
  return { gitDir, isWorktree: true };
}

function resolveCommonDir(gitDir) {
  const text = readText(join(gitDir, "commondir"));
  if (!text) return gitDir;
  const target = text.trim();
  return isAbsolute(target) ? target : resolve(gitDir, target);
}

function resolveRef(commonDir, ref) {
  const loose = readText(join(commonDir, ref));
  if (loose) return loose.trim();
  const packed = readText(join(commonDir, "packed-refs"));
  if (!packed) return null;
  for (const line of packed.split("\n")) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref) return sha;
  }
  return null;
}

function readHead(gitDir, commonDir) {
  const text = readText(join(gitDir, "HEAD"));
  if (!text) return { branch: null, head: null };
  const trimmed = text.trim();
  const refMatch = /^ref:\s*(.+)$/.exec(trimmed);
  if (!refMatch) return { branch: null, head: trimmed.slice(0, 12) || null };
  const ref = refMatch[1].trim();
  const sha = resolveRef(commonDir, ref);
  return {
    branch: ref.replace(/^refs\/heads\//, ""),
    head: sha ? sha.slice(0, 12) : null,
  };
}

/** Parses the minimal INI subset used by .git/config and returns the origin URL. */
export function parseRemoteUrl(configText, remoteName = "origin") {
  if (!configText) return null;
  const remotes = new Map();
  let current = null;
  for (const raw of configText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const section = /^\[remote\s+"([^"]+)"\]$/.exec(line);
      current = section ? section[1] : null;
      continue;
    }
    if (!current) continue;
    const kv = /^url\s*=\s*(.+)$/.exec(line);
    if (kv && !remotes.has(current)) remotes.set(current, kv[1].trim());
  }
  if (remotes.has(remoteName)) return remotes.get(remoteName);
  const first = remotes.values().next();
  return first.done ? null : first.value;
}

/** Normalises common GitHub/GitLab URL shapes to "owner/repo". */
export function remoteSlug(url) {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, "").replace(/\/+$/, "");
  const ssh = /^[\w.-]+@[\w.-]+:(.+)$/.exec(cleaned);
  if (ssh) return ssh[1];
  const http = /^[a-z+]+:\/\/[^/]+\/(.+)$/i.exec(cleaned);
  if (http) return http[1];
  return null;
}

function listWorktrees(commonDir) {
  const mainPath = dirname(commonDir);
  const out = [];
  const registry = join(commonDir, "worktrees");
  if (!existsSync(registry)) return out;
  let entries = [];
  try {
    entries = readdirSync(registry, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wtGitDir = join(registry, entry.name);
    const gitdirText = readText(join(wtGitDir, "gitdir"));
    if (!gitdirText) continue;
    const dotGitPath = gitdirText.trim();
    const path = basename(dotGitPath) === ".git" ? dirname(dotGitPath) : dotGitPath;
    const present = existsSync(path);
    const { branch, head } = present ? readHead(wtGitDir, commonDir) : { branch: null, head: null };
    out.push({ path, branch, head, present, mainRepoPath: mainPath, isMain: false });
  }
  return out;
}

/**
 * Returns git metadata for a checkout without spawning git.
 * Fields: gitDir, commonDir, isWorktree, mainRepoPath, branch, head,
 * remoteUrl, remoteSlug, worktrees (linked worktrees registered on the main repo).
 */
export function readGitMeta(repoPath) {
  const located = locateGitDir(repoPath);
  if (!located) return null;
  const { gitDir, isWorktree } = located;
  const commonDir = isWorktree ? resolveCommonDir(gitDir) : gitDir;
  const mainRepoPath = dirname(commonDir);
  const { branch, head } = readHead(gitDir, commonDir);
  const remoteUrl = parseRemoteUrl(readText(join(commonDir, "config")));
  return {
    gitDir,
    commonDir,
    isWorktree,
    mainRepoPath,
    branch,
    head,
    remoteUrl,
    remoteSlug: remoteSlug(remoteUrl),
    worktrees: listWorktrees(commonDir),
  };
}

function runGit(cwd, args, timeoutMs = 8000) {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: gitEnv() },
      (error, stdout) => {
        if (error) resolvePromise(null);
        else resolvePromise(stdout);
      },
    );
  });
}

function gitEnv() {
  const base = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
  const current = process.env.PATH || "";
  return { ...process.env, PATH: current ? `${current}:${base}` : base, GIT_OPTIONAL_LOCKS: "0" };
}

/**
 * Spawns git for per-repository detail that cannot be read cheaply from files:
 * working-tree cleanliness, last commit, and upstream ahead/behind (no fetch).
 */
export async function gitDetail(repoPath) {
  const [status, log, upstream] = await Promise.all([
    runGit(repoPath, ["status", "--porcelain", "--untracked-files=normal"]),
    runGit(repoPath, ["log", "-1", "--format=%cI%n%h%n%s"]),
    runGit(repoPath, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
  ]);
  const detail = { available: status !== null || log !== null };
  if (status !== null) {
    const lines = status.split("\n").filter(Boolean);
    detail.dirtyFiles = lines.length;
    detail.untrackedFiles = lines.filter((line) => line.startsWith("??")).length;
    detail.changedSample = lines.slice(0, 10);
  }
  if (log) {
    const [date, sha, ...subject] = log.trim().split("\n");
    detail.lastCommit = { date, sha, subject: subject.join("\n") };
  }
  if (upstream) {
    const [ahead, behind] = upstream.trim().split(/\s+/).map(Number);
    detail.upstream = { ahead, behind };
  } else {
    detail.upstream = null;
  }
  return detail;
}
