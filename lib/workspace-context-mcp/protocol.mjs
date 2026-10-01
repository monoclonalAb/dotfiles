// Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0. Supports
// initialize, ping, tools/list, tools/call and empty resources/prompts lists.
// Tool failures are reported inside the result (isError) as the MCP
// specification requires; protocol failures use JSON-RPC error objects.

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
};

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function toTextResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const result = { content: [{ type: "text", text }] };
  if (isError) result.isError = true;
  return result;
}

/**
 * Creates a dispatcher for one MCP server. `tools` is an array of tool
 * definitions and `handlers` maps tool name -> async function(args).
 */
export function createMcpDispatcher({ serverInfo, instructions, tools, handlers, log = () => {} }) {
  let initialized = false;

  async function handleRequest(message) {
    const { id, method, params } = message;
    switch (method) {
      case "initialize": {
        const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
        const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions,
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools });
      case "tools/call": {
        const name = params && typeof params.name === "string" ? params.name : null;
        const args = params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        if (!name || !handlers[name]) {
          return rpcError(id, JSON_RPC_ERRORS.invalidParams, `Unknown tool: ${name}`);
        }
        try {
          const value = await handlers[name](args);
          const isError = Boolean(value && typeof value === "object" && !Array.isArray(value) && value.error);
          return rpcResult(id, toTextResult(value, isError));
        } catch (error) {
          log(`tool ${name} failed: ${error && error.stack ? error.stack : error}`);
          return rpcResult(id, toTextResult(`Error: ${error && error.message ? error.message : String(error)}`, true));
        }
      }
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      case "logging/setLevel":
        return rpcResult(id, {});
      default:
        return rpcError(id, JSON_RPC_ERRORS.methodNotFound, `Method not found: ${method}`);
    }
  }

  function handleNotification(message) {
    if (message.method === "notifications/initialized") initialized = true;
    // Other notifications (cancelled, progress, roots changed) are accepted and ignored.
  }

  /** Handles one parsed JSON value; returns a response object, an array (batch), or null. */
  async function handle(message) {
    if (Array.isArray(message)) {
      if (!message.length) return rpcError(null, JSON_RPC_ERRORS.invalidRequest, "Empty batch");
      const responses = await Promise.all(message.map((item) => handle(item)));
      const filtered = responses.filter((response) => response !== null);
      return filtered.length ? filtered : null;
    }
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      return rpcError(message && message.id, JSON_RPC_ERRORS.invalidRequest, "Invalid JSON-RPC 2.0 message");
    }
    if (typeof message.method === "string") {
      if (message.id === undefined || message.id === null) {
        handleNotification(message);
        return null;
      }
      return handleRequest(message);
    }
    // A response to a server-initiated request; this server never sends any.
    return null;
  }

  return { handle, isInitialized: () => initialized };
}

/**
 * Wires a dispatcher to newline-delimited JSON on the given streams. Returns a
 * promise that resolves when input ends.
 */
export function serveStdio(dispatcher, { input = process.stdin, output = process.stdout, log = () => {} } = {}) {
  let buffer = "";
  let pending = Promise.resolve();

  const write = (message) => {
    if (message === null || message === undefined) return;
    output.write(`${JSON.stringify(message)}\n`);
  };

  const processLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      write(rpcError(null, JSON_RPC_ERRORS.parse, `Parse error: ${error.message}`));
      return;
    }
    try {
      write(await dispatcher.handle(parsed));
    } catch (error) {
      log(`dispatch failed: ${error && error.stack ? error.stack : error}`);
      write(rpcError(parsed && parsed.id, JSON_RPC_ERRORS.internal, "Internal error"));
    }
  };

  return new Promise((resolvePromise) => {
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        pending = pending.then(() => processLine(line));
      }
    });
    input.on("end", () => {
      if (buffer.trim()) pending = pending.then(() => processLine(buffer));
      pending.then(() => resolvePromise());
    });
    input.on("error", () => pending.then(() => resolvePromise()));
  });
}
