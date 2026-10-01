import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBunFetch } from "./bun-fetch.ts";

test("Bun fetch bridge streams an HTTP response back to Node", async (context) => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => body += chunk);
    request.on("end", () => {
      response.writeHead(201, { "content-type": "text/plain", "x-echo": body });
      response.write("bridge_");
      setTimeout(() => response.end("ok"), 10);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  ));

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const bridgePath = fileURLToPath(new URL("./bun-fetch-bridge.ts", import.meta.url));
  const response = await createBunFetch(bridgePath)(`http://127.0.0.1:${address.port}/test`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "request_body",
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-echo"), "request_body");
  assert.equal(await response.text(), "bridge_ok");
});
