import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

export class RpcError extends Error {
  constructor(message, uncertain = false, code) {
    super(message);
    this.uncertain = uncertain;
    this.code = code;
  }
}

// One LF-framed request per connection, bounded output and wait. A transport
// failure after write is ambiguous: never blindly replay a mutating request.
export function rpc(method, params, { socketPath = process.env.HERDR_SOCKET_PATH, timeoutMs = 60_000 } = {}) {
  if (!socketPath) return Promise.reject(new RpcError("Open Pi Tasks from inside Herdr."));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let sent = false;
    let settled = false;
    let buffer = "";
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    socket.setEncoding("utf8");
    const deadline = setTimeout(() => finish(new RpcError(`${method} timed out.`, sent)), timeoutMs);
    socket.on("error", (error) => finish(new RpcError(`${method}: ${error.message}`, sent)));
    socket.on("end", () => finish(new RpcError(`${method}: connection closed before reply.`, sent)));
    socket.on("connect", () => {
      sent = true;
      socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
    socket.on("data", (data) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        finish(new RpcError(`${method}: reply too large.`, sent));
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        if (response.id !== id) throw new Error("response ID mismatch");
        if (response.error) {
          finish(new RpcError(response.error.message, false, response.error.code));
        } else if (response.result) {
          finish(null, response.result);
        } else {
          throw new Error("missing result");
        }
      } catch (error) {
        finish(new RpcError(`${method}: invalid reply (${error.message}).`, sent));
      }
    });
  });
}
