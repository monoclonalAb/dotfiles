import { describe, expect, test } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  abortable, createQuotaReader, MAX_CACHE_AGE_MS, parseClaude, parseCodex, POLL_MS, QuotaError, retryAfterMs,
  type Fetch, type Registry,
} from "./quota.ts";

export const codexToken = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
})).toString("base64url")}.signature`;
const signal = () => new AbortController().signal;
const window = (seconds = 18000, percent: unknown = 25) => ({
  limit_window_seconds: seconds, used_percent: percent, reset_at: 1_800_000_000,
});
export const codexFixture = () => ({ rate_limit: { primary_window: window(), secondary_window: window(604800, 31) } });
export const claudeFixture = () => ({
  five_hour: { utilization: 0, resets_at: null },
  seven_day: { utilization: 14, resets_at: "2026-09-15T00:00:00Z" },
});
function registry(token = codexToken, base?: string): Registry {
  return {
    getProvider: (provider) => ({ baseUrl: base ?? (provider === "anthropic" ? "https://api.anthropic.com" : "https://chatgpt.com/backend-api") }) as never,
    getProviderAuth: async () => ({ auth: { apiKey: token } }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("quota normalization", () => {
  test("Codex identifies 5h and weekly by duration, not primary/secondary position", () => {
    expect(parseCodex(codexFixture())).toEqual({ fiveHour: { usedPercent: 25, resetsAt: 1_800_000_000_000 }, weekly: { usedPercent: 31, resetsAt: 1_800_000_000_000 } });
    expect(parseCodex({ rate_limit: { primary_window: window(604800, 0), secondary_window: window(18000, 100) } }).weekly?.usedPercent).toBe(0);
  });

  test("Spark and every additional quota are never even traversed", () => {
    const fixture = codexFixture();
    Object.defineProperty(fixture, "additional_rate_limits", { get() { throw new Error("Do not inspect Spark"); } });
    expect(parseCodex(fixture).weekly?.usedPercent).toBe(31);
    const sparkOnly = { rate_limit: null, additional_rate_limits: [{ rate_limit: fixture.rate_limit }] };
    expect(parseCodex(sparkOnly)).toEqual({});
  });

  test("monthly/unknown windows do not get relabelled as 5h", () => {
    expect(parseCodex({ rate_limit: { primary_window: window(2592000), secondary_window: window(604800, 20) } })).toEqual({ weekly: { usedPercent: 20, resetsAt: 1_800_000_000_000 } });
  });

  test("absent/null quotas are unavailable; genuine zero remains zero", () => {
    expect(parseCodex({ rate_limit: { primary_window: null, secondary_window: window(604800, null) } })).toEqual({});
    expect(parseClaude({ five_hour: null, seven_day: { utilization: null } })).toEqual({});
    expect(parseClaude(claudeFixture()).fiveHour).toEqual({ usedPercent: 0 });
  });

  test("Claude keeps only global seven_day/five_hour, including reset metadata", () => {
    expect(parseClaude({ ...claudeFixture(), seven_day_opus: { utilization: 99 }, seven_day_routines: { utilization: 88 } })).toEqual({
      weekly: { usedPercent: 14, resetsAt: Date.parse("2026-09-15T00:00:00Z") }, fiveHour: { usedPercent: 0 },
    });
  });

  test.each([-1, 101, Infinity, NaN, "25", false])("invalid percentages cannot become healthy usage: %s", (percent) => {
    expect(() => parseCodex({ rate_limit: { primary_window: window(18000, percent) } })).toThrow(QuotaError);
    expect(() => parseClaude({ five_hour: { utilization: percent } })).toThrow(QuotaError);
  });

  test.each([null, [], "bad", {}, { error: "not authenticated" }].map((value) => [value]))("invalid envelopes fail visibly: %s", (data) => {
    expect(() => parseCodex(data)).toThrow(QuotaError);
    expect(() => parseClaude(data)).toThrow(QuotaError);
  });

  test("invalid reset metadata does not erase known percentages", () => {
    expect(parseClaude({ seven_day: { utilization: 14.5, resets_at: "nonsense" } })).toEqual({ weekly: { usedPercent: 14.5 } });
  });
});

describe("quota transport and credential boundary", () => {
  test("uses Pi auth and fixed GET endpoints with redirects disabled; no arbitrary auth headers forwarded", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const reg = registry();
    reg.getProviderAuth = async (provider) => ({ auth: {
      apiKey: provider === "anthropic" ? "sk-ant-oat-test" : codexToken,
      headers: { "Secret-Unrelated-Header": "must-not-forward" },
    } });
    const read = createQuotaReader(reg, async (url, init) => {
      calls.push([url, init]);
      return Response.json(url.includes("anthropic") ? claudeFixture() : codexFixture());
    });
    expect((await read("openai-codex", signal())).weekly?.usedPercent).toBe(31);
    expect((await read("anthropic", signal())).weekly?.usedPercent).toBe(14);
    expect(calls.map(([url]) => url)).toEqual(["https://chatgpt.com/backend-api/wham/usage", "https://api.anthropic.com/api/oauth/usage"]);
    expect(calls[0]![1].headers).toEqual({ Authorization: `Bearer ${codexToken}`, Accept: "application/json", "ChatGPT-Account-Id": "test-account" });
    expect(calls[1]![1].headers).toEqual({ Authorization: "Bearer sk-ant-oat-test", Accept: "application/json", "anthropic-beta": "oauth-2025-04-20" });
    for (const [, init] of calls) {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  test("missing credentials, API keys and custom proxy routes make no quota request", async () => {
    const neverFetch: Fetch = async () => { throw new Error("must not fetch"); };
    await expect(createQuotaReader(registry("sk-ant-api-key"), neverFetch)("anthropic", signal())).rejects.toMatchObject({ code: "oauth" });
    await expect(createQuotaReader(registry("not-a-jwt"), neverFetch)("openai-codex", signal())).rejects.toMatchObject({ code: "oauth" });
    const reg = registry(codexToken, "https://proxy.invalid");
    reg.getProviderAuth = async () => { throw new Error("must not resolve proxy auth"); };
    await expect(createQuotaReader(reg, neverFetch)("openai-codex", signal())).rejects.toMatchObject({ code: "unsupported" });
    const absent = registry();
    absent.getProviderAuth = async () => undefined;
    await expect(createQuotaReader(absent, neverFetch)("openai-codex", signal())).rejects.toMatchObject({ code: "login" });
    const override = registry();
    override.getProviderAuth = async () => ({ auth: { apiKey: codexToken, baseUrl: "https://proxy.invalid" } });
    await expect(createQuotaReader(override, neverFetch)("openai-codex", signal())).rejects.toMatchObject({ code: "unsupported" });
  });

  test.each([401, 403, 429, 500])("HTTP %s reports safe errors without reading response bodies", async (status) => {
    const read = createQuotaReader(registry(), async () => new Response("secret token and email must never appear", { status, headers: { "retry-after": "900" } }));
    try {
      await read("openai-codex", signal());
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(QuotaError);
      expect((error as Error).message).not.toMatch(/secret|email|token/);
      expect((error as QuotaError).code).toBe(status === 429 ? "rate-limit" : status < 500 ? "login" : "network");
      if (status === 429) expect((error as QuotaError).retryAfterMs).toBe(900_000);
    }
  });

  test("Anthropic readers share the successful snapshot, not just the cooldown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-quota-throttle-test-"));
    let now = 1_000_000;
    let calls = 0;
    const read = createQuotaReader(
      registry("sk-ant-oat-test"),
      async () => { calls++; return Response.json(claudeFixture()); },
      { throttleDir: dir, minIntervalMs: 60_000, now: () => now },
    );
    try {
      expect((await read("anthropic", signal()))?.weekly?.usedPercent).toBe(14);
      const second = createQuotaReader(registry("sk-ant-oat-test"), async () => {
        throw new Error("cache hit must not fetch");
      }, { throttleDir: dir, minIntervalMs: 60_000, now: () => now + 1000 });
      expect(await second("anthropic", signal())).toMatchObject({
        weekly: { usedPercent: 14 }, fiveHour: { usedPercent: 0 },
        fetchedAt: now, cached: true, stale: false, retryAt: now + 60_000,
      });
      expect(calls).toBe(1);
      now += 60_001;
      expect((await read("anthropic", signal()))?.weekly?.usedPercent).toBe(14);
      expect(calls).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("native auth and network exception strings never reach the footer", async () => {
    const reg = registry();
    reg.getProviderAuth = async () => { throw new Error("credential=SECRET"); };
    await expect(createQuotaReader(reg)("openai-codex", signal())).rejects.toMatchObject({ message: "login" });
    await expect(createQuotaReader(registry(), async () => { throw new Error("url?token=SECRET"); })("openai-codex", signal())).rejects.toMatchObject({ message: "network" });
  });

  test.each(["not JSON", "x".repeat(65 * 1024)])("malformed/oversized body is bounded and unavailable", async (body) => {
    await expect(createQuotaReader(registry(), async () => new Response(body))("openai-codex", signal())).rejects.toMatchObject({ code: "response" });
  });

  test("Retry-After uses bounded seconds/date values with conservative fallback", () => {
    expect(retryAfterMs("60")).toBe(POLL_MS);
    expect(retryAfterMs("900")).toBe(900_000);
    expect(retryAfterMs("999999")).toBe(3_600_000);
    expect(retryAfterMs("Wed, 09 Sep 2026 01:10:00 GMT", Date.parse("2026-09-09T01:00:00Z"))).toBe(600_000);
    expect(retryAfterMs("junk")).toBe(900_000);
    expect(retryAfterMs(null)).toBe(900_000);
  });

  test("cancelled auth is single-flight and cannot start a late request", async () => {
    const pending = deferred<any>();
    let authCalls = 0;
    let fetchCalls = 0;
    const reg = registry();
    reg.getProviderAuth = () => { authCalls++; return pending.promise; };
    const read = createQuotaReader(reg, async () => { fetchCalls++; return Response.json(codexFixture()); });
    const controller = new AbortController();
    const first = read("openai-codex", controller.signal);
    controller.abort();
    await expect(first).rejects.toBeDefined();
    const second = read("openai-codex", signal());
    pending.resolve({ auth: { apiKey: codexToken } });
    await second;
    expect(authCalls).toBe(1);
    expect(fetchCalls).toBe(1);
  });

  test("abortable waiting handles pre-aborted signals and late rejection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortable(Promise.reject(new Error("late")), controller.signal)).rejects.toBeDefined();
  });
});

function sharedClaudeFixture(now: number) {
  return { ...claudeFixture(), seven_day: { utilization: 14,
    resets_at: new Date(now + 7 * 24 * 60 * 60_000).toISOString() } };
}

async function withSharedCache(run: (fixture: {
  dir: string; now: number; token: string; calls: number; response: Fetch;
  reader(): ReturnType<typeof createQuotaReader>;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "pi-quota-cache-test-"));
  const fixture = {
    dir, now: Date.now(), token: "sk-ant-oat-test", calls: 0,
    response: (async () => Response.json(sharedClaudeFixture(fixture.now))) as Fetch,
    reader() {
      const reg = registry();
      reg.getProviderAuth = async () => ({ auth: { apiKey: fixture.token } });
      return createQuotaReader(reg, async (url, init) => {
        fixture.calls++;
        return fixture.response(url, init);
      }, { throttleDir: dir, now: () => fixture.now });
    },
  };
  try { await run(fixture); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

describe("shared Claude cache", () => {
  test("concurrent cold OS processes converge on one GET and one timestamp", async () => {
    await withSharedCache(async (c) => {
      const module = pathToFileURL(join(import.meta.dir, "quota.ts")).href;
      const code = `
        import { createQuotaReader } from ${JSON.stringify(module)};
        import { appendFileSync } from 'node:fs';
        const read = createQuotaReader({
          getProvider: () => ({ baseUrl: 'https://api.anthropic.com' }),
          getProviderAuth: async () => ({ auth: { apiKey: 'sk-ant-oat-test' } }),
        }, async () => {
          appendFileSync(${JSON.stringify(join(c.dir, "requests"))}, 'GET\\n');
          await new Promise(r => setTimeout(r, 250));
          return Response.json(${JSON.stringify(sharedClaudeFixture(c.now))});
        }, { throttleDir: ${JSON.stringify(c.dir)}, now: () => ${c.now} });
        console.log(JSON.stringify(await read('anthropic', AbortSignal.timeout(5000))));
      `;
      const outputs = await Promise.all(Array.from({ length: 4 }, () =>
        promisify(execFile)(process.execPath, ["--eval", code], { timeout: 10_000 })));
      const readings = outputs.map(({ stdout }) => JSON.parse(stdout));
      expect(await readFile(join(c.dir, "requests"), "utf8")).toBe("GET\n");
      expect(readings.filter((r) => r.cached === false)).toHaveLength(1);
      expect(readings.filter((r) => r.cached === true)).toHaveLength(3);
      for (const r of readings) {
        expect(r.fetchedAt).toBe(c.now);
        expect(r.weekly.usedPercent).toBe(14);
        expect(r.fiveHour.usedPercent).toBe(0);
      }
    });
  });

  test("only a private, normalized, single-slot snapshot survives a read", async () => {
    await withSharedCache(async (c) => {
      c.response = async () => Response.json({ ...sharedClaudeFixture(c.now), email: "discard@example.invalid",
        credential: "never-write-me", seven_day_opus: { utilization: 99 } });
      await c.reader()("anthropic", signal());
      expect((await readdir(c.dir)).sort()).toEqual(["anthropic.json", "anthropic.next"]);
      const text = await readFile(join(c.dir, "anthropic.json"), "utf8");
      expect(text).not.toMatch(/sk-ant|discard|never-write|opus|email|credential/);
      expect(JSON.parse(text)).toEqual({ version: 1,
        scope: createHash("sha256").update(c.token).digest("hex"),
        snapshot: { quota: parseClaude(sharedClaudeFixture(c.now)), fetchedAt: c.now },
      });
      expect((await stat(c.dir)).mode & 0o777).toBe(0o700);
      for (const name of await readdir(c.dir)) expect((await stat(join(c.dir, name))).mode & 0o777).toBe(0o600);
    });
  });

  test("token changes cannot reuse cached percentages or bypass the shared cadence", async () => {
    await withSharedCache(async (c) => {
      const read = c.reader();
      await read("anthropic", signal());
      c.token = "sk-ant-oat-different-login-or-rotation";
      await expect(read("anthropic", signal())).rejects.toMatchObject({ code: "cooldown", retryAfterMs: 900_000 });
      c.now += 900_001;
      c.response = async () => Response.json({ seven_day: { utilization: 77 } });
      expect((await read("anthropic", signal()))?.weekly?.usedPercent).toBe(77);
      c.token = "sk-ant-oat-test";
      await expect(read("anthropic", signal())).rejects.toMatchObject({ code: "cooldown" });
      expect(c.calls).toBe(2);
    });
  });

  test("missing auth, API-key and proxy routes cannot fall back to a cached login", async () => {
    await withSharedCache(async (c) => {
      await c.reader()("anthropic", signal());
      for (const reg of [registry(""), registry("sk-ant-api-key"), registry(c.token, "https://proxy.invalid")]) {
        const read = createQuotaReader(reg, async () => { throw new Error("must not fetch"); }, { throttleDir: c.dir });
        await expect(read("anthropic", signal())).rejects.toBeInstanceOf(QuotaError);
      }
      const absent = registry();
      absent.getProviderAuth = async () => undefined;
      await expect(createQuotaReader(absent, undefined, { throttleDir: c.dir })("anthropic", signal()))
        .rejects.toMatchObject({ code: "login" });
    });
  });

  test.each([401, 403])("HTTP %s invalidates the shared snapshot rather than hiding rejected auth", async (status) => {
    await withSharedCache(async (c) => {
      await c.reader()("anthropic", signal());
      c.now += 900_001;
      c.response = async () => new Response("secret body", { status });
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "login" });
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "login" });
      expect(JSON.parse(await readFile(join(c.dir, "anthropic.json"), "utf8")).snapshot).toBeUndefined();
      expect(c.calls).toBe(2);
    });
  });

  test.each([429, 500])("HTTP %s keeps a stale same-login reading and shares the failure/backoff", async (status) => {
    await withSharedCache(async (c) => {
      await c.reader()("anthropic", signal());
      const fetchedAt = c.now;
      c.now += 900_001;
      c.response = async () => new Response("secret body", { status, headers: { "retry-after": "1200" } });
      const expected = { fetchedAt, cached: true, stale: true, weekly: { usedPercent: 14 },
        warning: status === 429 ? "rate-limit" : "network", retryAt: c.now + (status === 429 ? 1_200_000 : 900_000) };
      expect(await c.reader()("anthropic", signal())).toMatchObject(expected);
      expect(await c.reader()("anthropic", signal())).toMatchObject(expected);
      expect(c.calls).toBe(2);
      c.now = expected.retryAt;
      c.response = async () => Response.json({ seven_day: { utilization: 15 } });
      expect(await c.reader()("anthropic", signal())).toMatchObject({ fetchedAt: c.now, cached: false, stale: false });
      expect(await c.reader()("anthropic", signal())).not.toHaveProperty("warning");
    });
  });

  test("cold 429 is shared across new readers and manual refreshes", async () => {
    await withSharedCache(async (c) => {
      c.response = async () => new Response(null, { status: 429, headers: { "retry-after": "1200" } });
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit", retryAfterMs: 1_200_000 });
      c.now += 60_000;
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit", retryAfterMs: 1_140_000 });
      expect(c.calls).toBe(1);
    });
  });

  test("a short Retry-After still reports Claude's real shared minimum", async () => {
    await withSharedCache(async (c) => {
      c.response = async () => new Response(null, { status: 429, headers: { "retry-after": "60" } });
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit", retryAfterMs: 900_000 });
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit", retryAfterMs: 900_000 });
      expect(c.calls).toBe(1);
    });
  });

  test("cache expires after one hour, including while an extended backoff is active", async () => {
    await withSharedCache(async (c) => {
      await c.reader()("anthropic", signal());
      c.now += 900_001;
      c.response = async () => new Response(null, { status: 429, headers: { "retry-after": "3600" } });
      expect((await c.reader()("anthropic", signal()))?.stale).toBe(true);
      c.now += MAX_CACHE_AGE_MS - 900_001;
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit" });
      expect(c.calls).toBe(2);
    });
  });

  test("elapsed reset windows are omitted, never extrapolated to zero", async () => {
    await withSharedCache(async (c) => {
      c.response = async () => Response.json({
        five_hour: { utilization: 88, resets_at: new Date(c.now + 1000).toISOString() },
        seven_day: { utilization: 14, resets_at: new Date(c.now + 2000).toISOString() },
      });
      await c.reader()("anthropic", signal());
      c.now += 1000;
      const partial = await c.reader()("anthropic", signal());
      expect(partial).toMatchObject({ weekly: { usedPercent: 14 }, cached: true, stale: true });
      expect(partial?.fiveHour).toBeUndefined();
      c.now += 1000;
      await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "cooldown" });
      expect(c.calls).toBe(1);
    });
  });

  test.each(["broken", "oversized", "future", "invalid-percent", "null-window", "version", "wrong-scope"])(
    "%s cache is a miss, not fabricated usage or a cooldown bypass", async (damage) => {
      await withSharedCache(async (c) => {
        await c.reader()("anthropic", signal());
        const path = join(c.dir, "anthropic.json");
        const data = JSON.parse(await readFile(path, "utf8"));
        if (damage === "future") data.snapshot.fetchedAt = c.now + 1;
        if (damage === "invalid-percent") data.snapshot.quota.weekly.usedPercent = 101;
        if (damage === "null-window") data.snapshot.quota.weekly = null;
        if (damage === "version") data.version = 100;
        if (damage === "wrong-scope") data.scope = "wrong";
        await writeFile(path, damage === "broken" ? "{" : damage === "oversized" ? "x".repeat(4097) : JSON.stringify(data));
        await expect(c.reader()("anthropic", signal())).rejects.toMatchObject({ code: "cooldown" });
        expect(c.calls).toBe(1);
      });
    },
  );

  test("symlink cache is ignored and replaced atomically without overwriting its target", async () => {
    await withSharedCache(async (c) => {
      const path = join(c.dir, "anthropic.json");
      const other = join(c.dir, "do-not-change");
      await writeFile(other, "untouched");
      await symlink(other, path);
      expect((await c.reader()("anthropic", signal()))?.weekly?.usedPercent).toBe(14);
      expect(await readFile(other, "utf8")).toBe("untouched");
      expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
    });
  });

  test("dead lease recovery does not leave a cold cache permanently waiting", async () => {
    await withSharedCache(async (c) => {
      const path = join(c.dir, "anthropic.lock");
      await writeFile(path, "");
      await utimes(path, new Date(c.now - 31_000), new Date(c.now - 31_000));
      expect((await c.reader()("anthropic", signal()))?.weekly?.usedPercent).toBe(14);
      expect(c.calls).toBe(1);
      expect(await readdir(c.dir)).not.toContain("anthropic.lock");
    });
  });

  test("a cancelled cold follower makes no request and cannot remove the winner's lock", async () => {
    await withSharedCache(async (c) => {
      const path = join(c.dir, "anthropic.lock");
      await writeFile(path, "winner");
      const controller = new AbortController();
      const pending = c.reader()("anthropic", controller.signal);
      const deadline = setTimeout(() => controller.abort(), 30);
      try { await expect(pending).rejects.toBeDefined(); }
      finally { clearTimeout(deadline); }
      expect(await readFile(path, "utf8")).toBe("winner");
      expect(c.calls).toBe(0);
    });
  });

  test("an old request cannot remove or publish over a replacement lease", async () => {
    await withSharedCache(async (c) => {
      c.response = async () => {
        await unlink(join(c.dir, "anthropic.lock"));
        await writeFile(join(c.dir, "anthropic.lock"), "new-owner");
        return Response.json(sharedClaudeFixture(c.now));
      };
      await c.reader()("anthropic", signal());
      expect(await readFile(join(c.dir, "anthropic.lock"), "utf8")).toBe("new-owner");
      expect(await readdir(c.dir)).not.toContain("anthropic.json");
    });
  });

  test("unusable state path fails closed rather than multiplying usage requests", async () => {
    await withSharedCache(async (c) => {
      const path = join(c.dir, "not-a-directory");
      await writeFile(path, "untouched");
      const read = createQuotaReader(registry(c.token), async () => {
        throw new Error("must not fetch");
      }, { throttleDir: path });
      await expect(read("anthropic", signal())).rejects.toMatchObject({ code: "cache" });
    });
  });
});

test("account-scoped Claude caches isolate quota/backoff and reuse readings across readers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quota-scoped-"));
  try {
    let now = Date.parse("2026-09-14T00:00:00Z");
    const calls: string[] = [];
    const reader = (login: string) => createQuotaReader(registry(`sk-ant-oat-${login}`), async () => {
      calls.push(login);
      return login === "full" ? new Response(null, { status: 429, headers: { "retry-after": "1200" } })
        : Response.json({ seven_day: { utilization: 22 }, five_hour: { utilization: 0 } });
    }, { throttleDir: dir, accountScoped: true, now: () => now });
    await expect(reader("full")("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit" });
    expect(await reader("work")("anthropic", signal())).toMatchObject({ weekly: { usedPercent: 22 } });
    await expect(reader("full")("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit" });
    expect(await reader("work")("anthropic", signal())).toMatchObject({ weekly: { usedPercent: 22 }, cached: true });
    expect(calls).toEqual(["full", "work"]);
    expect((await readdir(dir)).every((name) => /^[a-f0-9]{64}$/.test(name))).toBe(true);
    now += 1_200_001;
    await expect(reader("full")("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit" });
    expect(calls).toEqual(["full", "work", "full"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test.each(["snapshot", "cold-backoff"])("scoped adoption honours legacy %s without mixing logins", async (kind) => {
  const dir = await mkdtemp(join(tmpdir(), "quota-legacy-"));
  try {
    let now = Date.parse("2026-09-14T00:00:00Z");
    let calls = 0;
    const old = createQuotaReader(registry("sk-ant-oat-main"), async () =>
      kind === "snapshot" ? Response.json(claudeFixture()) : new Response(null, { status: 429 }),
    { throttleDir: dir, now: () => now });
    await old("anthropic", signal()).catch(() => {});
    const scoped = (token: string) => createQuotaReader(registry(token), async () => {
      calls++;
      return Response.json({ seven_day: { utilization: 33 } });
    }, { throttleDir: dir, now: () => now, accountScoped: true });
    if (kind === "snapshot") expect(await scoped("sk-ant-oat-main")("anthropic", signal())).toMatchObject({ weekly: { usedPercent: 14 }, cached: true });
    else await expect(scoped("sk-ant-oat-main")("anthropic", signal())).rejects.toMatchObject({ code: "rate-limit" });
    expect(calls).toBe(0);
    expect(await scoped("sk-ant-oat-work")("anthropic", signal())).toMatchObject({ weekly: { usedPercent: 33 } });
    // An unknown legacy owner is conservative even without a usable snapshot.
    await unlink(join(dir, "anthropic.json"));
    await expect(scoped("sk-ant-oat-third")("anthropic", signal())).rejects.toMatchObject({ code: "cooldown" });
    expect(calls).toBe(1);
    now += 900_001;
    expect(await scoped("sk-ant-oat-main")("anthropic", signal())).toMatchObject({ weekly: { usedPercent: 33 }, cached: false });
    expect(calls).toBe(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("installed Pi ModelRegistry resolves synthetic OAuth credentials for both adapters", async () => {
  const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const root = join(globalRoot, "@earendil-works/pi-coding-agent");
  const sdk = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const ai = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
  const dir = await mkdtemp(join(tmpdir(), "pi-quota-auth-test-"));
  try {
    const credentials = new ai.InMemoryCredentialStore();
    for (const [provider, access] of [["openai-codex", codexToken], ["anthropic", "sk-ant-oat-test"]]) {
      await credentials.modify(provider, async () => ({ type: "oauth", access, refresh: "fake-unused", expires: Date.now() + 3_600_000 }));
    }
    const runtime = await sdk.ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(dir, "models.json"), refreshOnCreate: false, allowModelNetwork: false });
    const read = createQuotaReader(new sdk.ModelRegistry(runtime), async (url) => Response.json(url.includes("anthropic") ? claudeFixture() : codexFixture()));
    expect((await read("openai-codex", signal())).weekly?.usedPercent).toBe(31);
    expect((await read("anthropic", signal())).fiveHour?.usedPercent).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
