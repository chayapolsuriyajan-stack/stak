import { describe, expect, test } from "vitest";
import { summarizeToolCall } from "./toolSummary.js";

describe("summarizeToolCall", () => {
  test("shows the path for file tools", () => {
    expect(summarizeToolCall("read", { path: "src/cli.ts" })).toBe("src/cli.ts");
    expect(summarizeToolCall("write", { path: "a.txt", content: "hi" })).toBe("a.txt");
    expect(summarizeToolCall("edit", { path: "a.ts", old_string: "x", new_string: "y" })).toBe(
      "a.ts",
    );
  });

  test("shows the command for bash", () => {
    expect(summarizeToolCall("bash", { command: "npm test" })).toBe("npm test");
  });

  test("quotes the pattern for grep", () => {
    expect(summarizeToolCall("grep", { pattern: "TODO" })).toBe('"TODO"');
  });

  test("shows the pattern for glob", () => {
    expect(summarizeToolCall("glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  test("shows the skill name", () => {
    expect(summarizeToolCall("Skill", { name: "reviewer" })).toBe("reviewer");
  });

  test("falls back to truncated JSON for an unknown tool", () => {
    expect(summarizeToolCall("mystery", { a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  test("falls back to JSON when the expected field is missing or the wrong type", () => {
    expect(summarizeToolCall("read", {})).toBe("{}");
    expect(summarizeToolCall("bash", { command: 42 })).toBe('{"command":42}');
  });

  test("handles null/undefined input without throwing", () => {
    expect(summarizeToolCall("read", undefined)).toBe("{}");
    expect(summarizeToolCall("read", null)).toBe("{}");
  });

  test("truncates a very long fallback", () => {
    const long = summarizeToolCall("mystery", { text: "x".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("...")).toBe(true);
  });

  test("summarizes an MCP tool call as server/tool plus its compact args", () => {
    expect(summarizeToolCall("mcp__filesystem__read_file", { path: "a.txt" })).toBe(
      'filesystem/read_file {"path":"a.txt"}',
    );
  });

  test("summarizes an MCP tool call with an unambiguous server/tool name", () => {
    expect(summarizeToolCall("mcp__github__create_issue", { title: "bug" })).toBe(
      'github/create_issue {"title":"bug"}',
    );
  });

  test("leaves non-MCP tool summaries unaffected", () => {
    expect(summarizeToolCall("read", { path: "src/cli.ts" })).toBe("src/cli.ts");
    expect(summarizeToolCall("bash", { command: "npm test" })).toBe("npm test");
    expect(summarizeToolCall("mystery", { a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });
});
