import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lazyStream,
  type Api,
  type Context,
  type Model,
  type Provider,
  type ProviderStreamOptions,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createBunFetch } from "./bun-fetch.ts";
import {
  OmpCompatibilityResolver,
  type OmpCompatibilityStatus,
} from "./omp-compat.ts";
import { OmpAnthropicTokenResolver } from "./omp-token.ts";
import {
  AnthropicIdentityResolver,
  CLAUDE_CODE_VERSION,
  createOmpAnthropicFetch,
  loadOrCreateInstallId,
  OMP_TARGET_VERSION,
  readInstallId,
} from "./transport.ts";

const STATUS_COMMAND = "omp-anthropic-route";
const ROUTE_UPSTREAM = Symbol.for("pi.omp-anthropic-route.upstream-provider");
type MarkedProvider = Provider & { [ROUTE_UPSTREAM]?: Provider };

function isDirectAnthropicModel(model: Model<Api>): boolean {
  try {
    return new URL(model.baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

function compatibilityStatusLine(status: OmpCompatibilityStatus): string {
  const installed = status.installedVersion ?? "unavailable";
  const update = status.updateAttempted
    ? "; automatic `brew upgrade omp` attempted"
    : "";
  return `Installed OMP: ${installed}${update}`;
}

function compatibilityMessage(status: OmpCompatibilityStatus): string {
  const reason = status.updateError
    ? ` Homebrew reported: ${status.updateError}`
    : status.versionError
      ? ` Version check reported: ${status.versionError}`
      : "";
  return [
    `Installed OMP ${status.installedVersion ?? "could not be identified"} does not match the reviewed ${status.targetVersion} route.${reason}`,
    "The stale route is disabled; direct Anthropic OAuth uses Pi's native transport until the extension target is reviewed and updated.",
  ].join("\n");
}

export default function ompAnthropicRoute(pi: ExtensionAPI) {
  const installId = readInstallId(join(homedir(), ".omp", "install-id")) ??
    loadOrCreateInstallId(join(getAgentDir(), "omp-anthropic-route", "install-id"));
  const identityResolver = new AnthropicIdentityResolver();
  const compatibilityResolver = new OmpCompatibilityResolver(OMP_TARGET_VERSION);
  const tokenResolver = new OmpAnthropicTokenResolver();
  const bunFetch = createBunFetch(
    fileURLToPath(new URL("./bun-fetch-bridge.ts", import.meta.url)),
  );
  let registered = false;

  function routeOptions<T extends ProviderStreamOptions | SimpleStreamOptions>(
    model: Model<Api>,
    context: Context,
    options: T | undefined,
  ): T {
    const baseFetch = options?.fetch ?? bunFetch;
    return {
      ...options,
      fetch: createOmpAnthropicFetch(baseFetch, {
        installId,
        sessionId: options?.sessionId,
        modelId: model.id,
        messages: context.messages,
        tools: context.tools,
        identityResolver,
      }),
    } as T;
  }

  function usesAnthropicOAuth(options: ProviderStreamOptions | SimpleStreamOptions | undefined): boolean {
    return options?.apiKey?.includes("sk-ant-oat") ?? false;
  }

  function registerRoute(ctx: ExtensionContext): void {
    const current = ctx.modelRegistry.getProvider("anthropic") as MarkedProvider | undefined;
    if (!current) return;
    // Session replacement/reload can expose the previous extension instance's
    // wrapper briefly. Always re-wrap its captured base rather than nesting
    // fetch transforms or retaining stale implementation code.
    const upstream = current[ROUTE_UPSTREAM] ?? current;

    const wrapped = {
      ...upstream,
      [ROUTE_UPSTREAM]: upstream,
      stream(model: Model<Api>, context: Context, options?: ProviderStreamOptions) {
        if (!usesAnthropicOAuth(options)) {
          return upstream.stream(model as never, context, options as never);
        }
        return lazyStream(model, async () => {
          const compatibility = await compatibilityResolver.resolve(options?.signal);
          if (!compatibility.compatible) {
            return upstream.stream(model as never, context, options as never);
          }
          const apiKey = await tokenResolver.resolve(options?.signal);
          return upstream.stream(
            model as never,
            context,
            routeOptions(model, context, { ...options, apiKey }) as never,
          );
        });
      },
      streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
        if (!usesAnthropicOAuth(options)) {
          return upstream.streamSimple(model, context, options);
        }
        return lazyStream(model, async () => {
          const compatibility = await compatibilityResolver.resolve(options?.signal);
          if (!compatibility.compatible) {
            return upstream.streamSimple(model, context, options);
          }
          const apiKey = await tokenResolver.resolve(options?.signal);
          return upstream.streamSimple(
            model,
            context,
            routeOptions(model, context, { ...options, apiKey }),
          );
        });
      },
    } as Provider;

    pi.registerProvider(wrapped);
    registered = true;
  }

  pi.on("session_start", async (_event, ctx) => {
    registerRoute(ctx);
    const compatibility = await compatibilityResolver.resolve();
    if (!compatibility.compatible) {
      ctx.ui.notify(
        compatibilityMessage(compatibility),
        "warning",
      );
    }
  });

  pi.registerCommand(STATUS_COMMAND, {
    description: "Show OMP-style Anthropic OAuth routing status",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      const routeSelected = registered &&
        model?.provider === "anthropic" &&
        isDirectAnthropicModel(model) &&
        ctx.modelRegistry.isUsingOAuth(model);
      let compatibility: OmpCompatibilityStatus;
      try {
        compatibility = await compatibilityResolver.resolve();
      } catch (error) {
        compatibility = {
          compatible: false,
          targetVersion: OMP_TARGET_VERSION,
          updateAttempted: false,
          versionError: error instanceof Error ? error.message : "compatibility check failed",
        };
      }
      let ompCredentialAvailable = false;
      if (routeSelected && compatibility.compatible) {
        try {
          await tokenResolver.resolve();
          ompCredentialAvailable = true;
        } catch {}
      }
      const active = routeSelected && compatibility.compatible && ompCredentialAvailable;
      const state = active
        ? "active"
        : !registered
          ? "unavailable"
          : !compatibility.compatible
            ? "incompatible (native Pi fallback)"
            : "standby";
      ctx.ui.notify(
        [
          `OMP-style Anthropic route: ${state}`,
          `Compatibility target: OMP ${OMP_TARGET_VERSION} / Claude Code ${CLAUDE_CODE_VERSION}`,
          compatibilityStatusLine(compatibility),
          active
            ? `Current model: anthropic/${model.id}; credential source: logged-in OMP account`
            : !compatibility.compatible
              ? compatibilityMessage(compatibility)
              : routeSelected
                ? "Anthropic OAuth is selected, but `omp token anthropic` did not return a usable credential."
                : "The route is enabled by default and activates for direct Anthropic OAuth; API-key, proxy, and other-provider traffic passes through unchanged.",
        ].join("\n"),
        compatibility.compatible ? "info" : "warning",
      );
    },
  });
}
