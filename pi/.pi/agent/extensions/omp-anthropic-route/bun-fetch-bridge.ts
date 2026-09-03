import * as tls from "node:tls";

interface BridgeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface BridgeResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
}

async function writeStdout(chunk: string | Uint8Array): Promise<void> {
  if (process.stdout.write(chunk)) return;
  await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

async function main(): Promise<void> {
  const input = JSON.parse(await Bun.stdin.text()) as BridgeRequest;
  const response = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    timeout: false,
    tls: {
      rejectUnauthorized: true,
      serverName: new URL(input.url).hostname,
      ciphers: tls.DEFAULT_CIPHERS,
    },
  });
  const metadata: BridgeResponse = {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
  await writeStdout(`${JSON.stringify(metadata)}\n`);
  if (!response.body) return;
  for await (const chunk of response.body) await writeStdout(chunk);
}

try {
  await main();
} catch {
  // Keep request headers/body (which contain the OAuth token) out of all error
  // output. The parent maps this sentinel to a generic transport failure.
  process.stdout.write('{"error":"bun_fetch_failed"}\n');
  process.exitCode = 1;
}
