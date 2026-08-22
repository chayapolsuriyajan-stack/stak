import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { connectMcpServers } from "./client.js";
import type { NamedMcpServer } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER_PATH = path.join(__dirname, "__fixtures__", "echo-server.mjs");

function echoServer(name = "echo"): NamedMcpServer {
  return {
    name,
    source: "project",
    config: { type: "stdio", command: process.execPath, args: [ECHO_SERVER_PATH] },
  };
}

describe("connectMcpServers", () => {
  test("connects successfully and reports connected status with the right tool count", async () => {
    const conn = await connectMcpServers([echoServer()]);
    try {
      expect(conn.statuses).toEqual([
        { name: "echo", source: "project", state: "connected", toolCount: 2 },
      ]);
    } finally {
      await conn.close();
    }
  });

  test("produces tools list including a namespaced echo tool", async () => {
    const conn = await connectMcpServers([echoServer()]);
    try {
      const names = conn.tools.map((t) => t.name);
      expect(names).toContain("mcp__echo__echo");
      expect(names).toContain("mcp__echo__boom");
    } finally {
      await conn.close();
    }
  });

  test("executing the echo tool round-trips the text argument", async () => {
    const conn = await connectMcpServers([echoServer()]);
    try {
      const echoTool = conn.tools.find((t) => t.name === "mcp__echo__echo")!;
      const result = await echoTool.execute({ text: "hello world" } as never, { cwd: "/tmp" });
      expect(result.output).toBe("hello world");
      expect(result.isError).toBeFalsy();
    } finally {
      await conn.close();
    }
  });

  test("executing the boom tool yields isError: true", async () => {
    const conn = await connectMcpServers([echoServer()]);
    try {
      const boomTool = conn.tools.find((t) => t.name === "mcp__echo__boom")!;
      const result = await boomTool.execute({} as never, { cwd: "/tmp" });
      expect(result.isError).toBe(true);
    } finally {
      await conn.close();
    }
  });

  test("a server that stalls on tools/list past the timeout is reported as failed, not hung", async () => {
    const stalling: NamedMcpServer = {
      name: "stalling",
      source: "project",
      config: {
        type: "stdio",
        command: process.execPath,
        args: [ECHO_SERVER_PATH],
        env: { STALL_TOOLS_LIST_MS: "5000" },
      },
    };

    // Keep well under the fixture's 5s stall so this proves connectMcpServers
    // resolves instead of hanging, without slowing down the suite.
    const conn = await connectMcpServers([stalling, echoServer("good")], { timeoutMs: 250 });
    try {
      const stallingStatus = conn.statuses.find((s) => s.name === "stalling");
      const goodStatus = conn.statuses.find((s) => s.name === "good");

      expect(stallingStatus?.state).toBe("failed");
      expect(stallingStatus?.error).toBeTruthy();
      expect(goodStatus?.state).toBe("connected");
      expect(goodStatus?.toolCount).toBe(2);
    } finally {
      await conn.close();
    }
  }, 15_000);

  test("a nonexistent command fails without throwing, and other servers still succeed", async () => {
    const bad: NamedMcpServer = {
      name: "bad",
      source: "project",
      config: { type: "stdio", command: "definitely-not-a-real-binary-xyz" },
    };

    const conn = await connectMcpServers([bad, echoServer("good")]);
    try {
      const badStatus = conn.statuses.find((s) => s.name === "bad");
      const goodStatus = conn.statuses.find((s) => s.name === "good");

      expect(badStatus?.state).toBe("failed");
      expect(badStatus?.error).toBeTruthy();
      expect(goodStatus?.state).toBe("connected");
      expect(goodStatus?.toolCount).toBe(2);
    } finally {
      await conn.close();
    }
  }, 15_000);
});
