// MCP tool definitions and handlers. Every handler is read-only and returns a
// plain object that the server serialises as pretty JSON text.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import { gitDetail } from "./git.mjs";
import { buildIndex, customerKey, findRepo, layerByName, suggestRepos } from "./indexer.mjs";
import { findRipgrep, searchCode, searchDocuments } from "./search.mjs";

const DEFAULT_TTL_SECONDS = 300;
const MAX_INLINE_DOC_BYTES = 24 * 1024;
const MAX_READ_BYTES = 96 * 1024;
const MAX_READ_LINES = 400;
// Credential-shaped file names. Deliberately narrow: source files that merely
// mention tokens or secrets stay readable; `.env.example` stays readable.
const DENIED_FILE_PATTERNS = [
  /^\.env(\.(?!example$|sample$|template$)[^/]+)?$/i, /\.(pem|key|p12|pfx|jks|keychain)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i, /^auth\.json$/i, /^hosts\.yml$/i, /^models-store\.json$/i,
  /credentials?[^/]*\.json$/i, /service[-_]?account[^/]*\.json$/i, /tokens?\.json$/i, /secrets?\.(json|ya?ml|toml)$/i,
  /^\.netrc$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.zsh_history$/i, /^\.bash_history$/i, /^access_tokens\.md$/i,
];

export function createIndexProvider({ roots, maxDepth, ttlSeconds = DEFAULT_TTL_SECONDS, log = () => {} } = {}) {
  let index = null;
  const build = () => {
    index = buildIndex({ roots, maxDepth });
    log(`index built: ${index.repos.length} repos, ${index.documents.length} docs, ${index.durationMs}ms`);
    return index;
  };
  return {
    get() {
      if (!index) return build();
      const ageMs = Date.now() - Date.parse(index.builtAt);
      if (ttlSeconds > 0 && ageMs > ttlSeconds * 1000) return build();
      return index;
    },
    refresh: build,
    ttlSeconds,
  };
}

function compactRepo(repo) {
  return {
    name: repo.name,
    group: repo.group,
    kind: repo.kind,
    tier: repo.layerContext ? repo.layerContext.tier : null,
    summary: repo.summary,
    branch: repo.git ? repo.git.branch : null,
    integrations: repo.integrations.slice(0, 8),
    stack: repo.stack.filter((tag) => !/^(node|typescript|services-layer|workflows-layer|github-actions)$/.test(tag)).slice(0, 10),
    worktrees: repo.git ? repo.git.worktrees.filter((wt) => wt.present).length : 0,
    path: repo.path,
  };
}

function notFound(index, query) {
  const suggestions = suggestRepos(index, query);
  return {
    error: `Repository "${query}" not found in the workspace index.`,
    suggestions,
    hint: "Use list_repositories to see indexed names; names match directory, remote slug or package name.",
  };
}

function relatedRepos(index, repo) {
  const key = customerKey(repo.name);
  const sameCustomer = index.repos
    .filter((other) => other.name !== repo.name && customerKey(other.name) === key && other.kind !== "worktree")
    .map((other) => ({ name: other.name, summary: other.summary, tier: other.layerContext ? other.layerContext.tier : null }));
  const worktrees = repo.git ? repo.git.worktrees.filter((wt) => wt.present).map(({ path, branch, head }) => ({ path, branch, head })) : [];
  const mainRepo = repo.git && repo.git.isWorktree ? index.repos.find((other) => other.path === repo.git.mainRepoPath) : null;
  return {
    customerKey: key,
    sameCustomer,
    worktrees,
    mainRepo: mainRepo ? { name: mainRepo.name, path: mainRepo.path, branch: mainRepo.git ? mainRepo.git.branch : null } : null,
  };
}

function platformDependencies(index, repo) {
  // Repositories in the same workspace that this repo depends on by package
  // name, workflow marker or copied skill (for example perform-dangerous-action).
  const deps = new Set([
    ...((repo.manifests.packageJson && repo.manifests.packageJson.dependencies) || []),
    ...((repo.manifests.packageJson && repo.manifests.packageJson.devDependencies) || []),
  ]);
  const markers = new Set((repo.manifests.githubWorkflows || []).flatMap((wf) => wf.markers));
  const skills = new Set(repo.docs.skills.map((skill) => skill.name));
  const out = [];
  for (const other of index.repos) {
    if (other.name === repo.name || other.kind === "worktree") continue;
    const evidence = [];
    const pkgName = other.manifests.packageJson && other.manifests.packageJson.name;
    if (pkgName && deps.has(pkgName)) evidence.push(`dependency ${pkgName}`);
    for (const dep of deps) if (dep.endsWith(`/${other.name}`) || dep === other.name) evidence.push(`dependency ${dep}`);
    if (markers.has(other.name)) evidence.push(`GitHub workflow uses ${other.name}`);
    if (skills.has(other.name)) evidence.push(`skill ${other.name} copied locally`);
    if (evidence.length) out.push({ name: other.name, evidence: [...new Set(evidence)] });
  }
  return out;
}

function inlineDoc(repo, relPath, maxBytes = MAX_INLINE_DOC_BYTES) {
  if (!relPath) return null;
  const path = resolve(repo.path, relPath);
  try {
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text) <= maxBytes) return { path, text, truncated: false };
    return { path, text: `${text.slice(0, maxBytes)}\n\n[truncated: read ${path} for the remainder]`, truncated: true };
  } catch (error) {
    return { path, error: error.message };
  }
}

function stackEvidence(repo, token) {
  const evidence = [];
  const lower = token.toLowerCase();
  const push = (label, strength) => evidence.push({ label, strength });
  for (const tag of repo.stack) if (tag.toLowerCase().includes(lower)) push(`stack tag ${tag}`, 3);
  for (const name of repo.integrations) if (name.toLowerCase().includes(lower)) push(`integration ${name}`, 3);
  for (const service of repo.structure.services) if (service.name.toLowerCase().includes(lower)) push(`${service.dir}/${service.name}`, 3);
  for (const workflow of repo.structure.workflows) if (workflow.name.toLowerCase().includes(lower)) push(`${workflow.dir}/${workflow.name}`, 2);
  const pkg = repo.manifests.packageJson;
  if (pkg) {
    for (const dep of [...pkg.dependencies, ...pkg.devDependencies]) if (dep.toLowerCase().includes(lower)) push(`dependency ${dep}`, 3);
  }
  if (repo.manifests.pyproject) {
    for (const dep of repo.manifests.pyproject.dependencies) if (dep.toLowerCase().includes(lower)) push(`python dependency ${dep}`, 3);
  }
  for (const key of repo.manifests.envExampleKeys || []) if (key.toLowerCase().includes(lower)) push(`.env.example key ${key}`, 2);
  for (const skill of repo.docs.skills) if (skill.name.toLowerCase().includes(lower)) push(`skill ${skill.name}`, 2);
  for (const marker of repo.manifests.present) if (marker.toLowerCase().includes(lower)) push(`file ${marker}`, 2);
  if (repo.manifests.everyday && `${repo.manifests.everyday.projectName || ""}`.toLowerCase().includes(lower)) push(`.everyday.json project ${repo.manifests.everyday.projectName}`, 2);
  if (repo.manifests.dockerfile && `${repo.manifests.dockerfile.baseImage || ""}`.toLowerCase().includes(lower)) push(`Dockerfile FROM ${repo.manifests.dockerfile.baseImage}`, 2);
  if (repo.name.toLowerCase().includes(lower)) push("repository name", 1);
  return evidence;
}

function docMentions(documents, repoName, token) {
  const lower = token.toLowerCase();
  const mentions = [];
  for (const doc of documents) {
    const ownDoc = doc.repo === repoName;
    const cardDoc = doc.cardFor && doc.cardFor.toLowerCase() === repoName.toLowerCase();
    if (!ownDoc && !cardDoc) continue;
    if (!doc.lower.includes(lower)) continue;
    let count = 0;
    let idx = doc.lower.indexOf(lower);
    while (idx !== -1 && count < 50) {
      count += 1;
      idx = doc.lower.indexOf(lower, idx + lower.length);
    }
    mentions.push({ relPath: cardDoc ? `${doc.layer} card ${doc.relPath}` : doc.relPath, count });
  }
  return mentions.sort((a, b) => b.count - a.count).slice(0, 3);
}

function allowedBases(index) {
  const bases = new Set(index.roots);
  for (const repo of index.repos) {
    bases.add(repo.path);
    if (repo.git) for (const wt of repo.git.worktrees) if (wt.present) bases.add(wt.path);
  }
  return [...bases].map((base) => {
    try {
      return realpathSync(base);
    } catch {
      return base;
    }
  });
}

function resolveWorkspacePath(index, input) {
  if (!input || typeof input !== "string") throw new Error("path is required");
  let candidate = input;
  if (!isAbsolute(candidate)) {
    const [head, ...rest] = candidate.split("/");
    const repo = findRepo(index, head);
    if (!repo) throw new Error(`Relative paths must start with an indexed repository name; "${head}" is not indexed`);
    candidate = resolve(repo.path, rest.join("/"));
  }
  const real = realpathSync(candidate);
  const bases = allowedBases(index);
  if (!bases.some((base) => real === base || real.startsWith(base + sep))) {
    throw new Error("Path is outside the indexed workspace roots and worktrees");
  }
  const name = basename(real);
  if (DENIED_FILE_PATTERNS.some((pattern) => pattern.test(name)) || real.split(sep).includes(".git")) {
    throw new Error("Refusing to read credential-like or git-internal files");
  }
  return real;
}

export const TOOL_DEFINITIONS = [
  {
    name: "get_workspace_overview",
    title: "Workspace overview",
    description:
      "Start here. Summarises the indexed workspace: roots, repository groups and counts, Digital Employee " +
      "tiers, the workspace-level AGENTS.md and topic guides, and which tool to call next.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_repositories",
    title: "List repositories",
    description:
      "Compact table of indexed repositories, worktrees and manifest-bearing project directories. Filter by " +
      "group (e.g. DE, personal, dotfiles), tier (Canon, Tier 1..3), kind (repo|worktree|project), stack tag " +
      "or a name substring. Use the returned name with get_repository_context.",
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "string", description: "Only repositories in this group (directory under a root)." },
        tier: { type: "string", description: "Substring match on the DE catalogue tier, e.g. 'Tier 1' or 'Canon'." },
        kind: { type: "string", enum: ["repo", "worktree", "project"] },
        stack: { type: "string", description: "Only repositories whose stack tags or integrations include this substring." },
        query: { type: "string", description: "Case-insensitive substring on the repository name or summary." },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_repository_context",
    title: "Get repository context",
    description:
      "Everything the index knows about one repository: git branch/head/remote/worktrees, AGENTS/README/docs " +
      "inventory, skills, manifests (package.json, pyproject, .everyday.json, mise, Dockerfile, GitHub " +
      "workflows), service/workflow/route directories, stack tags, integrations and the DE catalogue entry. " +
      "Set include to inline AGENTS.md or README text, or to run git for status and last commit.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Directory name, owner/repo slug, package name or absolute path." },
        include: {
          type: "array",
          items: { type: "string", enum: ["agents", "readme", "git"] },
          description: "Optional extras: 'agents' and 'readme' inline those files (bounded); 'git' spawns git for status, last commit and upstream ahead/behind (no fetch).",
        },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "find_repositories_by_stack",
    title: "Find repositories by stack or integration",
    description:
      "Find repositories that use a technology, service or integration, e.g. 'VaultRE', 'firestore', 'hono " +
      "gemini', 'hubspot'. Matches stack tags, integrations, src/services and src/workflows names, " +
      "dependencies, .env.example keys, skills and manifest markers (strong evidence) and README/AGENTS/docs " +
      "mentions (weak evidence). Each result lists its evidence so you can judge the match.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "One or more terms separated by spaces or commas." },
        match: { type: "string", enum: ["all", "any"], default: "all", description: "Require all terms (default) or any term." },
        includeDocMentions: { type: "boolean", default: true, description: "Also count mentions in indexed markdown as weak evidence." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_related_de_context",
    title: "Get related Digital Employee context",
    description:
      "For a repository inside a workspace layer (a root such as ~/Desktop/projects/DE with AGENTS.md and " +
      "agents/), returns the catalogue row and recency tier, the per-repo analysis card, the topic guides to " +
      "read, sibling repositories for the same customer, git worktrees, and workspace platform repositories " +
      "it depends on (deploy-guardian, perform-dangerous-action, prompt-behemoth, ...). For repositories with " +
      "no layer it says so and points at the repo's own AGENTS.md/README instead.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Directory name, owner/repo slug, package name or absolute path." },
        includeCard: { type: "boolean", default: true, description: "Inline the agents/repos/<repo>.md card text (bounded)." },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
  {
    name: "search_workspace",
    title: "Search the workspace",
    description:
      "Full-text search. scope 'docs' (default) ranks indexed markdown (AGENTS.md, README, docs/**, skills, " +
      "workspace guides, catalogue and cards) requiring every term; scope 'code' runs ripgrep across " +
      "repository files (regex, case-insensitive, bounded); scope 'all' does both. Optionally restrict to one repo.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["docs", "code", "all"], default: "docs" },
        repo: { type: "string", description: "Restrict to one repository (name, slug or path)." },
        glob: { type: "string", description: "Code scope only: ripgrep --glob filter such as '*.ts' or 'src/services/**'." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_worktrees",
    title: "List git worktrees",
    description:
      "All git worktrees known to indexed repositories, including linked worktrees outside the roots (for " +
      "example under ~/.herdr/worktrees), with branch, head and whether the directory is present.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", description: "Restrict to one repository." } },
      additionalProperties: false,
    },
  },
  {
    name: "read_workspace_file",
    title: "Read a workspace file",
    description:
      "Read a text file inside the indexed roots or worktrees, by absolute path or '<repo>/<relative path>'. " +
      "Line-oriented with offset/limit; refuses credential-like files (.env, keys, tokens) and .git internals.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 1, default: 1, description: "1-based first line." },
        limit: { type: "integer", minimum: 1, maximum: MAX_READ_LINES, default: 200 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "refresh_index",
    title: "Refresh the index",
    description: "Rebuild the workspace index now (it otherwise refreshes automatically after the TTL). Returns build statistics.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function createToolHandlers(provider) {
  const handlers = {
    async get_workspace_overview() {
      const index = provider.get();
      const groups = {};
      const tiers = {};
      const kinds = {};
      for (const repo of index.repos) {
        groups[repo.group] = (groups[repo.group] || 0) + 1;
        kinds[repo.kind] = (kinds[repo.kind] || 0) + 1;
        const tier = repo.layerContext && repo.layerContext.tier;
        if (tier) tiers[tier] = (tiers[tier] || 0) + 1;
      }
      return {
        builtAt: index.builtAt,
        indexAgeSeconds: Math.round((Date.now() - Date.parse(index.builtAt)) / 1000),
        ttlSeconds: provider.ttlSeconds,
        roots: index.roots,
        repositories: index.repos.length,
        documents: index.documents.length,
        groups,
        kinds,
        tiers,
        layers: index.layers.map((layer) => ({
          name: layer.name,
          path: layer.path,
          agentsFile: layer.agentsFile ? { path: layer.agentsFile.path, title: layer.agentsFile.title, summary: layer.agentsFile.summary, sections: layer.agentsFile.sections } : null,
          catalogue: layer.catalogue ? { path: layer.catalogue.path, repositories: layer.catalogue.rows.size } : null,
          cards: layer.cards.size,
          guides: layer.guides.map((guide) => ({ name: guide.name, path: guide.path, title: guide.title, summary: guide.summary })),
        })),
        ripgrep: findRipgrep() ? "available" : "not found (search_workspace scope=code unavailable)",
        nextSteps: [
          "list_repositories to see names; get_repository_context <name> for one repo",
          "find_repositories_by_stack <term> to locate technology or integration usage",
          "get_related_de_context <name> for catalogue tier, card and platform links",
          "search_workspace <terms> for documentation; scope=code for ripgrep",
        ],
      };
    },

    async list_repositories({ group, tier, kind, stack, query, limit = 200 } = {}) {
      const index = provider.get();
      const lowerQuery = query ? query.toLowerCase() : null;
      const lowerStack = stack ? stack.toLowerCase() : null;
      const rows = index.repos
        .filter((repo) => !group || repo.group.toLowerCase() === group.toLowerCase())
        .filter((repo) => !kind || repo.kind === kind)
        .filter((repo) => !tier || ((repo.layerContext && repo.layerContext.tier) || "").toLowerCase().includes(tier.toLowerCase()))
        .filter((repo) => !lowerStack || repo.stack.some((tag) => tag.includes(lowerStack)) || repo.integrations.some((name) => name.toLowerCase().includes(lowerStack)))
        .filter((repo) => !lowerQuery || repo.name.toLowerCase().includes(lowerQuery) || (repo.summary || "").toLowerCase().includes(lowerQuery))
        .slice(0, limit)
        .map(compactRepo);
      return { count: rows.length, total: index.repos.length, repositories: rows };
    },

    async get_repository_context({ repo: query, include = [] } = {}) {
      const index = provider.get();
      const repo = findRepo(index, query);
      if (!repo) return notFound(index, query);
      const layer = repo.layerName ? layerByName(index, repo.layerName) : null;
      const result = {
        name: repo.name,
        path: repo.path,
        group: repo.group,
        kind: repo.kind,
        summary: repo.summary,
        git: repo.git,
        docs: {
          agents: repo.docs.agents.map((relPath) => resolve(repo.path, relPath)),
          readme: repo.docs.readme ? resolve(repo.path, repo.docs.readme) : null,
          files: repo.docs.files,
          skills: repo.docs.skills.map(({ name, relPath, description }) => ({ name, relPath, description })),
        },
        manifests: repo.manifests,
        structure: repo.structure,
        stack: repo.stack,
        integrations: repo.integrations,
        workspaceLayer: layer
          ? { name: layer.name, agentsFile: layer.agentsFile ? layer.agentsFile.path : null, context: repo.layerContext }
          : null,
        related: relatedRepos(index, repo),
      };
      const wanted = new Set(Array.isArray(include) ? include : []);
      if (wanted.has("agents")) result.agentsText = inlineDoc(repo, repo.docs.agents[0]);
      if (wanted.has("readme")) result.readmeText = inlineDoc(repo, repo.docs.readme);
      if (wanted.has("git") && repo.git) result.gitDetail = await gitDetail(repo.path);
      return result;
    },

    async find_repositories_by_stack({ query, match = "all", includeDocMentions = true, limit = 50 } = {}) {
      const index = provider.get();
      const tokens = [...new Set((query || "").split(/[\s,]+/).map((t) => t.trim()).filter((t) => t.length >= 2))];
      if (!tokens.length) return { error: "query must contain at least one term of two or more characters" };
      const results = [];
      for (const repo of index.repos) {
        if (repo.kind === "worktree") continue;
        let score = 0;
        const matchedTerms = [];
        const evidence = [];
        for (const token of tokens) {
          const strong = stackEvidence(repo, token);
          const weak = includeDocMentions ? docMentions(index.documents, repo.name, token) : [];
          if (!strong.length && !weak.length) continue;
          matchedTerms.push(token);
          score += strong.reduce((sum, item) => sum + item.strength, 0) + weak.reduce((sum, item) => sum + Math.min(1, item.count / 3), 0);
          for (const item of strong.slice(0, 6)) evidence.push(`${token}: ${item.label}`);
          for (const item of weak) evidence.push(`${token}: mentioned ${item.count}× in ${item.relPath}`);
        }
        if (!matchedTerms.length) continue;
        if (match === "all" && matchedTerms.length !== tokens.length) continue;
        results.push({ name: repo.name, group: repo.group, tier: repo.layerContext ? repo.layerContext.tier : null, summary: repo.summary, score: Number(score.toFixed(2)), matchedTerms, evidence, path: repo.path });
      }
      results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      return { query, tokens, match, count: results.length, repositories: results.slice(0, limit) };
    },

    async get_related_de_context({ repo: query, includeCard = true } = {}) {
      const index = provider.get();
      const repo = findRepo(index, query);
      if (!repo) return notFound(index, query);
      const layer = repo.layerName ? layerByName(index, repo.layerName) : null;
      const related = relatedRepos(index, repo);
      const platform = platformDependencies(index, repo);
      if (!layer) {
        return {
          repo: repo.name,
          layer: null,
          message: "This repository is not beneath a workspace layer (no AGENTS.md + agents/ above it). Use its own agent docs instead.",
          ownDocs: { agents: repo.docs.agents.map((relPath) => resolve(repo.path, relPath)), readme: repo.docs.readme ? resolve(repo.path, repo.docs.readme) : null, skills: repo.docs.skills.map((skill) => skill.relPath) },
          related,
          platformDependencies: platform,
        };
      }
      const context = repo.layerContext || { listed: false };
      const card = context.cardPath ? layer.cards.get(basename(context.cardPath, ".md")) : null;
      const result = {
        repo: repo.name,
        layer: { name: layer.name, path: layer.path, agentsFile: layer.agentsFile ? layer.agentsFile.path : null, cataloguePath: context.cataloguePath },
        listed: context.listed,
        tier: context.tier,
        customer: context.customer,
        purpose: context.purpose,
        created: context.created,
        lastPush: context.lastPush,
        templateDerived: context.templateDerived,
        stealThis: context.stealThis,
        catalogueSection: context.catalogueSection,
        excludedReason: context.excluded,
        card: card ? { path: card.path, sections: card.sections } : null,
        topicGuides: layer.guides.map((guide) => ({ name: guide.name, path: guide.path, title: guide.title, summary: guide.summary })),
        related,
        platformDependencies: platform,
        ownDocs: { agents: repo.docs.agents.map((relPath) => resolve(repo.path, relPath)), readme: repo.docs.readme ? resolve(repo.path, repo.docs.readme) : null, skills: repo.docs.skills.map((skill) => skill.relPath) },
        readNext: [
          layer.agentsFile ? layer.agentsFile.path : null,
          context.cardPath,
          ...repo.docs.agents.map((relPath) => resolve(repo.path, relPath)),
        ].filter(Boolean),
      };
      if (includeCard && card) {
        try {
          const text = readFileSync(card.path, "utf8");
          result.cardText = Buffer.byteLength(text) <= MAX_INLINE_DOC_BYTES ? text : `${text.slice(0, MAX_INLINE_DOC_BYTES)}\n\n[truncated: read ${card.path} for the remainder]`;
        } catch (error) {
          result.cardText = `[unreadable: ${error.message}]`;
        }
      }
      if (!context.listed) {
        result.message = context.excluded
          ? `Listed under the catalogue's exclusions: ${context.excluded}`
          : "This repository has no catalogue row or card in the layer; treat it as unclassified.";
      }
      return result;
    },

    async search_workspace({ query, scope = "docs", repo: repoQuery, glob, limit = 20 } = {}) {
      const index = provider.get();
      if (!query || !query.trim()) return { error: "query is required" };
      let repo = null;
      if (repoQuery) {
        repo = findRepo(index, repoQuery);
        if (!repo) return notFound(index, repoQuery);
      }
      const result = { query, scope };
      if (scope === "docs" || scope === "all") {
        result.docs = searchDocuments(index.documents, query, { repo: repo ? repo.name : null, limit });
      }
      if (scope === "code" || scope === "all") {
        const paths = repo ? [repo.path] : index.roots.filter((root) => { try { return statSync(root).isDirectory(); } catch { return false; } });
        const code = await searchCode(paths, query, { limit, glob: glob || null });
        result.code = code.available
          ? { hits: code.hits.map((hit) => ({ ...hit, repo: repoForPath(index, hit.path) })), truncated: code.truncated, stderr: code.stderr }
          : { unavailable: code.reason, hits: [] };
      }
      return result;
    },

    async list_worktrees({ repo: repoQuery } = {}) {
      const index = provider.get();
      const seen = new Set();
      const worktrees = [];
      for (const repo of index.repos) {
        if (!repo.git || repo.git.isWorktree) continue;
        if (repoQuery && findRepo(index, repoQuery) !== repo) continue;
        const main = { repo: repo.name, path: repo.path, branch: repo.git.branch, head: repo.git.head, isMain: true, present: true };
        worktrees.push(main);
        for (const wt of repo.git.worktrees) {
          if (seen.has(wt.path)) continue;
          seen.add(wt.path);
          worktrees.push({ repo: repo.name, path: wt.path, branch: wt.branch, head: wt.head, isMain: false, present: wt.present, insideRoots: index.roots.some((root) => wt.path.startsWith(root + sep)) });
        }
      }
      const linked = worktrees.filter((wt) => !wt.isMain);
      return { repositoriesWithWorktrees: [...new Set(linked.map((wt) => wt.repo))], linkedWorktrees: linked.length, worktrees: repoQuery ? worktrees : worktrees.filter((wt) => !wt.isMain || repoHasLinked(worktrees, wt.repo)) };
    },

    async read_workspace_file({ path, offset = 1, limit = 200 } = {}) {
      const index = provider.get();
      const real = resolveWorkspacePath(index, path);
      const stat = statSync(real);
      if (!stat.isFile()) return { error: `${real} is not a regular file` };
      if (stat.size > 4 * 1024 * 1024) return { error: `${real} is larger than 4 MiB; use ripgrep or a direct read tool` };
      const buffer = readFileSync(real);
      if (buffer.subarray(0, 512).includes(0)) return { error: `${real} looks binary` };
      const lines = buffer.toString("utf8").split("\n");
      const start = Math.max(1, offset);
      const end = Math.min(lines.length, start + Math.min(limit, MAX_READ_LINES) - 1);
      let text = lines.slice(start - 1, end).join("\n");
      let truncated = end < lines.length;
      if (Buffer.byteLength(text) > MAX_READ_BYTES) {
        text = text.slice(0, MAX_READ_BYTES);
        truncated = true;
      }
      return { path: real, repo: repoForPath(index, real), startLine: start, endLine: end, totalLines: lines.length, truncated, text };
    },

    async refresh_index() {
      const index = provider.refresh();
      return { builtAt: index.builtAt, durationMs: index.durationMs, repositories: index.repos.length, documents: index.documents.length, layers: index.layers.map((layer) => layer.name), roots: index.roots };
    },
  };
  return handlers;
}

function repoHasLinked(worktrees, repoName) {
  return worktrees.some((wt) => wt.repo === repoName && !wt.isMain);
}

function repoForPath(index, path) {
  let best = null;
  for (const repo of index.repos) {
    const rel = relative(repo.path, path);
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    if (!best || repo.path.length > best.path.length) best = repo;
  }
  return best ? best.name : null;
}
