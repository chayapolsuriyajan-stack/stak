import { describe, expect, test } from "vitest";
import type { Message } from "../agent/types.js";
import { toOpenAIMessages } from "./openai.js";

describe("toOpenAIMessages", () => {
  test("drops a thinking block entirely rather than sending it back to the API", () => {
    const history: Message[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "internal reasoning" },
          { type: "text", text: "the answer" },
        ],
      },
    ];

    const messages = toOpenAIMessages("system prompt", history);
    const serialized = JSON.stringify(messages);

    expect(serialized).not.toContain("internal reasoning");
    expect(messages).toContainEqual(
      expect.objectContaining({ role: "assistant", content: "the answer" }),
    );
  });

  test("an assistant message made of only thinking contributes no message at all", () => {
    const history: Message[] = [
      { role: "assistant", content: [{ type: "thinking", text: "just thoughts" }] },
    ];

    const messages = toOpenAIMessages("system", history);

    // Just the leading system message — no empty assistant turn was added.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "system" });
  });
});
