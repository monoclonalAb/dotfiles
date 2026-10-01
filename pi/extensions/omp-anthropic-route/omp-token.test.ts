import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_CHANGED_ERROR, OmpAccountGuard, OmpAnthropicTokenResolver } from "./omp-token.ts";

test("OMP token resolver validates and briefly caches OAuth output", async () => {
  let calls = 0;
  const resolver = new OmpAnthropicTokenResolver(async () => {
    calls += 1;
    return "sk-ant-oat-test";
  });

  assert.equal(await resolver.resolve(), "sk-ant-oat-test");
  assert.equal(await resolver.resolve(), "sk-ant-oat-test");
  assert.equal(calls, 1);

  resolver.invalidate();
  assert.equal(await resolver.resolve(), "sk-ant-oat-test");
  assert.equal(calls, 2);
});

test("OMP token resolver rejects non-OAuth and multiline output", async () => {
  const apiKey = new OmpAnthropicTokenResolver(async () => "sk-ant-api-test");
  await assert.rejects(() => apiKey.resolve(), /did not return an Anthropic OAuth credential/);

  const multiline = new OmpAnthropicTokenResolver(async () => "notice\nsk-ant-oat-test");
  await assert.rejects(() => multiline.resolve(), /did not return an Anthropic OAuth credential/);
});

test("account guard accepts refreshed tokens for the verified account without re-lookup of known tokens", async () => {
  const accounts: Record<string, string> = { "sk-ant-oat-1": "acct", "sk-ant-oat-2": "acct", "sk-ant-oat-3": "acct" };
  const lookups: string[] = [];
  const guard = new OmpAccountGuard(async (token) => { lookups.push(token); return accounts[token]; });
  await guard.accept("sk-ant-oat-1");
  await guard.accept("sk-ant-oat-1");
  await Promise.all([guard.accept("sk-ant-oat-2"), guard.accept("sk-ant-oat-2")]);
  await guard.accept("sk-ant-oat-2");
  await guard.accept("sk-ant-oat-3");
  assert.deepEqual(lookups, ["sk-ant-oat-1", "sk-ant-oat-2", "sk-ant-oat-3"]);
});

test("account guard blocks a different or unidentifiable account", async () => {
  const accounts: Record<string, string | undefined> = { "sk-ant-oat-a": "acct-a", "sk-ant-oat-b": "acct-b", "sk-ant-oat-unknown": undefined };
  const guard = new OmpAccountGuard(async (token) => {
    if (token === "sk-ant-oat-error") throw new Error("network");
    return accounts[token];
  });
  await guard.accept("sk-ant-oat-a");
  for (const token of ["sk-ant-oat-b", "sk-ant-oat-unknown", "sk-ant-oat-error"]) {
    await assert.rejects(() => guard.accept(token), { message: ACCOUNT_CHANGED_ERROR });
  }
  await guard.accept("sk-ant-oat-a"); // the verified credential stays usable

  const unverified = new OmpAccountGuard(async () => undefined);
  await unverified.accept("sk-ant-oat-a");
  await assert.rejects(() => unverified.accept("sk-ant-oat-a2"), { message: ACCOUNT_CHANGED_ERROR });
});
