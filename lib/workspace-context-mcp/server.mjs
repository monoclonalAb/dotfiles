#!/usr/bin/env node
// Workspace Context MCP server entry point and diagnostic CLI.
//
//   workspace-context-mcp [serve]                 stdio MCP server (default)
//   workspace-context-mcp tools                   list tool names and descriptions
//   workspace-context-mcp call <tool> [json]      run one tool and print its JSON
//   workspace-context-mcp index [--json]          build the index; print stats or the full index
//   workspace-context-mcp doctor                  environment and timing report
//
// Options: --root <path> (repeatable; overrides WORKSPACE_CONTEXT_ROOTS),
//          --depth <n>, --ttl <seconds>, --debug

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MAX_DEPTH, defaultRoots } from "./indexer.mjs";
import { createMcpDispatcher, serveStdio } from "./protocol.mjs";
import { findRipgrep } from "./search.mjs";
import { TOOL_DEFINITIONS, createIndexProvider, createToolHandlers } from "./tools.mjs";

export const SERVER_INFO = { name: "workspace-context", version: "0.1.0" };
export const INSTRUCTIONS =
  "Read-only index of local repositories, worktrees, agent docs, manifests and integrations. " +
  "Call get_workspace_overview first, then list_repositories or get_repository_context <name>. " +
  "Use find_repositories_by_stack for technology questions, get_related_de_context for Digital Employee " +
  "catalogue tier/card context, and search_workspace for documentation or ripgrep code search. " +
  "Nothing here writes to disk or the network.";

function parseArgs(argv) {
  const options = { command: "serve", roots: null, depth: null, ttl: null, debug: false, json: false, rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      options.roots = options.roots || [];
      options.roots.push(argv[++i]);
    } else if (arg.startsWith("--root=")) {
      options.roots = options.roots || [];
      options.roots.push(arg.slice("--root=".length));
    } else if (arg === "--depth") options.depth = Number(argv[++i]);
    else if (arg.startsWith("--depth=")) options.depth = Number(arg.slice("--depth=".length));
    else if (arg === "--ttl") options.ttl = Number(argv[++i]);
    else if (arg.startsWith("--ttl=")) options.ttl = Number(arg.slice("--ttl=".length));
    else if (arg === "--debug") options.debug = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.command = "help";
    else if (!arg.startsWith("-") && options.command === "serve" && options.rest.length === 0 && ["serve", "tools", "call", "index", "doctor", "help"].includes(arg)) {
      options.command = arg;
    } else options.rest.push(arg);
  }
  return options;
}

function makeLogger(debug) {
  return (message) => {
    if (debug || process.env.WORKSPACE_CONTEXT_DEBUG === "1") process.stderr.write(`[workspace-context] ${message}\n`);
  };
}

export function createServer(options = {}) {
  const roots = options.roots && options.roots.length ? options.roots : defaultRoots();
  const maxDepth = Number.isFinite(options.depth) && options.depth > 0 ? options.depth : Number(process.env.WORKSPACE_CONTEXT_DEPTH) || DEFAULT_MAX_DEPTH;
  const ttlSeconds = Number.isFinite(options.ttl) ? options.ttl : Number(process.env.WORKSPACE_CONTEXT_TTL_SECONDS) || 300;
  const log = options.log || makeLogger(options.debug);
  const provider = createIndexProvider({ roots, maxDepth, ttlSeconds, log });
  const handlers = createToolHandlers(provider);
  const dispatcher = createMcpDispatcher({ serverInfo: SERVER_INFO, instructions: INSTRUCTIONS, tools: TOOL_DEFINITIONS, handlers, log });
  return { provider, handlers, dispatcher, log, roots, maxDepth, ttlSeconds };
}

function usage() {
  const here = dirname(fileURLToPath(import.meta.url));
  const header = readFileSync(join(here, "server.mjs"), "utf8").split("\n").slice(1, 12).map((line) => line.replace(/^\/\/ ?/, "")).join("\n");
  return `${header}\n`;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === "help") {
    process.stdout.write(usage());
    return 0;
  }
  const server = createServer(options);
  switch (options.command) {
    case "serve": {
      server.log(`serving ${SERVER_INFO.name} ${SERVER_INFO.version}; roots=${server.roots.join(":")}`);
      await serveStdio(server.dispatcher, { log: server.log });
      return 0;
    }
    case "tools": {
      for (const tool of TOOL_DEFINITIONS) process.stdout.write(`${tool.name}\n    ${tool.description}\n\n`);
      return 0;
    }
    case "call": {
      const [name, rawArgs] = options.rest;
      if (!name || !server.handlers[name]) {
        process.stderr.write(`Unknown tool "${name ?? ""}". Available: ${TOOL_DEFINITIONS.map((t) => t.name).join(", ")}\n`);
        return 2;
      }
      let args = {};
      if (rawArgs) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          // Convenience: a bare string becomes the tool's first required argument.
          const first = TOOL_DEFINITIONS.find((t) => t.name === name);
          const key = first && first.inputSchema.required ? first.inputSchema.required[0] : "query";
          args = { [key]: rawArgs };
        }
      }
      let result;
      try {
        result = await server.handlers[name](args);
      } catch (error) {
        // Same shape the MCP dispatcher reports as an isError tool result.
        result = { error: error && error.message ? error.message : String(error) };
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result && typeof result === "object" && result.error ? 1 : 0;
    }
    case "index": {
      const index = server.provider.get();
      if (options.json) {
        const serialisable = {
          ...index,
          documents: index.documents.map(({ text, lower, ...rest }) => rest),
          layers: index.layers.map((layer) => ({ ...layer, cards: [...layer.cards.keys()], catalogue: layer.catalogue ? { path: layer.catalogue.path, repositories: [...layer.catalogue.rows.keys()] } : null })),
        };
        process.stdout.write(`${JSON.stringify(serialisable, null, 2)}\n`);
      } else {
        process.stdout.write(`built ${index.builtAt} in ${index.durationMs}ms\nroots: ${index.roots.join(", ")}\nrepositories: ${index.repos.length}\ndocuments: ${index.documents.length}\nlayers: ${index.layers.map((layer) => `${layer.name} (${layer.cards.size} cards)`).join(", ") || "none"}\n`);
        for (const repo of index.repos) {
          const tier = repo.layerContext && repo.layerContext.tier ? ` [${repo.layerContext.tier}]` : "";
          process.stdout.write(`  ${repo.group}/${repo.name}${repo.kind !== "repo" ? ` (${repo.kind})` : ""}${tier} ${repo.git && repo.git.branch ? `@${repo.git.branch}` : ""}\n`);
        }
      }
      return 0;
    }
    case "doctor": {
      const rg = findRipgrep();
      const started = Date.now();
      const index = server.provider.get();
      const report = {
        node: process.version,
        executable: process.execPath,
        roots: server.roots,
        maxDepth: server.maxDepth,
        ttlSeconds: server.ttlSeconds,
        ripgrep: rg || "not found",
        indexBuildMs: Date.now() - started,
        repositories: index.repos.length,
        worktrees: index.repos.filter((repo) => repo.kind === "worktree").length,
        projectsWithoutGit: index.repos.filter((repo) => repo.kind === "project").length,
        documents: index.documents.length,
        layers: index.layers.map((layer) => ({ name: layer.name, cards: layer.cards.size, catalogueRows: layer.catalogue ? layer.catalogue.rows.size : 0, guides: layer.guides.length })),
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    default:
      process.stderr.write(usage());
      return 2;
  }
}

// Compare real paths: the launcher passes a symlinked, un-normalised argv[1]
// (~/.local/bin/../lib/...) while import.meta.url is the resolved file.
function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}
const invokedDirectly = Boolean(process.argv[1]) && samePath(fileURLToPath(import.meta.url), process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`workspace-context-mcp: ${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    },
  );
}
