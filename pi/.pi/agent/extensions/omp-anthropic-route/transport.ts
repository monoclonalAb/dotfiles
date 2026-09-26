import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Anthropic OAuth request alignment reviewed against Oh My Pi v18.3.1
 * (https://github.com/can1357/oh-my-pi/tree/6204b7508014bcdf12d95f0b3fd470905fd99344), MIT licensed.
 *
 * This module intentionally operates at the fetch boundary. Pi's native
 * Anthropic adapter still owns message conversion and stream parsing; this
 * layer only aligns the OAuth request/response wire shape with OMP.
 */

// Wire reference, not an installed CLI version requirement. OMP supplies tokens;
// its guarded updater never rewrites this adapter or adopts server-suggested
// fingerprints. Changes to the wire profile still need source review.
export const OMP_PROTOCOL_REVIEW_VERSION = "18.3.1";
export const CLAUDE_CODE_VERSION = "2.1.280";
export const CLAUDE_CODE_SDK_VERSION = "0.112.1";
export const CLAUDE_CODE_SYSTEM_INSTRUCTION =
  "You are Claude Code, Anthropic's official CLI for Claude.";

const CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`;
const CLAUDE_CODE_BOOTSTRAP_USER_AGENT = `claude-code/${CLAUDE_CODE_VERSION}`;
const CLAUDE_CODE_MAX_OUTPUT_TOKENS = 64_000;
const BOOTSTRAP_URL =
  "https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=cli&model=claude-opus-4-8";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const BILLING_SYSTEM_MARKER = `"system":[{"type":"text","text":"${BILLING_HEADER_PREFIX}`;
const CCH_PLACEHOLDER = "cch=00000";
const CCH_SEED = 0x4d659218e32a3268n;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OAUTH_AUTH_BETA = "oauth-2025-04-20"; // gitleaks:allow -- protocol beta, not a credential

const OAUTH_UTILITY_BETAS = [
  OAUTH_AUTH_BETA, // gitleaks:allow -- protocol beta, not a credential
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
] as const;

const OAUTH_AGENT_BETAS = [
  "claude-code-20250219",
  OAUTH_AUTH_BETA, // gitleaks:allow -- protocol beta, not a credential
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
] as const;

// Pi 0.87's native serializer emits per-message effort, thinking binding controls
// and tool transitions. Keep their opt-ins alongside OMP's base betas; retaining
// the fields while dropping these headers causes 400s. Do not forward arbitrary
// upstream betas (notably the removed server fallback).
const NATIVE_PROTOCOL_BETAS = new Set([
  "mid-conversation-output-config-2026-07-01",
  "thinking-binding-controls-2026-08-01",
  "mid-conversation-tool-changes-2026-07-01",
]);

const ENFORCED_HEADERS = new Set(
  [
    "accept",
    "accept-encoding",
    "authorization",
    "connection",
    "content-length",
    "content-type",
    "anthropic-beta",
    "anthropic-dangerous-direct-browser-access",
    "anthropic-version",
    "user-agent",
    "x-api-key",
    "x-app",
    "x-claude-code-session-id",
    "x-client-request-id",
    "x-stainless-arch",
    "x-stainless-lang",
    "x-stainless-os",
    "x-stainless-package-version",
    "x-stainless-retry-count",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-timeout",
  ].map((name) => name.toLowerCase()),
);

const CLAUDE_CODE_CANONICAL_TOOL_NAMES = new Map(
  [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Grep",
    "Glob",
    "AskUserQuestion",
    "EnterPlanMode",
    "ExitPlanMode",
    "KillShell",
    "NotebookEdit",
    "Skill",
    "Task",
    "TaskOutput",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
  ].map((name) => [name.toLowerCase(), name]),
);

const ANTHROPIC_BUILTIN_TOOL_NAMES = new Set([
  "web_search",
  "code_execution",
  "text_editor",
  "computer",
]);

const MASK64 = 0xffffffffffffffffn;
const XXH_PRIME1 = 11400714785074694791n;
const XXH_PRIME2 = 14029467366897019727n;
const XXH_PRIME3 = 1609587929392839161n;
const XXH_PRIME4 = 9650029242287828579n;
const XXH_PRIME5 = 2870177450012600261n;

interface JsonRecord {
  [key: string]: unknown;
}

interface AnthropicIdentity {
  accountId?: string;
}

export interface AnthropicRouteContext {
  installId: string;
  sessionId?: string;
  modelId: string;
  messages: readonly unknown[];
  tools?: readonly { name: string }[];
  identityResolver: AnthropicIdentityResolver;
}

export interface OmpRouteInspection {
  routed: boolean;
  url: string;
  headers?: Headers;
  body?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function u64(value: bigint): bigint {
  return value & MASK64;
}

function rotl64(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK64;
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

function readU32Le(bytes: Uint8Array, offset: number): bigint {
  return BigInt(
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>> 0,
  );
}

function xxhRound(accumulator: bigint, input: bigint): bigint {
  return u64(rotl64(u64(accumulator + u64(input * XXH_PRIME2)), 31n) * XXH_PRIME1);
}

function xxhMergeRound(accumulator: bigint, value: bigint): bigint {
  return u64((accumulator ^ xxhRound(0n, value)) * XXH_PRIME1 + XXH_PRIME4);
}

/** XXHash64, used by Claude Code's request-body billing attestation. */
export function xxhash64(bytes: Uint8Array, seed = 0n): bigint {
  let offset = 0;
  let hash: bigint;

  if (bytes.length >= 32) {
    let value1 = u64(seed + XXH_PRIME1 + XXH_PRIME2);
    let value2 = u64(seed + XXH_PRIME2);
    let value3 = seed;
    let value4 = u64(seed - XXH_PRIME1);
    const limit = bytes.length - 32;

    while (offset <= limit) {
      value1 = xxhRound(value1, readU64Le(bytes, offset));
      offset += 8;
      value2 = xxhRound(value2, readU64Le(bytes, offset));
      offset += 8;
      value3 = xxhRound(value3, readU64Le(bytes, offset));
      offset += 8;
      value4 = xxhRound(value4, readU64Le(bytes, offset));
      offset += 8;
    }

    hash = u64(
      rotl64(value1, 1n) +
        rotl64(value2, 7n) +
        rotl64(value3, 12n) +
        rotl64(value4, 18n),
    );
    hash = xxhMergeRound(hash, value1);
    hash = xxhMergeRound(hash, value2);
    hash = xxhMergeRound(hash, value3);
    hash = xxhMergeRound(hash, value4);
  } else {
    hash = u64(seed + XXH_PRIME5);
  }

  hash = u64(hash + BigInt(bytes.length));

  while (offset + 8 <= bytes.length) {
    const lane = xxhRound(0n, readU64Le(bytes, offset));
    hash = u64(rotl64(hash ^ lane, 27n) * XXH_PRIME1 + XXH_PRIME4);
    offset += 8;
  }

  if (offset + 4 <= bytes.length) {
    hash = u64(
      rotl64(hash ^ u64(readU32Le(bytes, offset) * XXH_PRIME1), 23n) *
        XXH_PRIME2 +
        XXH_PRIME3,
    );
    offset += 4;
  }

  while (offset < bytes.length) {
    hash = u64(
      rotl64(hash ^ u64(BigInt(bytes[offset] ?? 0) * XXH_PRIME5), 11n) *
        XXH_PRIME1,
    );
    offset += 1;
  }

  hash ^= hash >> 33n;
  hash = u64(hash * XXH_PRIME2);
  hash ^= hash >> 29n;
  hash = u64(hash * XXH_PRIME3);
  hash ^= hash >> 32n;
  return u64(hash);
}

export function readInstallId(filePath: string): string | undefined {
  try {
    const value = readFileSync(filePath, "utf8").trim();
    return UUID_RE.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function loadOrCreateInstallId(filePath: string): string {
  try {
    const existing = readFileSync(filePath, "utf8").trim();
    if (UUID_RE.test(existing)) return existing;
    if (existing.length > 0) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
  } catch {}

  const next = randomUUID();
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  try {
    const descriptor = openSync(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      writeSync(descriptor, `${next}\n`);
    } finally {
      closeSync(descriptor);
    }
    return next;
  } catch {
    try {
      const winner = readFileSync(filePath, "utf8").trim();
      if (UUID_RE.test(winner)) return winner;
    } catch {}
    return next;
  }
}

export class AnthropicIdentityResolver {
  private resolved: Promise<AnthropicIdentity> | undefined;

  resolve(
    accessToken: string,
    fetchImpl: typeof globalThis.fetch,
    signal?: AbortSignal | null,
  ): Promise<AnthropicIdentity> {
    this.resolved ??= this.fetchIdentity(accessToken, fetchImpl, signal);
    return this.resolved;
  }

  private async fetchIdentity(
    accessToken: string,
    fetchImpl: typeof globalThis.fetch,
    signal?: AbortSignal | null,
  ): Promise<AnthropicIdentity> {
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      const response = await fetchImpl(BOOTSTRAP_URL, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": CLAUDE_CODE_BOOTSTRAP_USER_AGENT,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: requestSignal,
      });
      if (!response.ok) return {};

      const data = (await response.json()) as {
        oauth_account?: { account_uuid?: unknown };
      };
      return { accountId: nonEmptyString(data.oauth_account?.account_uuid) };
    } catch {
      // Identity is optional on OMP's wire path. Never prevent inference when
      // the best-effort bootstrap lookup is unavailable.
      return {};
    }
  }
}

function mapStainlessOs(platform: string): string {
  switch (platform.toLowerCase()) {
    case "darwin":
      return "MacOS";
    case "windows":
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    case "freebsd":
      return "FreeBSD";
    default:
      return `Other::${platform.toLowerCase()}`;
  }
}

function mapStainlessArch(architecture: string): string {
  switch (architecture.toLowerCase()) {
    case "amd64":
    case "x64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "386":
    case "x86":
    case "ia32":
      return "x86";
    default:
      return `other::${architecture.toLowerCase()}`;
  }
}

function bearerOAuthToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  if (!authorization) return undefined;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  return token?.includes("sk-ant-oat") ? token : undefined;
}

function isOfficialMessagesUrl(input: RequestInfo | URL): boolean {
  try {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    return url.origin === "https://api.anthropic.com" &&
      url.pathname.replace(/\/+$/, "") === "/v1/messages";
  } catch {
    return false;
  }
}

function withBetaQuery(input: RequestInfo | URL): string {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  url.searchParams.set("beta", "true");
  return url.toString();
}

function firstUserMessageText(messages: readonly unknown[]): string {
  for (const candidate of messages) {
    if (!isRecord(candidate) || candidate.role !== "user") continue;
    if (typeof candidate.content === "string") return candidate.content;
    if (!Array.isArray(candidate.content)) return "";
    for (const block of candidate.content) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
    }
    return "";
  }
  return "";
}

function createBillingHeader(firstUserText: string): string {
  const fingerprintCharacters = [4, 7, 20]
    .map((index) => firstUserText[index] ?? "0")
    .join("");
  const versionSuffix = createHash("sha256")
    .update(`59cf53e54c78${fingerprintCharacters}${CLAUDE_CODE_VERSION}`)
    .digest("hex")
    .slice(0, 3);
  return `${BILLING_HEADER_PREFIX} cc_version=${CLAUDE_CODE_VERSION}.${versionSuffix}; cc_entrypoint=cli; ${CCH_PLACEHOLDER};`;
}

function deriveDeviceId(installId: string, accountId?: string): string {
  const hash = createHash("sha256");
  if (accountId) {
    return hash
      .update("omp-claude-device-id-v2")
      .update("\0")
      .update(installId)
      .update("\0")
      .update(accountId)
      .digest("hex");
  }
  return hash.update(`omp-claude-device-id-v1:${installId}`).digest("hex");
}

function cacheControlFromPayload(payload: JsonRecord): JsonRecord {
  const inspect = (value: unknown): JsonRecord | undefined => {
    if (!isRecord(value)) return undefined;
    const cache = value.cache_control;
    if (!isRecord(cache) || cache.type !== "ephemeral") return undefined;
    return cache.ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  };

  for (const collection of [payload.system, payload.tools]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const found = inspect(item);
      if (found) return found;
    }
  }

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (!isRecord(message) || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        const found = inspect(block);
        if (found) return found;
      }
    }
  }

  return { type: "ephemeral" };
}

function stripCacheControl(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { cache_control: _cacheControl, ...rest } = value;
  return rest;
}

function applyMessageCacheWindow(messages: unknown[], cacheControl: JsonRecord): void {
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    message.content = message.content.map(stripCacheControl);
  }

  let end = messages.length - 1;
  const trailing = messages[end];
  const previous = messages[end - 1];
  if (
    isRecord(trailing) &&
    trailing.role === "user" &&
    trailing.content === "Continue." &&
    isRecord(previous) &&
    previous.role === "assistant"
  ) {
    end -= 1;
  }

  let eligibleMessages = 0;
  for (let index = end; index >= 0 && eligibleMessages < 2; index--) {
    const message = messages[index];
    if (
      !isRecord(message) ||
      message.clear_at === "next_user_message"
    ) {
      continue;
    }
    eligibleMessages += 1;

    if (typeof message.content === "string") {
      message.content = [
        { type: "text", text: message.content, cache_control: { ...cacheControl } },
      ];
      continue;
    }
    if (!Array.isArray(message.content)) continue;

    for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = message.content[blockIndex];
      if (!isRecord(block)) continue;
      if (
        block.type === "thinking" ||
        block.type === "redacted_thinking" ||
        block.type === "fallback" ||
        block.type === "tool_addition" ||
        block.type === "tool_removal"
      ) {
        continue;
      }
      message.content[blockIndex] = { ...block, cache_control: { ...cacheControl } };
      break;
    }
  }
}

function oldClaudeCodeToolName(name: string): string {
  return CLAUDE_CODE_CANONICAL_TOOL_NAMES.get(name.toLowerCase()) ?? name;
}

function ompClaudeCodeToolName(name: string): string {
  return ANTHROPIC_BUILTIN_TOOL_NAMES.has(name.toLowerCase()) ? name : `_${name}`;
}

function buildToolNameMap(tools: readonly { name: string }[] | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const tool of tools ?? []) {
    names.set(oldClaudeCodeToolName(tool.name).toLowerCase(), ompClaudeCodeToolName(tool.name));
    names.set(tool.name.toLowerCase(), ompClaudeCodeToolName(tool.name));
  }
  return names;
}

function rewriteToolName(name: unknown, names: Map<string, string>): unknown {
  if (typeof name !== "string") return name;
  const mapped = names.get(name.toLowerCase());
  if (mapped) return mapped;
  if (name.startsWith("_")) return `_${name}`;
  return ompClaudeCodeToolName(name);
}

function rewritePayloadToolNames(payload: JsonRecord, tools: readonly { name: string }[] | undefined): void {
  const names = buildToolNameMap(tools);

  if (Array.isArray(payload.tools)) {
    payload.tools = payload.tools.map((tool) =>
      isRecord(tool)
        ? { ...stripCacheControl(tool) as JsonRecord, name: rewriteToolName(tool.name, names) }
        : tool,
    );
  }

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (!isRecord(message) || !Array.isArray(message.content)) continue;
      message.content = message.content.map((block) => {
        if (!isRecord(block)) return block;
        if (block.type === "tool_use") {
          return { ...block, name: rewriteToolName(block.name, names) };
        }
        if (
          (block.type === "tool_addition" || block.type === "tool_removal") &&
          isRecord(block.tool) && block.tool.type === "tool_reference"
        ) {
          return {
            ...block,
            tool: { ...block.tool, name: rewriteToolName(block.tool.name, names) },
          };
        }
        if (block.type === "tool_reference") {
          return {
            ...block,
            ...(typeof block.name === "string"
              ? { name: rewriteToolName(block.name, names) }
              : {}),
            ...(typeof block.tool_name === "string"
              ? { tool_name: rewriteToolName(block.tool_name, names) }
              : {}),
          };
        }
        return block;
      });
    }
  }

  if (isRecord(payload.tool_choice) && typeof payload.tool_choice.name === "string") {
    payload.tool_choice = {
      ...payload.tool_choice,
      name: rewriteToolName(payload.tool_choice.name, names),
    };
  }
}

function shouldInjectClaudeCodeIdentity(modelId: string): boolean {
  return !/^claude-3-5-haiku(?:-|$)/i.test(modelId);
}

function stripPiDocumentationBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Pi documentation (read only"));
  if (start < 0) return text;
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].startsWith("- ") || lines[end].startsWith("  ") || lines[end].trim() === "")
  ) {
    end += 1;
  }
  if (end === start + 1) return text;
  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function alignSystemBlocks(
  payload: JsonRecord,
  firstUserText: string,
  cacheControl: JsonRecord,
  injectIdentity: boolean,
): void {
  const existing = typeof payload.system === "string"
    ? [{ type: "text", text: payload.system }]
    : Array.isArray(payload.system)
      ? payload.system
      : [];
  const userBlocks = existing
    .filter((block) => {
      if (!isRecord(block) || typeof block.text !== "string") return true;
      return block.text !== CLAUDE_CODE_SYSTEM_INSTRUCTION &&
        !block.text.startsWith(BILLING_HEADER_PREFIX) &&
        block.text !== "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
    })
    .map(stripCacheControl)
    .map((block) =>
      isRecord(block) && typeof block.text === "string"
        ? { ...block, text: stripPiDocumentationBlock(block.text) }
        : block,
    )
    .filter((block) => !isRecord(block) || block.text !== "");

  if (!injectIdentity) {
    if (userBlocks.length > 0) payload.system = userBlocks;
    else delete payload.system;
    return;
  }

  payload.system = [
    { type: "text", text: createBillingHeader(firstUserText) },
    {
      type: "text",
      text: CLAUDE_CODE_SYSTEM_INSTRUCTION,
      cache_control: { ...cacheControl },
    },
    ...userBlocks,
  ];
}

function buildOAuthBetas(payload: JsonRecord, originalHeaders: Headers): string {
  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;
  const thinking = isRecord(payload.thinking) &&
    (payload.thinking.type === "adaptive" || payload.thinking.type === "enabled");
  const agentRequest = hasTools || thinking;
  const betas: string[] = [...(agentRequest ? OAUTH_AGENT_BETAS : OAUTH_UTILITY_BETAS)];
  if (agentRequest && thinking) betas.push("effort-2025-11-24");
  if (agentRequest) betas.push("fallback-credit-2026-06-01");
  if (cacheControlFromPayload(payload).ttl === "1h") betas.push("extended-cache-ttl-2025-04-11");
  if (Array.isArray(payload.fallbacks) && payload.fallbacks.length > 0) {
    betas.push("server-side-fallback-2026-06-01");
  }
  for (const beta of (originalHeaders.get("anthropic-beta") ?? "").split(",")) {
    const name = beta.trim();
    if (NATIVE_PROTOCOL_BETAS.has(name)) betas.push(name);
  }
  return [...new Set(betas)].join(",");
}

function buildAlignedPayload(
  original: JsonRecord,
  route: AnthropicRouteContext,
  identity: AnthropicIdentity,
  requestSessionId: string,
): JsonRecord {
  const payload = structuredClone(original);
  const cacheControl = cacheControlFromPayload(payload);
  const injectIdentity = shouldInjectClaudeCodeIdentity(route.modelId);

  if (Array.isArray(payload.messages)) {
    applyMessageCacheWindow(payload.messages, cacheControl);
  }
  rewritePayloadToolNames(payload, route.tools);
  // OMP anchors the last non-deferred tool as well as the identity
  // system block. With two tail anchors this stays within the four-block cap.
  if (Array.isArray(payload.tools)) {
    const lastTool = [...payload.tools].reverse().find(tool => isRecord(tool) && !tool.defer_loading);
    if (isRecord(lastTool)) lastTool.cache_control = { ...cacheControl };
  }
  alignSystemBlocks(
    payload,
    firstUserMessageText(route.messages),
    cacheControl,
    injectIdentity,
  );

  if (injectIdentity && !Array.isArray(payload.tools)) payload.tools = [];

  const accountId = identity.accountId;
  const userId: JsonRecord = {
    device_id: deriveDeviceId(route.installId, accountId),
    session_id: requestSessionId,
  };
  if (accountId) userId.account_uuid = accountId;
  payload.metadata = { user_id: JSON.stringify(userId) };

  // Pi's catalog-level allowedFallbackModels is an automatic client fallback,
  // but its native adapter serializes that list as an Anthropic server-side
  // fallback on every request. OMP only sends server fallback when explicitly
  // enabled in its settings, so remove Pi's automatic payload here.
  delete payload.fallbacks;

  const requestedMax = typeof payload.max_tokens === "number"
    ? payload.max_tokens
    : CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  payload.max_tokens = Math.min(requestedMax, CLAUDE_CODE_MAX_OUTPUT_TOKENS);

  if (
    isRecord(payload.thinking) &&
    (payload.thinking.type === "adaptive" || payload.thinking.type === "enabled")
  ) {
    payload.context_management = {
      edits: [{ type: "clear_thinking_20251015", keep: "all" }],
    };
  } else {
    delete payload.context_management;
  }

  payload.stream = true;

  // Match OMP's canonical top-level insertion order before attesting the exact
  // serialized bytes. Unknown/provider-new fields are retained afterwards.
  const ordered: JsonRecord = {};
  const canonicalKeys = [
    "model",
    "messages",
    "system",
    "tools",
    "metadata",
    "max_tokens",
    "thinking",
    "context_management",
    "output_config",
    "fallbacks",
    "anthropic_beta",
    "stream",
  ];
  for (const key of canonicalKeys) {
    if (Object.hasOwn(payload, key)) ordered[key] = payload[key];
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = value;
  }
  return ordered;
}

function attestSerializedPayload(payload: JsonRecord): string {
  const withPlaceholder = JSON.stringify(payload);
  const billingIndex = withPlaceholder.indexOf(BILLING_SYSTEM_MARKER);
  const placeholderIndex = withPlaceholder.indexOf(
    CCH_PLACEHOLDER,
    billingIndex + BILLING_SYSTEM_MARKER.length,
  );
  if (
    billingIndex < 0 ||
    placeholderIndex < 0 ||
    placeholderIndex - (billingIndex + BILLING_SYSTEM_MARKER.length) > 150
  ) {
    return withPlaceholder;
  }

  const hash = xxhash64(new TextEncoder().encode(withPlaceholder), CCH_SEED);
  const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
  return `${withPlaceholder.slice(0, placeholderIndex)}cch=${cch}${withPlaceholder.slice(
    placeholderIndex + CCH_PLACEHOLDER.length,
  )}`;
}

function buildAlignedHeaders(
  original: Headers,
  authorization: string,
  sessionId: string,
  betaHeader: string,
): Record<string, string> {
  const preserved: Record<string, string> = {};
  for (const [name, value] of original.entries()) {
    if (!ENFORCED_HEADERS.has(name.toLowerCase())) preserved[name] = value;
  }

  return {
    ...preserved,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": CLAUDE_CODE_USER_AGENT,
    "X-Claude-Code-Session-Id": sessionId,
    "X-Stainless-Arch": mapStainlessArch(process.arch),
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": mapStainlessOs(process.platform),
    "X-Stainless-Package-Version": CLAUDE_CODE_SDK_VERSION,
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v26.3.0",
    "X-Stainless-Timeout": "600",
    "anthropic-beta": betaHeader,
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-version": "2023-06-01",
    Authorization: authorization,
    "x-app": "cli",
    Connection: "keep-alive",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };
}

function rewriteSseDataLine(line: string): string {
  const carriageReturn = line.endsWith("\r") ? "\r" : "";
  const withoutCarriageReturn = carriageReturn ? line.slice(0, -1) : line;
  const match = withoutCarriageReturn.match(/^(data:\s*)(.*)$/);
  if (!match) return line;

  try {
    const event = JSON.parse(match[2]) as JsonRecord;
    if (
      event.type === "content_block_start" &&
      isRecord(event.content_block) &&
      event.content_block.type === "tool_use" &&
      typeof event.content_block.name === "string" &&
      event.content_block.name.startsWith("_")
    ) {
      event.content_block = {
        ...event.content_block,
        name: event.content_block.name.slice(1),
      };
      return `${match[1]}${JSON.stringify(event)}${carriageReturn}`;
    }
  } catch {}
  return line;
}

function rewriteAnthropicSse(response: Response): Response {
  if (!response.body) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream")) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const transformed = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          controller.enqueue(encoder.encode(`${rewriteSseDataLine(line)}\n`));
          newline = pending.indexOf("\n");
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(rewriteSseDataLine(pending)));
      },
    }),
  );

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function bodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return undefined;
}

/**
 * Wrap a fetch implementation so only direct, OAuth-authenticated Anthropic
 * Messages requests receive OMP's wire routing. API-key and proxy traffic is
 * passed through byte-for-byte.
 */
export function createOmpAnthropicFetch(
  baseFetch: typeof globalThis.fetch,
  route: AnthropicRouteContext,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const originalHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const accessToken = bearerOAuthToken(originalHeaders);
    if (!accessToken || !isOfficialMessagesUrl(input)) return baseFetch(input, init);

    const rawBody = await bodyText(init?.body);
    if (!rawBody) return baseFetch(input, init);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return baseFetch(input, init);
    }
    if (!isRecord(parsed)) return baseFetch(input, init);

    const requestSessionId = route.sessionId ?? randomUUID();
    const identity = await route.identityResolver.resolve(accessToken, baseFetch, init?.signal);
    const payload = buildAlignedPayload(parsed, route, identity, requestSessionId);
    const body = attestSerializedPayload(payload);
    const headers = buildAlignedHeaders(
      originalHeaders,
      `Bearer ${accessToken}`,
      requestSessionId,
      buildOAuthBetas(payload, originalHeaders),
    );
    const response = await baseFetch(withBetaQuery(input), { ...init, headers, body });
    return rewriteAnthropicSse(response);
  };
}

/** Test/debug helper; never includes the OAuth token in its result. */
export async function inspectOmpRoutedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  route: AnthropicRouteContext,
): Promise<OmpRouteInspection> {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const captureFetch: typeof globalThis.fetch = async (nextInput, nextInit) => {
    const url = nextInput instanceof Request ? nextInput.url : String(nextInput);
    if (url.startsWith("https://api.anthropic.com/api/claude_cli/bootstrap")) {
      return new Response(JSON.stringify({ oauth_account: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    capturedUrl = url;
    capturedInit = nextInit;
    return new Response(
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };
  await createOmpAnthropicFetch(captureFetch, route)(input, init);
  return {
    routed: capturedUrl.length > 0 && capturedUrl.includes("beta=true"),
    url: capturedUrl,
    headers: capturedInit ? new Headers(capturedInit.headers) : undefined,
    body: capturedInit ? await bodyText(capturedInit.body) : undefined,
  };
}
