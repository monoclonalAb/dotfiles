import assert from "node:assert/strict";
import test from "node:test";
import { OmpAnthropicTokenResolver } from "./omp-token.ts";

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
