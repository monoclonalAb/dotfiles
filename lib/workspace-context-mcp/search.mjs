// Full-text search over the indexed markdown corpus (in-process) and over
// repository code via ripgrep when it is installed (bounded and time-limited).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RG_CANDIDATES = ["/opt/homebrew/bin/rg", "/usr/local/bin/rg", "/usr/bin/rg", join(homedir(), ".cargo", "bin", "rg")];

export function tokenise(query) {
  return [...new Set(
    (query || "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}_@/.-]+/u)
      .map((token) => token.replace(/^[./-]+|[./-]+$/g, ""))
      .filter((token) => token.length >= 2),
  )];
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    if (count > 200) break;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function matchingLines(text, tokens, maxLines) {
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < maxLines; i += 1) {
    const lower = lines[i].toLowerCase();
    const matched = tokens.filter((token) => lower.includes(token));
    if (!matched.length) continue;
    hits.push({ line: i + 1, matched: matched.length, text: lines[i].trim().slice(0, 240) });
  }
  return hits.sort((a, b) => b.matched - a.matched || a.line - b.line).slice(0, maxLines).sort((a, b) => a.line - b.line);
}

/**
 * Ranks documents that contain every query token (AND). Score favours
 * multiple occurrences, title/path matches, and short agent-facing files.
 */
export function searchDocuments(documents, query, { repo = null, layer = null, limit = 20, linesPerDoc = 4 } = {}) {
  const tokens = tokenise(query);
  if (!tokens.length) return { tokens, hits: [] };
  const phrase = query.trim().toLowerCase();
  const results = [];
  for (const doc of documents) {
    if (repo && (doc.repo || "").toLowerCase() !== repo.toLowerCase()) continue;
    if (layer && (doc.layer || "") !== layer) continue;
    let score = 0;
    let allPresent = true;
    for (const token of tokens) {
      const count = countOccurrences(doc.lower, token);
      if (!count) {
        allPresent = false;
        break;
      }
      score += Math.log1p(count);
      const titleLower = (doc.title || "").toLowerCase();
      if (titleLower.includes(token)) score += 2;
      if (doc.relPath.toLowerCase().includes(token)) score += 1.5;
      if ((doc.repo || "").toLowerCase().includes(token)) score += 1;
    }
    if (!allPresent) continue;
    if (tokens.length > 1 && phrase.length > 3 && doc.lower.includes(phrase)) score += 3;
    if (/^(agents|claude|readme)\.md$/i.test(doc.relPath)) score += 0.5;
    score -= Math.min(1.5, doc.bytes / 200000);
    results.push({ doc, score });
  }
  results.sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
  return {
    tokens,
    total: results.length,
    hits: results.slice(0, limit).map(({ doc, score }) => ({
      repo: doc.repo,
      layer: doc.layer || null,
      path: doc.path,
      relPath: doc.relPath,
      title: doc.title,
      score: Number(score.toFixed(2)),
      lines: matchingLines(doc.text, tokens, linesPerDoc),
    })),
  };
}

export function findRipgrep(env = process.env) {
  if (env.WORKSPACE_CONTEXT_RG && existsSync(env.WORKSPACE_CONTEXT_RG)) return env.WORKSPACE_CONTEXT_RG;
  for (const dir of (env.PATH || "").split(":")) {
    if (dir && existsSync(join(dir, "rg"))) return join(dir, "rg");
  }
  return RG_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

/**
 * Runs ripgrep over the given directories with sensible exclusions. Output is
 * capped at `limit` matches; the process is killed once enough has arrived.
 */
export function searchCode(paths, query, { limit = 40, timeoutMs = 10000, rg = findRipgrep(), caseSensitive = false, glob = null } = {}) {
  return new Promise((resolvePromise) => {
    if (!rg) {
      resolvePromise({ available: false, reason: "ripgrep (rg) not found on PATH or in known locations", hits: [] });
      return;
    }
    const args = [
      "--json", "--max-count", "5", "--max-columns", "240", "--max-filesize", "2M",
      "--glob", "!node_modules", "--glob", "!dist", "--glob", "!build", "--glob", "!coverage",
      "--glob", "!*.lock", "--glob", "!pnpm-lock.yaml", "--glob", "!package-lock.json", "--glob", "!*.min.*",
      "--glob", "!.git", "--glob", "!*.map", "--glob", "!__recordings__", "--glob", "!*.snap",
    ];
    if (!caseSensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    args.push("-e", query, "--", ...paths);
    const child = spawn(rg, args, { stdio: ["ignore", "pipe", "pipe"] });
    const hits = [];
    let buffer = "";
    let truncated = false;
    let stderr = "";
    const timer = setTimeout(() => {
      truncated = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type !== "match") continue;
        const data = event.data;
        hits.push({
          path: data.path.text ?? data.path.bytes ?? "",
          line: data.line_number,
          text: (data.lines.text ?? "").replace(/\n$/, "").trim().slice(0, 240),
        });
        if (hits.length >= limit) {
          truncated = true;
          child.kill("SIGKILL");
          break;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    const finish = (code) => {
      clearTimeout(timer);
      resolvePromise({
        available: true,
        rg,
        truncated,
        exitCode: code,
        stderr: stderr.trim() || null,
        hits: hits.slice(0, limit),
      });
    };
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ available: false, reason: error.message, hits: [] });
    });
    child.on("close", finish);
  });
}
