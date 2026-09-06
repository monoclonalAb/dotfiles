import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = "@earendil-works/pi-coding-agent";

// Resolve the same npm Pi executable the managed wrapper will find. No npm
// command, package install, extension discovery, or session-history access.
export async function findPi(path = process.env.PATH ?? "") {
  let executable;
  for (const directory of path.split(":")) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, "pi");
    try {
      await access(candidate, constants.X_OK);
      executable ??= candidate;
      const target = await realpath(candidate);
      // npm may point at dist/cli.js or dist/bundle/cli.js.
      let directory = dirname(target);
      for (let depth = 0; depth < 5; depth++, directory = dirname(directory)) {
        const packagePath = join(directory, "package.json");
        try {
          const metadata = JSON.parse(await readFile(packagePath, "utf8"));
          if (metadata.name === PACKAGE) return { executable, packagePath, version: metadata.version };
        } catch (error) {
          if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code) && !(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error("Pi Tasks requires the installed npm Pi package on PATH (no other agent is used).");
}

export async function loadPiModules(installation) {
  const load = async (name) => {
    const packagePath = findPackageJSON(name, pathToFileURL(installation.packagePath));
    const metadata = JSON.parse(await readFile(packagePath, "utf8"));
    const entry = metadata.exports?.["."]?.import ?? metadata.main;
    if (typeof entry !== "string") throw new Error(`${name} has no supported JavaScript entrypoint.`);
    return import(pathToFileURL(join(dirname(packagePath), entry)).href);
  };
  const [sdk, ai, tui] = await Promise.all([load(PACKAGE), load("@earendil-works/pi-ai"), load("@earendil-works/pi-tui")]);
  if (!sdk.ModelRuntime?.create || !ai.getSupportedThinkingLevels || !tui.TuiMainScreen || !tui.Editor) {
    throw new Error("Installed Pi lacks the task launcher's ModelRuntime/TUI APIs.");
  }
  return { sdk, ai, tui };
}

export async function loadCatalog({ sdk, ai }, options = {}) {
  const signal = options.signal ?? AbortSignal.timeout(10_000);
  const runtime = await sdk.ModelRuntime.create({ ...options, allowModelNetwork: false, signal });
  const available = await runtime.getAvailable(undefined, { signal });
  const error = runtime.getError();
  if (error) throw new Error(error);
  return available.map((model) => ({
    key: `${model.provider}/${model.id}`,
    provider: model.provider,
    id: model.id,
    name: model.name,
    levels: ai.getSupportedThinkingLevels(model),
  })).filter((model) => model.levels.length > 0).sort((a, b) => a.key.localeCompare(b.key));
}

export async function readStartupDefaults(agentDir) {
  try {
    // Read only startup preferences, not project resources or session stores.
    const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    return {
      model: settings.defaultProvider && settings.defaultModel
        ? `${settings.defaultProvider}/${settings.defaultModel}` : undefined,
      thinking: settings.defaultThinkingLevel ?? "high",
      modelThinkingLevels: settings.modelThinkingLevels ?? {},
    };
  } catch (error) {
    if (error.code === "ENOENT") return { thinking: "high", modelThinkingLevels: {} };
    throw new Error(`Cannot read Pi startup preferences: ${error.message}`);
  }
}
