#!/usr/bin/env node
// Minimal JSON-RPC-2.0-over-stdio MCP server for tests. Not a real MCP SDK
// server on purpose — this is a hand-rolled fixture exercising just enough
// of the protocol (initialize, tools/list, tools/call) to drive
// src/mcp/client.test.ts against a real child process.
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const tools = [
  {
    name: "echo",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "boom",
    inputSchema: { type: "object", properties: {} },
  },
];

rl.on("line", (line) => {
  if (line.trim() === "") return;

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = request;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-server", version: "0.0.1" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    // STALL_TOOLS_LIST_MS lets client.test.ts exercise the connect+listTools
    // timeout: the server accepts and completes `initialize`, then never
    // responds to `tools/list` within the test's timeout window.
    const stallMs = Number(process.env["STALL_TOOLS_LIST_MS"] ?? "0");
    if (stallMs > 0) {
      setTimeout(() => send({ jsonrpc: "2.0", id, result: { tools } }), stallMs);
      return;
    }
    send({ jsonrpc: "2.0", id, result: { tools } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};

    if (name === "echo") {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: String(args.text) }] },
      });
      return;
    }

    if (name === "boom") {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "boom" }], isError: true },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
});
