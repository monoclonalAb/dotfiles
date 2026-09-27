import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDeclaredTools, hasApi, lazyStream, normalizeContext,
  type Api, type TranscriptContext, type Model, type Provider,
  type ProviderStreamOptions, type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBunFetch } from "./bun-fetch.ts";
import { OmpCompatibilityResolver } from "./omp-compat.ts";
import { OmpAccountGuard, OmpAnthropicTokenResolver } from "./omp-token.ts";
import {
  AnthropicIdentityResolver, CLAUDE_CODE_VERSION, createOmpAnthropicFetch,
  loadOrCreateInstallId, OMP_PROTOCOL_REVIEW_VERSION, readInstallId,
} from "./transport.ts";

const STATUS_COMMAND = "omp-anthropic-route";
const ROUTE_UPSTREAM = Symbol.for("pi.omp-anthropic-route.upstream-provider");
type MarkedProvider = Provider & { [ROUTE_UPSTREAM]?: Provider };
const PROBE_MAX_TOKENS = 512;
const PROBE_TIMEOUT_MS = 45_000;
const PROBE_REPLY = "PI_ROUTE_OK";
type Probe = { state: "checking" | "passed" | "failed"; promise: Promise<void>;
  error?: string; servedModel?: string; outputTokens?: number };

function isDirectAnthropicModel(model: Model<Api>): model is Model<"anthropic-messages"> {
  try { return hasApi(model, "anthropic-messages") && model.provider === "anthropic" && new URL(model.baseUrl).origin === "https://api.anthropic.com"; }
  catch { return false; }
}
function requestLevelEffortModel(model: Model<"anthropic-messages">): Model<"anthropic-messages"> {
  // Keep selected effort and stored history; native per-turn effort has failed
  // live on the OAuth route even when the catalog advertises it.
  return model.compat?.supportsMidConvoEffort
    ? { ...model, compat: { ...model.compat, supportsMidConvoEffort: false } } : model;
}
function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown preflight failure")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]").slice(0, 800);
}
function modelKey(model: Model<Api>): string { return `${model.api}:${model.baseUrl}:${model.id}`; }

export default function ompAnthropicRoute(pi: ExtensionAPI) {
  const installId = readInstallId(join(homedir(), ".omp", "install-id")) ??
    loadOrCreateInstallId(join(getAgentDir(), "omp-anthropic-route", "install-id"));
  const identityResolver = new AnthropicIdentityResolver();
  const compatibilityResolver = new OmpCompatibilityResolver();
  const tokenResolver = new OmpAnthropicTokenResolver();
  const bunFetch = createBunFetch(fileURLToPath(new URL("./bun-fetch-bridge.ts", import.meta.url)));
  const lifetime = new AbortController();
  // Shares the transport's per-token bootstrap lookup, so no extra identity request.
  const accountGuard = new OmpAccountGuard(async token => (await identityResolver.resolve(token, bunFetch, lifetime.signal)).accountId);
  const probes = new Map<string, Probe>();
  const eligibleModels = new Set<string>();
  let upstream: Provider | undefined;
  let ui: ExtensionContext["ui"] | undefined;

  function routeOptions<T extends ProviderStreamOptions | SimpleStreamOptions>(model: Model<Api>, context: TranscriptContext, options: T): T {
    return { ...options, fetch: createOmpAnthropicFetch(options.fetch ?? bunFetch, {
      installId, sessionId: options.sessionId, modelId: model.id, messages: context.messages,
      tools: getDeclaredTools(context.messages), identityResolver,
    }) } as T;
  }

  async function ensureReady(model: Model<"anthropic-messages">, callerSignal?: AbortSignal): Promise<string> {
    const signal = callerSignal ? AbortSignal.any([lifetime.signal, callerSignal]) : lifetime.signal;
    signal.throwIfAborted();
    eligibleModels.add(modelKey(model));
    if (!compatibilityResolver.status) ui?.notify("Claude preflight: checking latest stable OMP (may upgrade Homebrew omp).", "info");
    const compatibility = await compatibilityResolver.resolve(signal);
    if (!compatibility.compatible) throw new Error(`Claude preflight blocked: ${compatibility.error ?? "OMP update check failed"}. Fix the cause, then /reload.`);
    const apiKey = await tokenResolver.resolve(signal);
    await accountGuard.accept(apiKey);
    signal.throwIfAborted();
    const key = modelKey(model);
    let probe = probes.get(key);
    if (!probe) {
      ui?.notify(`Claude preflight: verifying ${model.id} (one synthetic request, ≤${PROBE_MAX_TOKENS} output tokens; uses quota).`, "info");
      probe = { state: "checking", promise: Promise.resolve() };
      probes.set(key, probe);
      const current = probe;
      current.promise = (async () => {
        try {
          const context = normalizeContext({ messages: [{ role: "user", content: `Reply exactly ${PROBE_REPLY}. Do not call tools.`, timestamp: 0 }] });
          const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
          let messageRequests = 0;
          const limitedFetch: typeof fetch = (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            if (url.origin !== "https://api.anthropic.com") throw new Error("Preflight probe destination was not Anthropic");
            if (url.pathname === "/v1/messages" && ++messageRequests > 1) throw new Error("Preflight probe request budget exceeded");
            return bunFetch(input, init);
          };
          if (!upstream) throw new Error("Anthropic provider is unavailable");
          const stream = upstream.streamSimple(requestLevelEffortModel(model), context, routeOptions(model, context, {
            apiKey, fetch: limitedFetch, sessionId: randomUUID(), signal: probeSignal,
            reasoning: model.compat?.forceAdaptiveThinking ? "low" : undefined,
            maxTokens: PROBE_MAX_TOKENS, maxRetries: 0, cacheRetention: "none",
          }));
          let streamed = false;
          for await (const event of stream) if (event.type === "text_delta") streamed = true;
          const result = await stream.result();
          if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? `Preflight probe stopped with ${result.stopReason}`);
          const served = result.responseModel ?? result.model;
          // Anthropic's 'latest' aliases may resolve to a dated snapshot, never
          // a different model family. Opus 5.5 must remain Opus 5.5.
          const datedAlias = served.startsWith(`${model.id}-`) && /^\d{8}$/.test(served.slice(model.id.length + 1));
          if (!result.responseId || (served !== model.id && !datedAlias)) throw new Error("Preflight probe did not confirm the selected served model");
          const text = result.content.filter(block => block.type === "text").map(block => block.text).join("").trim();
          if (!streamed || text !== PROBE_REPLY || messageRequests !== 1) throw new Error("Preflight probe reply/stream assertions failed");
          current.servedModel = served;
          current.outputTokens = result.usage.output;
          current.state = "passed";
          ui?.notify(`Claude preflight passed: ${model.id}; OMP CLI ${compatibility.installedVersion} / Claude Code ${CLAUDE_CODE_VERSION}.`, "info");
        } catch (error) {
          current.state = "failed";
          current.error = safeError(error);
          throw new Error(`Claude preflight test failed for ${model.id}: ${current.error}. Fix the cause, then /reload; no automatic retry or native fallback.`);
        }
      })();
    }
    await probe.promise;
    signal.throwIfAborted();
    return apiKey;
  }

  function usesAnthropicOAuth(options: ProviderStreamOptions | SimpleStreamOptions | undefined): boolean {
    return options?.apiKey?.includes("sk-ant-oat") ?? false;
  }
  function registerRoute(ctx: ExtensionContext): void {
    const current = ctx.modelRegistry.getProvider("anthropic") as MarkedProvider | undefined;
    if (!current) return;
    // models.json composition drops the marker; unwrap the raw registration too.
    const previous = ctx.modelRegistry.getRegisteredNativeProvider("anthropic") as MarkedProvider | undefined;
    const native = previous?.[ROUTE_UPSTREAM] ?? current[ROUTE_UPSTREAM] ?? current;
    upstream = native;
    pi.registerProvider({ ...native, [ROUTE_UPSTREAM]: native,
      stream(model: Model<Api>, context: TranscriptContext, options?: ProviderStreamOptions) {
        if (!isDirectAnthropicModel(model) || !usesAnthropicOAuth(options)) return native.stream(model as never, context, options as never);
        return lazyStream(model, async () => {
          const apiKey = await ensureReady(model, options?.signal);
          return native.stream(requestLevelEffortModel(model) as never, context, routeOptions(model, context, { ...options, apiKey }) as never);
        });
      },
      streamSimple(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
        if (!isDirectAnthropicModel(model) || !usesAnthropicOAuth(options)) return native.streamSimple(model, context, options);
        return lazyStream(model, async () => {
          const apiKey = await ensureReady(model, options?.signal);
          return native.streamSimple(requestLevelEffortModel(model), context, routeOptions(model, context, { ...options, apiKey }));
        });
      },
    } as Provider);
  }

  function selected(ctx: ExtensionContext): Model<Api> | undefined {
    return upstream && ctx.model && isDirectAnthropicModel(ctx.model) &&
      (eligibleModels.has(modelKey(ctx.model)) || ctx.modelRegistry.isUsingOAuth(ctx.model)) ? ctx.model : undefined;
  }
  // Merely selecting Claude or reloading is passive. The provider boundary owns
  // updates/probes, so CLI, SDK and extension requests get the same guard.
  pi.on("session_start", (_event, ctx) => { ui = ctx.ui; registerRoute(ctx); });
  pi.on("session_shutdown", async () => { lifetime.abort(); });

  pi.registerCommand(STATUS_COMMAND, {
    description: "Show Claude request preflight and live probe results (no new work)",
    handler: async (_args, ctx) => {
      const model = selected(ctx);
      const compatibility = compatibilityResolver.status;
      const probe = model ? probes.get(modelKey(model)) : undefined;
      const state = !model ? "standby" : probe?.state === "passed" ? "active (verified)"
        : compatibility?.error || probe?.state === "failed" ? "blocked" : "pending (first Claude request)";
      ctx.ui.notify([
        `OMP-style Anthropic route: ${state}`,
        `Wire reference: OMP ${OMP_PROTOCOL_REVIEW_VERSION} / Claude Code ${CLAUDE_CODE_VERSION} (not a CLI version pin)`,
        `Latest OMP release: ${compatibility?.latestVersion ?? "not checked"}; installed: ${compatibility?.installedVersion ?? "not checked"}`,
        `OMP upgrade: ${compatibility?.updateAttempted ? "attempted" : "not needed / not attempted"}`,
        `Live model test: ${probe?.state ?? "not run"}${probe?.servedModel ? `; served ${probe.servedModel}; ${probe.outputTokens} output tokens` : ""}`,
        ...(compatibility?.error ? [compatibility.error] : []),
        ...(probe?.error ? [probe.error] : []),
        "Policy: first direct Claude OAuth request checks/updates OMP to latest stable using the reviewed formula recipe; wire code stays pinned. One bounded probe per model/runtime; no fallback on failure.",
        "This command does not update, resolve credentials or send a test. /reload resets the check; the next Claude request performs it (and may use quota).",
      ].join("\n"), model && probe?.state !== "passed" ? "warning" : "info");
    },
  });
}
