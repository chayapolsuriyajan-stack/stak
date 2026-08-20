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
});
