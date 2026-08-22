import { describe, expect, test } from "vitest";
import { createMcpTool, formatMcpResult, mcpToolName } from "./toolAdapter.js";

describe("mcpToolName", () => {
  test("namespaces under the server", () => {
    expect(mcpToolName("filesystem", "read_file")).toBe("mcp__filesystem__read_file");
  });

  test("replaces characters outside [A-Za-z0-9_-]", () => {
    expect(mcpToolName("my server", "do thing!")).toBe("mcp__my_server__do_thing_");
  });

  test("truncates to 64 characters", () => {
    const name = mcpToolName("a".repeat(40), "b".repeat(40));
    expect(name.length).toBe(64);
    expect(name.startsWith("mcp__" + "a".repeat(40))).toBe(true);
  });
});

describe("formatMcpResult", () => {
  test("text-only content", () => {
    const result = formatMcpResult({ content: [{ type: "text", text: "hello" }] });
    expect(result).toEqual({ output: "hello" });
  });

  test("multiple text blocks are joined with newlines", () => {
    const result = formatMcpResult({
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    });
    expect(result.output).toBe("line1\nline2");
  });

  test("formats an image block", () => {
    // base64 length 4 -> 3 bytes -> 0 KB rounded
    const data = "a".repeat(4000);
    const result = formatMcpResult({ content: [{ type: "image", mimeType: "image/png", data }] });
    expect(result.output).toMatch(/^\[image image\/png, \d+ KB\]$/);
  });

  test("formats a resource block", () => {
    const result = formatMcpResult({
      content: [{ type: "resource", resource: { uri: "file:///foo.txt" } }],
    });
    expect(result.output).toBe("[resource file:///foo.txt]");
  });

  test("passes isError through", () => {
    const result = formatMcpResult({ content: [{ type: "text", text: "oops" }], isError: true });
    expect(result).toEqual({ output: "oops", isError: true });
  });

  test("empty content becomes '(no output)'", () => {
    const result = formatMcpResult({ content: [] });
    expect(result.output).toBe("(no output)");
  });
});

describe("createMcpTool", () => {
  test("execute happy path calls call() and formats the result", async () => {
    const tool = createMcpTool({
      serverName: "srv",
      tool: { name: "echo", description: "echoes", inputSchema: { type: "object" } },
      call: async (args) => ({ content: [{ type: "text", text: `got ${JSON.stringify(args)}` }] }),
    });

    expect(tool.name).toBe("mcp__srv__echo");
    expect(tool.description).toBe("(srv MCP) echoes");
    expect(tool.riskTier).toBe("bash");

    const result = await tool.execute({ text: "hi" } as never, { cwd: "/tmp" });
    expect(result).toEqual({ output: 'got {"text":"hi"}' });
  });

  test("execute catches a thrown error and returns isError: true", async () => {
    const tool = createMcpTool({
      serverName: "srv",
      tool: { name: "boom" },
      call: async () => {
        throw new Error("kaboom");
      },
    });

    const result = await tool.execute({} as never, { cwd: "/tmp" });
    expect(result).toEqual({ output: "kaboom", isError: true });
  });
});
