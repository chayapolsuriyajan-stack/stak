import { describe, expect, test } from "vitest";
import type { Message } from "../agent/types.js";
import { toAnthropicContent } from "./anthropic.js";

describe("toAnthropicContent", () => {
  test("maps text, tool_use, and tool_result blocks", () => {
    const blocks: Message["content"] = [
      { type: "text", text: "hello" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a" } },
      { type: "tool_result", toolUseId: "t1", content: "file body" },
    ];

    expect(toAnthropicContent(blocks)).toEqual([
      { type: "text", text: "hello" },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a" } },
      { type: "tool_result", tool_use_id: "t1", content: "file body", is_error: false },
    ]);
  });

  test("drops a thinking block entirely rather than sending it back to the API", () => {
    // Anthropic rejects an unsigned thinking block outright, and no adapter
    // requests native thinking from it, so one must never be replayed.
    const blocks: Message["content"] = [
      { type: "thinking", text: "internal reasoning" },
      { type: "text", text: "the answer" },
    ];

    const mapped = toAnthropicContent(blocks);

    expect(mapped).toEqual([{ type: "text", text: "the answer" }]);
    expect(JSON.stringify(mapped)).not.toContain("internal reasoning");
  });

  test("a message made up of only a thinking block maps to an empty array", () => {
    expect(toAnthropicContent([{ type: "thinking", text: "just thoughts" }])).toEqual([]);
  });
});
