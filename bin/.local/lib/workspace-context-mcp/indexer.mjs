// Builds an in-memory index of every repository, worktree and manifest-bearing
// project directory beneath the configured roots. Everything here is
// read-only and file-based; see git.mjs for the (optional) git spawns.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { locateGitDir, readGitMeta } from "./git.mjs";
import { firstHeading, firstParagraph, layerContextFor, readLayer } from "./layers.mjs";

export const DEFAULT_MAX_DEPTH = 2;
const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", "outputs", "out", "target", "vendor",
  ".git", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".turbo", ".cache", ".pnpm-store",
  "tmp", "temp", "logs", "Library", "Applications", "Pictures", "Movies", "Music",
]);
const ROOT_DOC_NAMES = [
  "AGENTS.md", "CLAUDE.md", "README.md", "Readme.md", "readme.md", "SETUP.md",
  "ARCHITECTURE.md", "PLAN.md", "CONTRIBUTING.md", "GEMINI.md", "CODEX.md",
];
const AGENT_DOC_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CODEX.md"]);
const TEMPLATE_PLACEHOLDERS = new Set(["", "template", "my application", "my-app", "todo"]);
const MAX_DOC_BYTES = 400 * 1024;
const MAX_DOCS_PER_REPO = 120;
const MAX_WORKFLOW_BYTES = 64 * 1024;

// Dependency name -> stack tag. Unknown dependencies are still searchable via
// the raw dependency list; this map only names the common ones nicely.
const DEP_TAGS = new Map([
  ["hono", "hono"], ["@hono/node-server", "hono"], ["@hono/zod-validator", "hono"],
  ["zod", "zod"], ["vitest", "vitest"], ["nock", "nock"], ["@biomejs/biome", "biome"],
  ["typescript", "typescript"], ["tsx", "tsx"], ["winston", "winston"],
  ["@google-cloud/logging-winston", "cloud-logging"], ["@google-cloud/firestore", "firestore"],
  ["firebase-admin", "firebase"], ["firebase", "firebase"], ["@google-cloud/tasks", "cloud-tasks"],
  ["@google-cloud/pubsub", "pubsub"], ["@google-cloud/storage", "gcs"],
  ["@google-cloud/secret-manager", "secret-manager"], ["@google-cloud/bigquery", "bigquery"],
  ["@google/generative-ai", "gemini"], ["@google/genai", "gemini"], ["@google-cloud/vertexai", "vertex-ai"],
  ["openai", "openai"], ["@anthropic-ai/sdk", "anthropic"], ["@ai-sdk/openai", "ai-sdk"], ["ai", "ai-sdk"],
  ["@slack/web-api", "slack"], ["@slack/bolt", "slack"], ["googleapis", "google-apis"],
  ["google-auth-library", "google-auth"], ["nodemailer", "email"], ["@sendgrid/mail", "sendgrid"],
  ["twilio", "twilio"], ["stripe", "stripe"], ["@hubspot/api-client", "hubspot"],
  ["redis", "redis"], ["ioredis", "redis"], ["pg", "postgres"], ["postgres", "postgres"],
  ["prisma", "prisma"], ["@prisma/client", "prisma"], ["drizzle-orm", "drizzle"], ["mongoose", "mongodb"],
  ["express", "express"], ["fastify", "fastify"], ["next", "nextjs"], ["react", "react"],
  ["vue", "vue"], ["nuxt", "nuxt"], ["svelte", "svelte"], ["@sveltejs/kit", "sveltekit"], ["vite", "vite"],
  ["tailwindcss", "tailwind"], ["playwright", "playwright"], ["@playwright/test", "playwright"],
  ["puppeteer", "puppeteer"], ["sharp", "sharp"], ["pdf-lib", "pdf"], ["pdfjs-dist", "pdf"], ["pdf-parse", "pdf"],
  ["exceljs", "excel"], ["xlsx", "excel"], ["csv-parse", "csv"], ["commander", "cli"], ["yargs", "cli"],
  ["@modelcontextprotocol/sdk", "mcp"], ["@infisical/sdk", "infisical"], ["@infisical/cli", "infisical"],
  ["@daytona/sdk", "daytona"], ["@opencode-ai/sdk", "opencode"], ["dedent", "dedent"],
  ["prompt-behemoth", "prompt-behemoth"], ["@everyday-artificial-intelligence/prompt-behemoth", "prompt-behemoth"],
  ["@everyday-artificial-intelligence/perform-dangerous-action", "perform-dangerous-action"],
  ["@everyday-artificial-intelligence/little-404-lads-reporting", "little-404-lads-reporting"],
  ["langchain", "langchain"], ["@langchain/core", "langchain"], ["electron", "electron"],
  ["fastapi", "fastapi"], ["flask", "flask"], ["django", "django"], ["pydantic", "pydantic"],
  ["pytest", "pytest"], ["requests", "requests"], ["httpx", "httpx"], ["pandas", "pandas"],
  ["numpy", "numpy"], ["torch", "pytorch"], ["ultralytics", "yolo"], ["opencv-python", "opencv"],
  ["mcp", "mcp"], ["anthropic", "anthropic"], ["google-generativeai", "gemini"],
]);

// Stack tags that also count as external integrations when present.
const INTEGRATION_TAGS = new Set([
  "firestore", "firebase", "cloud-tasks", "pubsub", "gcs", "bigquery", "secret-manager", "gemini", "vertex-ai",
  "openai", "anthropic", "slack", "google-apis", "email", "sendgrid", "twilio", "stripe", "hubspot", "redis",
  "postgres", "mongodb", "daytona", "opencode", "infisical", "playwright", "puppeteer", "cloud-logging",
  "little-404-lads-reporting", "perform-dangerous-action", "prompt-behemoth",
]);

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readText(path, maxBytes = MAX_DOC_BYTES) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path) {
  const text = readText(path, 2 * 1024 * 1024);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function listDirNames(dir) {
  return safeReaddir(dir)
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function listModuleNames(dir) {
  // Directories and source files (without extension) are both modules, e.g.
  // src/services/vaultre/ or src/services/slack.ts.
  const names = new Set();
  for (const entry of safeReaddir(dir)) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) names.add(entry.name);
    else if (/\.(m?[jt]sx?|py|go|rs)$/.test(entry.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(entry.name)) {
      const base = entry.name.replace(/\.(m?[jt]sx?|py|go|rs)$/, "");
      if (!["index", "__init__", "mod", "main", "types", "constants", "utils"].includes(base)) names.add(base);
    }
  }
  return [...names].sort();
}

export function defaultRoots(env = process.env, home = homedir()) {
  const configured = env.WORKSPACE_CONTEXT_ROOTS;
  if (configured && configured.trim()) {
    return configured.split(":").map((part) => part.trim()).filter(Boolean).map(expandHome);
  }
  return [join(home, "Desktop", "projects"), join(home, "dotfiles")];
}

export function expandHome(path, home = homedir()) {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return resolve(path);
}

/** Absolute, symlink-resolved path when it exists (git records real paths, e.g. /private/var on macOS). */
export function canonicalPath(path) {
  const absolute = expandHome(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

// Code manifests only: README/AGENTS files alone mark a layer or notes
// directory, not a project, and must not stop the descent.
function hasCodeManifest(dir) {
  return ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"].some((name) => existsSync(join(dir, name)));
}

/**
 * Discovers repository-like directories under one root, up to maxDepth levels
 * deep. `group` is the path of the containing directory relative to the root
 * (for example "DE"), or the root's own name when the root itself is a repo.
 */
export function discoverProjects(root, maxDepth = DEFAULT_MAX_DEPTH) {
  const found = [];
  if (!existsSync(root)) return found;
  const groupFor = (dir) => {
    const rel = relative(root, dirname(dir));
    return rel && !rel.startsWith("..") ? rel : basename(root);
  };
  const visit = (dir, depth) => {
    const git = locateGitDir(dir);
    if (git) {
      found.push({ path: dir, group: groupFor(dir), kind: git.isWorktree ? "worktree" : "repo" });
      return;
    }
    if (dir !== root && hasCodeManifest(dir)) {
      found.push({ path: dir, group: groupFor(dir), kind: "project" });
      return;
    }
    if (depth >= maxDepth) return;
    for (const name of listDirNames(dir)) visit(join(dir, name), depth + 1);
  };
  visit(root, 0);
  return found;
}

function parsePyproject(text) {
  if (!text) return null;
  const name = /^name\s*=\s*"([^"]+)"/m.exec(text);
  const description = /^description\s*=\s*"([^"]*)"/m.exec(text);
  const depsBlock = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  const dependencies = depsBlock
    ? [...depsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].split(/[<>=!~;\[ ]/)[0].trim()).filter(Boolean)
    : [];
  return { name: name ? name[1] : null, description: description ? description[1] : null, dependencies };
}

function parseMise(text) {
  if (!text) return null;
  const tools = {};
  let inTools = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inTools = trimmed === "[tools]";
      continue;
    }
    if (!inTools) continue;
    const kv = /^"?([\w@/.-]+)"?\s*=\s*"?([^"\n#]+)"?/.exec(trimmed);
    if (kv) tools[kv[1]] = kv[2].trim();
  }
  return { tools };
}

function parseEnvExampleKeys(text) {
  if (!text) return [];
  const keys = new Set();
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return [...keys];
}

function scanWorkflows(dir) {
  const out = [];
  for (const entry of safeReaddir(dir)) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const text = readText(join(dir, entry.name), MAX_WORKFLOW_BYTES) || "";
    const markers = [];
    if (/deploy-guardian/i.test(text)) markers.push("deploy-guardian");
    if (/gcloud\s+run\s+deploy|deploy-cloudrun|run\.googleapis/i.test(text)) markers.push("cloud-run");
    if (/workload_identity_provider/i.test(text)) markers.push("wif");
    if (/credentials_json/i.test(text)) markers.push("sa-key");
    if (/docker\/build-push|docker\s+build/i.test(text)) markers.push("docker-build");
    if (/pnpm\/action-setup|pnpm/i.test(text)) markers.push("pnpm");
    if (/firebase\s+deploy|FirebaseExtended|firebase-tools/i.test(text)) markers.push("firebase-deploy");
    if (/vercel/i.test(text)) markers.push("vercel");
    if (/vitest|npm test|pnpm test|pytest/i.test(text)) markers.push("tests");
    if (/gitleaks/i.test(text)) markers.push("gitleaks");
    const name = /^name:\s*(.+)$/m.exec(text);
    out.push({ file: entry.name, name: name ? name[1].trim().replace(/^["']|["']$/g, "") : null, markers });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function readManifests(path) {
  const manifests = { present: [] };
  const packageJson = readJson(join(path, "package.json"));
  if (packageJson && typeof packageJson === "object") {
    manifests.present.push("package.json");
    manifests.packageJson = {
      name: typeof packageJson.name === "string" ? packageJson.name : null,
      description: typeof packageJson.description === "string" ? packageJson.description : null,
      private: Boolean(packageJson.private),
      type: packageJson.type || null,
      scripts: packageJson.scripts && typeof packageJson.scripts === "object" ? Object.keys(packageJson.scripts) : [],
      dependencies: Object.keys(packageJson.dependencies || {}),
      devDependencies: Object.keys(packageJson.devDependencies || {}),
      engines: packageJson.engines || null,
      packageManager: packageJson.packageManager || null,
    };
  }
  const pyproject = parsePyproject(readText(join(path, "pyproject.toml")));
  if (pyproject) {
    manifests.present.push("pyproject.toml");
    manifests.pyproject = pyproject;
  }
  const everyday = readJson(join(path, ".everyday.json"));
  if (everyday && typeof everyday === "object") {
    manifests.present.push(".everyday.json");
    manifests.everyday = {
      projectName: everyday.projectName ?? null,
      projectID: everyday.projectID ?? everyday.projectId ?? null,
      region: everyday.region ?? null,
      isTemplate: ["projectName", "projectID", "region"].some((k) => `${everyday[k] ?? ""}`.toLowerCase() === "template"),
    };
  }
  const mise = parseMise(readText(join(path, "mise.toml")) ?? readText(join(path, ".mise.toml")));
  if (mise) {
    manifests.present.push("mise.toml");
    manifests.mise = mise;
  }
  const dockerfile = readText(join(path, "Dockerfile"), 64 * 1024);
  if (dockerfile !== null) {
    manifests.present.push("Dockerfile");
    const from = /^FROM\s+([^\s]+)/m.exec(dockerfile);
    manifests.dockerfile = { baseImage: from ? from[1] : null };
  }
  const envExample = readText(join(path, ".env.example"), 64 * 1024);
  if (envExample !== null) {
    manifests.present.push(".env.example");
    manifests.envExampleKeys = parseEnvExampleKeys(envExample);
  }
  const goMod = readText(join(path, "go.mod"), 64 * 1024);
  if (goMod !== null) {
    manifests.present.push("go.mod");
    const mod = /^module\s+(\S+)/m.exec(goMod);
    manifests.goModule = mod ? mod[1] : null;
  }
  const cargo = readText(join(path, "Cargo.toml"), 64 * 1024);
  if (cargo !== null) {
    manifests.present.push("Cargo.toml");
    const name = /^name\s*=\s*"([^"]+)"/m.exec(cargo);
    manifests.cargoName = name ? name[1] : null;
  }
  for (const marker of [
    ".infisical.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "package-lock.json", "bun.lock",
    "bun.lockb", "uv.lock", "requirements.txt", "poetry.lock", "biome.json", "tsconfig.json", ".nvmrc",
    ".node-version", ".python-version", "firebase.json", "vercel.json", "docker-compose.yml",
    "compose.yaml", "Brewfile", ".stowrc", "skills-lock.json",
  ]) {
    if (existsSync(join(path, marker))) manifests.present.push(marker);
  }
  for (const entry of safeReaddir(path)) {
    if (entry.isFile() && /^(vitest|vite|promptbeast|agent-test|playwright|jest|eslint|nuxt|next|svelte|astro)\.config\.[cm]?[jt]s$/.test(entry.name)) {
      manifests.present.push(entry.name);
    }
  }
  const workflowsDir = join(path, ".github", "workflows");
  if (existsSync(workflowsDir)) manifests.githubWorkflows = scanWorkflows(workflowsDir);
  manifests.present = [...new Set(manifests.present)].sort();
  return manifests;
}

function readStructure(path) {
  const structure = { topLevelDirs: listDirNames(path), services: [], workflows: [], routes: [] };
  for (const candidate of ["src/services", "services", "src/integrations", "integrations", "src/clients", "src/adapters"]) {
    const dir = join(path, candidate);
    if (existsSync(dir)) structure.services.push(...listModuleNames(dir).map((name) => ({ name, dir: candidate })));
  }
  for (const candidate of ["src/workflows", "workflows", "src/jobs", "src/pipelines", "src/agents"]) {
    const dir = join(path, candidate);
    if (existsSync(dir)) structure.workflows.push(...listModuleNames(dir).map((name) => ({ name, dir: candidate })));
  }
  const routeNoise = new Set(["routes", "api", "middleware", "handlers", "controllers", "schemas", "validators"]);
  for (const candidate of ["src/api/routes", "src/routes", "routes", "src/api", "server/api", "pages/api", "app/api", "functions/src"]) {
    const dir = join(path, candidate);
    if (!existsSync(dir)) continue;
    for (const name of listModuleNames(dir)) {
      if (routeNoise.has(name) || structure.routes.some((route) => route.name === name)) continue;
      structure.routes.push({ name, dir: candidate });
    }
  }
  structure.hasTests = ["tests", "test", "__tests__", "spec", "testing"].some((d) => existsSync(join(path, d)));
  structure.hasEvals = ["evals", "eval", "benchmarks"].some((d) => existsSync(join(path, d)));
  structure.hasInfra = ["infra", "terraform", "deploy"].some((d) => existsSync(join(path, d)));
  structure.hasDocker = existsSync(join(path, "docker"));
  return structure;
}

function collectSkills(path) {
  const skills = [];
  for (const base of [".agents/skills", ".omp/skills", ".claude/skills", "skills", ".github/skills", "scoped-skills", "omp/.omp/agent/skills"]) {
    const dir = join(path, base);
    for (const entry of safeReaddir(dir)) {
      if (entry.name.startsWith(".")) continue;
      const skillFile = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const text = readText(skillFile, 64 * 1024) || "";
      const description = /^description:\s*(.+)$/m.exec(text);
      skills.push({
        name: entry.name,
        path: skillFile,
        relPath: `${base}/${entry.name}/SKILL.md`,
        description: description ? description[1].trim().replace(/^["']|["']$/g, "").slice(0, 200) : firstParagraph(text, 200),
      });
    }
  }
  return skills;
}

function walkDocs(dir, relBase, out, depth, maxDepth) {
  if (out.length >= MAX_DOCS_PER_REPO || depth > maxDepth) return;
  for (const entry of safeReaddir(dir)) {
    if (out.length >= MAX_DOCS_PER_REPO) return;
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkDocs(full, rel, out, depth + 1, maxDepth);
    else if (entry.isFile() && /\.(md|mdx|markdown)$/i.test(entry.name)) out.push({ path: full, relPath: rel });
  }
}

/** Markdown documents worth indexing for a repository: root docs, docs/**, skills, agents/**. */
export function collectDocs(path) {
  const docs = [];
  for (const name of ROOT_DOC_NAMES) {
    const full = join(path, name);
    if (existsSync(full)) docs.push({ path: full, relPath: name });
  }
  for (const base of ["docs", "doc", "agents", ".agents", ".omp", "documentation", "adr", "plans"]) {
    const dir = join(path, base);
    if (existsSync(dir) && statSync(dir).isDirectory()) walkDocs(dir, base, docs, 0, 4);
  }
  const seen = new Set();
  return docs.filter((doc) => {
    const key = doc.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadDocuments(repo) {
  const documents = [];
  for (const doc of collectDocs(repo.path)) {
    const text = readText(doc.path);
    if (text === null) continue;
    documents.push({
      repo: repo.name,
      path: doc.path,
      relPath: doc.relPath,
      title: firstHeading(text) || doc.relPath,
      text,
      lower: text.toLowerCase(),
      bytes: Buffer.byteLength(text),
    });
  }
  return documents;
}

function deriveStack(record) {
  const tags = new Set();
  const m = record.manifests;
  const deps = [
    ...((m.packageJson && m.packageJson.dependencies) || []),
    ...((m.packageJson && m.packageJson.devDependencies) || []),
    ...((m.pyproject && m.pyproject.dependencies) || []),
  ];
  for (const dep of deps) {
    const tag = DEP_TAGS.get(dep) || DEP_TAGS.get(dep.toLowerCase());
    if (tag) tags.add(tag);
  }
  const present = new Set(m.present);
  if (present.has("package.json")) tags.add("node");
  if (present.has("tsconfig.json")) tags.add("typescript");
  if (present.has("pnpm-lock.yaml") || present.has("pnpm-workspace.yaml")) tags.add("pnpm");
  if (present.has("yarn.lock")) tags.add("yarn");
  if (present.has("bun.lock") || present.has("bun.lockb")) tags.add("bun");
  if (present.has("package-lock.json")) tags.add("npm");
  if (present.has("pyproject.toml") || present.has("requirements.txt")) tags.add("python");
  if (present.has("uv.lock")) tags.add("uv");
  if (present.has("go.mod")) tags.add("go");
  if (present.has("Cargo.toml")) tags.add("rust");
  if (present.has("mise.toml")) tags.add("mise");
  if (present.has("Dockerfile") || present.has("docker-compose.yml") || present.has("compose.yaml")) tags.add("docker");
  if (present.has(".infisical.json")) tags.add("infisical");
  if (present.has("biome.json")) tags.add("biome");
  if (present.has("firebase.json")) tags.add("firebase");
  if (present.has("vercel.json")) tags.add("vercel");
  if (present.has("Brewfile")) tags.add("homebrew");
  if (present.has(".stowrc")) tags.add("stow");
  if (m.everyday && !m.everyday.isTemplate) tags.add("everyday-de");
  if (m.everyday && m.everyday.isTemplate) tags.add("everyday-de-template-placeholder");
  if (m.githubWorkflows && m.githubWorkflows.length) {
    tags.add("github-actions");
    for (const wf of m.githubWorkflows) for (const marker of wf.markers) tags.add(marker);
  }
  if (record.structure.services.length) tags.add("services-layer");
  if (record.structure.workflows.length) tags.add("workflows-layer");
  if (record.structure.hasEvals) tags.add("evals");
  if (m.present.some((name) => /^promptbeast\.config/.test(name))) tags.add("prompt-behemoth");
  if (m.present.some((name) => /^agent-test\.config/.test(name))) tags.add("agent-tests");
  return [...tags].sort();
}

// "cloudTasks" (service directory) and "cloud-tasks" (dependency tag) are the
// same integration; compare on a normalised key and keep the first spelling.
function integrationKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deriveIntegrations(record) {
  const names = new Map();
  for (const service of record.structure.services) names.set(integrationKey(service.name), service.name);
  for (const tag of record.stack) if (INTEGRATION_TAGS.has(tag) && !names.has(integrationKey(tag))) names.set(integrationKey(tag), tag);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function deriveSummary(record, documents) {
  if (record.layerContext && record.layerContext.purpose) return record.layerContext.purpose;
  const pkgDescription = record.manifests.packageJson && record.manifests.packageJson.description;
  if (pkgDescription && !TEMPLATE_PLACEHOLDERS.has(pkgDescription.trim().toLowerCase())) return pkgDescription.trim();
  const pyDescription = record.manifests.pyproject && record.manifests.pyproject.description;
  if (pyDescription && !TEMPLATE_PLACEHOLDERS.has(pyDescription.trim().toLowerCase())) return pyDescription.trim();
  const readme = documents.find((doc) => /^readme\.md$/i.test(doc.relPath));
  const paragraph = readme ? firstParagraph(readme.text) : null;
  if (paragraph) return paragraph;
  const agents = documents.find((doc) => AGENT_DOC_NAMES.has(doc.relPath));
  return agents ? firstParagraph(agents.text) : null;
}

export function customerKey(name) {
  const match = /^([a-z0-9]+)/i.exec(name);
  return match ? match[1].toLowerCase() : name.toLowerCase();
}

function findLayer(layers, repoPath) {
  let best = null;
  for (const layer of layers) {
    const rel = relative(layer.path, repoPath);
    if (rel.startsWith("..") || rel === "") continue;
    if (!best || layer.path.length > best.path.length) best = layer;
  }
  return best;
}

function discoverLayers(roots, maxDepth) {
  const layers = [];
  const seen = new Set();
  const consider = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    // A repository's or project's own AGENTS.md is repo context, not a layer.
    if (locateGitDir(dir) || hasCodeManifest(dir)) return;
    const layer = readLayer(dir);
    if (layer) layers.push(layer);
  };
  for (const root of roots) {
    if (!existsSync(root)) continue;
    consider(root);
    const walk = (dir, depth) => {
      if (depth >= maxDepth) return;
      for (const name of listDirNames(dir)) {
        const child = join(dir, name);
        if (locateGitDir(child) || hasCodeManifest(child)) continue;
        consider(child);
        walk(child, depth + 1);
      }
    };
    walk(root, 0);
  }
  return layers;
}

function buildRecord(project, root, layers) {
  const record = {
    name: basename(project.path),
    path: project.path,
    root,
    group: project.group,
    kind: project.kind,
    git: null,
    docs: { agents: [], readme: null, files: [], skills: [] },
    manifests: readManifests(project.path),
    structure: readStructure(project.path),
    stack: [],
    integrations: [],
    summary: null,
    layerContext: null,
    layerName: null,
    customerKey: customerKey(basename(project.path)),
  };
  const meta = project.kind === "project" ? null : readGitMeta(project.path);
  if (meta) {
    record.git = {
      branch: meta.branch,
      head: meta.head,
      remoteUrl: meta.remoteUrl,
      remoteSlug: meta.remoteSlug,
      isWorktree: meta.isWorktree,
      mainRepoPath: meta.isWorktree ? meta.mainRepoPath : null,
      worktrees: meta.worktrees,
    };
  }
  const layer = findLayer(layers, project.path);
  if (layer) {
    record.layerName = layer.name;
    record.layerContext = layerContextFor(layer, record.name);
  }
  record.docs.skills = collectSkills(project.path);
  const documents = loadDocuments(record);
  for (const doc of documents) {
    if (AGENT_DOC_NAMES.has(doc.relPath)) record.docs.agents.push(doc.relPath);
    if (/^readme\.md$/i.test(doc.relPath)) record.docs.readme = doc.relPath;
    record.docs.files.push({ relPath: doc.relPath, title: doc.title, bytes: doc.bytes });
  }
  record.stack = deriveStack(record);
  record.integrations = deriveIntegrations(record);
  record.summary = deriveSummary(record, documents);
  return { record, documents };
}

/**
 * Builds the workspace index. Returns { builtAt, durationMs, roots, repos, documents, layers }.
 * `repos` is an array sorted by group then name; `documents` is the searchable corpus.
 */
export function buildIndex({ roots = defaultRoots(), maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const started = Date.now();
  const resolvedRoots = [...new Set(roots.map((root) => canonicalPath(root)))];
  const layers = discoverLayers(resolvedRoots, maxDepth);
  const repos = [];
  const documents = [];
  const seenPaths = new Set();
  for (const root of resolvedRoots) {
    for (const project of discoverProjects(root, maxDepth)) {
      if (seenPaths.has(project.path)) continue;
      seenPaths.add(project.path);
      const { record, documents: docs } = buildRecord(project, root, layers);
      repos.push(record);
      documents.push(...docs);
    }
  }
  // Layer documents (workspace AGENTS.md, topic guides, catalogue, cards) are searchable too.
  for (const layer of layers) {
    const layerDocs = [];
    if (layer.agentsFile) layerDocs.push({ path: layer.agentsFile.path });
    for (const guide of layer.guides) layerDocs.push({ path: guide.path });
    if (layer.catalogue) layerDocs.push({ path: layer.catalogue.path });
    for (const [cardName, card] of layer.cards) layerDocs.push({ path: card.path, cardFor: cardName });
    for (const { path, cardFor } of layerDocs) {
      const text = readText(path);
      if (text === null) continue;
      documents.push({
        repo: null,
        cardFor: cardFor || null,
        layer: layer.name,
        path,
        relPath: relative(layer.path, path),
        title: firstHeading(text) || basename(path),
        text,
        lower: text.toLowerCase(),
        bytes: Buffer.byteLength(text),
      });
    }
  }
  repos.sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name));
  return {
    builtAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    roots: resolvedRoots,
    maxDepth,
    repos,
    documents,
    layers,
  };
}

/** Case-insensitive lookup by directory name, package name, remote slug or path. */
export function findRepo(index, query) {
  if (!query) return null;
  const needle = query.trim();
  const lower = needle.toLowerCase();
  if (needle.startsWith("/") || needle.startsWith("~")) {
    const canonical = canonicalPath(needle);
    const byPath = index.repos.find((repo) => repo.path === canonical);
    if (byPath) return byPath;
  }
  return (
    index.repos.find((repo) => repo.name === needle) ||
    index.repos.find((repo) => repo.name.toLowerCase() === lower) ||
    index.repos.find((repo) => repo.git && repo.git.remoteSlug && repo.git.remoteSlug.toLowerCase() === lower) ||
    index.repos.find((repo) => repo.git && repo.git.remoteSlug && repo.git.remoteSlug.toLowerCase().endsWith(`/${lower}`)) ||
    index.repos.find((repo) => repo.manifests.packageJson && repo.manifests.packageJson.name === needle) ||
    index.repos.find((repo) => repo.path.toLowerCase().endsWith(`/${lower}`)) ||
    null
  );
}

export function suggestRepos(index, query, limit = 5) {
  const lower = (query || "").toLowerCase();
  return index.repos
    .filter((repo) => repo.name.toLowerCase().includes(lower) || lower.includes(repo.name.toLowerCase()))
    .slice(0, limit)
    .map((repo) => repo.name);
}

export function layerByName(index, name) {
  return index.layers.find((layer) => layer.name === name) || null;
}

export function repoDir(repo) {
  return dirname(repo.path);
}
