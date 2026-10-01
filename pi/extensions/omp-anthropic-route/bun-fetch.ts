import { spawn } from "node:child_process";
import { commandEnvironment } from "./omp-compat.ts";

interface BridgeResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  error?: string;
}

const MAX_METADATA_BYTES = 64 * 1024;

function bodyString(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  throw new Error("OMP Bun fetch bridge received an unsupported request body");
}

/**
 * Create a fetch implementation backed by a short-lived Bun subprocess.
 * Request data, including Authorization, travels only over the child's stdin;
 * SSE response bytes stream back over stdout after one metadata JSON line.
 */
export function createBunFetch(bridgePath: string): typeof globalThis.fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const sourceHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const headers = Object.fromEntries(sourceHeaders.entries());
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = bodyString(init?.body);

    return new Promise<Response>((resolve, reject) => {
      const child = spawn("bun", [bridgePath], {
        stdio: ["pipe", "pipe", "ignore"],
        env: commandEnvironment(),
      });
      let metadataBuffer = Buffer.alloc(0);
      let metadataReceived = false;
      let responseSettled = false;
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const responseBody = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          child.kill("SIGTERM");
        },
      });

      const cleanupAbort = () => init?.signal?.removeEventListener("abort", onAbort);
      const fail = (message: string, cause?: unknown) => {
        if (!responseSettled) {
          responseSettled = true;
          reject(new Error(message, { cause }));
        } else {
          try {
            streamController?.error(new Error(message, { cause }));
          } catch {}
        }
      };
      const onAbort = () => {
        child.kill("SIGTERM");
        fail("OMP Bun fetch bridge request was aborted");
      };
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        cleanupAbort();
        fail("Could not start the OMP Bun fetch bridge", error);
      });
      child.stdout.on("error", (error) => {
        fail("OMP Bun fetch bridge response failed", error);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        if (metadataReceived) {
          streamController?.enqueue(new Uint8Array(chunk));
          return;
        }

        metadataBuffer = Buffer.concat([metadataBuffer, chunk]);
        if (metadataBuffer.length > MAX_METADATA_BYTES) {
          child.kill("SIGTERM");
          fail("OMP Bun fetch bridge returned oversized metadata");
          return;
        }
        const newline = metadataBuffer.indexOf(0x0a);
        if (newline < 0) return;

        let metadata: BridgeResponse;
        try {
          metadata = JSON.parse(metadataBuffer.subarray(0, newline).toString("utf8")) as BridgeResponse;
        } catch (error) {
          child.kill("SIGTERM");
          fail("OMP Bun fetch bridge returned invalid metadata", error);
          return;
        }
        if (metadata.error || !Number.isInteger(metadata.status)) {
          child.kill("SIGTERM");
          fail("OMP Bun fetch bridge could not complete the provider request");
          return;
        }

        metadataReceived = true;
        responseSettled = true;
        resolve(new Response(responseBody, {
          status: metadata.status,
          statusText: metadata.statusText,
          headers: metadata.headers,
        }));
        const remainder = metadataBuffer.subarray(newline + 1);
        metadataBuffer = Buffer.alloc(0);
        if (remainder.length > 0) streamController?.enqueue(new Uint8Array(remainder));
      });
      child.stdout.on("end", () => {
        if (metadataReceived) {
          try {
            streamController?.close();
          } catch {}
        }
      });
      child.on("close", (code, signal) => {
        cleanupAbort();
        if (!metadataReceived) {
          fail(`OMP Bun fetch bridge exited before responding (${signal ?? code ?? "unknown"})`);
        } else if (code !== 0) {
          fail(`OMP Bun fetch bridge exited unsuccessfully (${signal ?? code ?? "unknown"})`);
        }
      });

      child.stdin.on("error", (error) => {
        fail("Could not send the provider request to the OMP Bun fetch bridge", error);
      });
      child.stdin.end(JSON.stringify({ url, method, headers, body }));
    });
  };
}
