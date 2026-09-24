// Builds a temporary workspace with real git repositories, a linked worktree,
// a non-git project, and a DE-style layer (AGENTS.md + agents/ catalogue and
// cards). Shared by the test files; never touches the real workspace.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).toString("utf8");
}

function write(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function initRepo(path, { remote = null, branch = "main", files = {} } = {}) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", branch);
  if (remote) git(path, "remote", "add", "origin", remote);
  for (const [rel, content] of Object.entries(files)) write(join(path, rel), content);
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "initial", "--allow-empty");
}

const DE_PACKAGE = (name, extraDeps = {}) =>
  JSON.stringify(
    {
      name: "my-app",
      description: "My Application",
      type: "module",
      scripts: { test: "vitest run", build: "tsc" },
      dependencies: { hono: "^4", zod: "^3", "@google-cloud/firestore": "^7", "@everyday-artificial-intelligence/perform-dangerous-action": "^1", ...extraDeps },
      devDependencies: { vitest: "^2", nock: "^14", "@biomejs/biome": "^1", typescript: "^5" },
    },
    null,
    2,
  );

export function createFixtureWorkspace() {
  // realpath: macOS tmpdir is a symlink and git records resolved paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-context-")));
  const de = join(root, "DE");
  mkdirSync(de, { recursive: true });

  // Layer: AGENTS.md + agents/ with catalogue, guide and cards.
  write(join(de, "AGENTS.md"), "# Fixture DE workspace\n\nOne repo is one DE.\n\n## Hard rules\n\n- Use the template stack.\n");
  write(join(de, "agents", "build-a-de.md"), "# Build a DE\n\nOrdered playbook for scaffolding a Digital Employee.\n\n## Scaffold\n");
  write(
    join(de, "agents", "repo-catalog.md"),
    [
      "# Catalogue",
      "",
      "## Customer and DE repositories",
      "",
      "| Repo | Customer | Purpose | Created | Last push | Tier | Template-derived | Steal this |",
      "|---|---|---|---|---|---|---|---|",
      "| [acme-de01](repos/acme-de01.md) | Acme | Acme invoice ingestion DE | 2026-03-01 | 2026-08-01 | Tier 1 | yes | replay harness |",
      "| [acme-de02](repos/acme-de02.md) | Acme | Acme legacy sync | 2025-01-01 | 2026-01-01 | Tier 3 | no | idempotent cache |",
      "",
      "## Canon and shared platform repositories",
      "",
      "| Repo | Customer | Purpose | Created | Last push | Tier | Template-derived | Steal this |",
      "|---|---|---|---|---|---|---|---|",
      "| [perform-dangerous-action](repos/perform-dangerous-action.md) | Shared | Guarded wrapper | 2025-07-25 | 2026-03-08 | Canon/platform | no | result union |",
      "",
      "## Not cloned",
      "",
      "| Exclusion | Reason |",
      "|---|---|",
      "| `internal-bot` | Internal bot; not a DE. |",
      "",
    ].join("\n"),
  );
  write(
    join(de, "agents", "repos", "acme-de01.md"),
    "# acme-de01 — Acme invoice ingestion DE\n\n- Customer / domain: Acme accounts payable. (`acme-de01/README.md`)\n- Created: 2026-03-01  Last push: 2026-08-01  Tier: Tier 1 (metadata)\n- Template-derived: yes (`acme-de01/package.json`)\n\n## What it does\n- Reads invoices from Gmail and writes them to VaultRE. (`acme-de01/src/workflows/ingest/index.ts`)\n\n## Worth copying\n- The VaultRE replay harness. (`acme-de01/docs/replay.md`)\n",
  );
  write(join(de, "agents", "repos", "acme-de02.md"), "# acme-de02 — Acme legacy sync\n\n- Customer / domain: Acme\n- Created: 2025-01-01  Last push: 2026-01-01  Tier: Tier 3\n\n## What it does\n- Legacy.\n");

  initRepo(join(de, "acme-de01"), {
    remote: "git@github.com:example-org/acme-de01.git",
    files: {
      "package.json": DE_PACKAGE("acme-de01", { "@slack/web-api": "^7" }),
      "AGENTS.md": "# acme-de01 agent guide\n\nUse Result<T> for business outcomes.\n",
      "README.md": "# acme-de01\n\n![badge](x)\n\nIngests Acme invoices into VaultRE with a replay harness.\n",
      ".everyday.json": JSON.stringify({ projectName: "acme-de01", projectID: "acme-123", region: "us-central1" }),
      "mise.toml": "[tools]\nnode = \"24\"\npnpm = \"10\"\n",
      "Dockerfile": "FROM node:24-slim\n",
      ".env.example": "VAULTRE_API_KEY=\nSLACK_TOKEN=\nPORT=8080\n# comment\n",
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "tsconfig.json": "{}",
      "vitest.config.ts": "export default {}\n",
      "src/services/vaultre/index.ts": "export const vaultre = 1;\n",
      "src/services/gmail/index.ts": "export const gmail = 1;\n",
      "src/services/slack.ts": "export const slack = 1;\n",
      "src/workflows/ingest/index.ts": "export const ingest = 1;\n",
      "src/api/routes/health.ts": "export const health = 1;\n",
      "docs/replay.md": "# Replay harness\n\nDeterministic VaultRE state replay.\n",
      ".agents/skills/perform-dangerous-action/SKILL.md": "---\nname: perform-dangerous-action\ndescription: Guard external mutations.\n---\n# Skill\n",
      ".github/workflows/deploy.yml": "name: Deploy\non: push\njobs:\n  deploy:\n    steps:\n      - uses: google-github-actions/auth@v2\n        with:\n          workload_identity_provider: x\n      - run: gcloud run deploy acme\n",
      ".github/workflows/deploy-guardian.yml": "name: Deploy Guardian\non: workflow_call\njobs:\n  gate:\n    uses: example-org/deploy-guardian/.github/workflows/gate.yml@main\n",
      ".env": "SECRET=do-not-read\n",
    },
  });
  // Linked worktree beside the main checkout and one outside the roots.
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "workspace-context-outside-")));
  git(join(de, "acme-de01"), "worktree", "add", "-q", "-b", "feature/x", join(de, "acme-de01-feature"));
  git(join(de, "acme-de01"), "worktree", "add", "-q", "-b", "task/y", join(outside, "acme-task-y"));

  initRepo(join(de, "acme-de02"), {
    remote: "https://github.com/example-org/acme-de02.git",
    files: {
      "package.json": JSON.stringify({ name: "acme-de02", description: "Legacy Acme sync", dependencies: { express: "^4", "@hubspot/api-client": "^10" } }),
      "README.md": "# acme-de02\n\nLegacy sync using HubSpot.\n",
    },
  });
  initRepo(join(de, "perform-dangerous-action"), {
    files: {
      "package.json": JSON.stringify({ name: "@everyday-artificial-intelligence/perform-dangerous-action", description: "Guarded wrapper" }),
      "README.md": "# perform-dangerous-action\n\nGuarded execution wrapper.\n",
    },
  });
  initRepo(join(de, "internal-bot"), { files: { "README.md": "# internal-bot\n\nNot a DE.\n" } });

  // Non-git project with a manifest and its own AGENTS.md (must not become a layer).
  write(join(de, "scratch-tool", "package.json"), JSON.stringify({ name: "scratch-tool", description: "Scratch CLI", dependencies: { commander: "^12" } }));
  write(join(de, "scratch-tool", "AGENTS.md"), "# scratch-tool\n\nA scratch project.\n");

  // A python repo in another group.
  initRepo(join(root, "personal", "pyapp"), {
    files: {
      "pyproject.toml": "[project]\nname = \"pyapp\"\ndescription = \"Python app\"\ndependencies = [\n  \"fastapi>=0.100\",\n  \"httpx\",\n]\n",
      "README.md": "# pyapp\n\nSmall FastAPI service.\n",
    },
  });
  // A directory with only notes (no manifest, no git) must be ignored.
  write(join(root, "notes", "ideas.md"), "# ideas\n");

  return {
    root,
    de,
    outside,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
}
