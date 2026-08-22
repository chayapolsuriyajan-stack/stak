import { describe, expect, test, vi } from "vitest";
import type { ChatRequest, Provider, ProviderStreamEvent } from "../providers/types.js";
import {
  compactHistory,
  describeCompaction,
  estimateTokens,
  renderTranscript,
  shouldAutoCompact,
  splitForCompaction,
  type CompactableContext,
} from "./compact.js";
import type { Message } from "./types.js";

function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantText(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}

/** A provider that replays a single scripted event list. */
function scriptedProvider(events: ProviderStreamEvent[]): Provider {
  return {
    name: "ollama",
    async *streamChat(_req: ChatRequest) {
      for (const event of events) yield event;
    },
  };
}

describe("splitForCompaction", () => {
  test("scans backward past a naive boundary that would land mid tool-exchange", () => {
    const history: Message[] = [
      userText("hi"), // 0
      assistantText("ok"), // 1
      userText("do it"), // 2 <- nearest clean boundary at/before candidate
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
      }, // 3
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "result" }],
      }, // 4 <- naive candidate (length 6 - keepRecent 2 = 4) would land here
      assistantText("done"), // 5
    ];

    // keepRecent=2 -> candidate index = 4, which is a tool_result message.
    // Must scan backward to the nearest clean user message at or before the
    // candidate — index 2 — keeping that turn's tool exchange intact in
    // `recent` rather than throwing everything into `older`.
    const result = splitForCompaction(history, 2);
    expect(result.older).toEqual(history.slice(0, 2));
    expect(result.recent).toEqual(history.slice(2));
  });

  test("last complete turn ending in a tool exchange is kept in recent, not thrown into older", () => {
    // Regression test for the exact scenario described in the compaction
    // review: auto-compaction fires right after a turn ends, i.e. exactly
    // when the tail of history IS a tool exchange. The last complete turn's
    // user message and its response must survive into `recent`.
    const history: Message[] = [
      userText("earlier turn"), // 0
      assistantText("earlier answer"), // 1
      userText("do the last turn"), // 2 <- start of the last complete turn
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
      }, // 3
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "result" }],
      }, // 4
      assistantText("done"), // 5
    ];

    // keepRecent=4 -> candidate index = 2, which is already the clean
    // boundary at the start of the last turn.
    const result = splitForCompaction(history, 4);
    expect(result.older).toEqual(history.slice(0, 2));
    expect(result.recent).toEqual(history.slice(2));
    expect(result.recent[0]).toEqual(userText("do the last turn"));
    expect(result.recent.at(-1)).toEqual(assistantText("done"));
  });

  test("index 0 is not accepted as a boundary, even when it's the only clean user message", () => {
    const history: Message[] = [
      userText("hi"), // 0 <- the only clean user message in this history
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
      }, // 1
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "result" }],
      }, // 2 <- candidate (5 - 3 = 2), orphaned
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t2", name: "read", input: {} }],
      }, // 3
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t2", content: "result" }],
      }, // 4
    ];

    // Accepting index 0 here would return { older: [], recent: history } —
    // the entire (potentially huge) history kept "recent" and nothing
    // summarized, which makes compactHistory throw "still short" regardless
    // of how large history actually is. Rejecting index 0 falls through to
    // compacting everything instead, which actually shrinks context — the
    // whole reason this function was called.
    const result = splitForCompaction(history, 3);
    expect(result.older).toEqual(history);
    expect(result.recent).toEqual([]);
  });

  test("falls back to compacting everything when no clean boundary exists anywhere, even scanning all the way back to index 0", () => {
    const history: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "result" }],
      },
    ];

    const result = splitForCompaction(history, 1);
    expect(result.older).toEqual(history);
    expect(result.recent).toEqual([]);
  });

  test("history shorter than or equal to keepRecent returns it all as recent", () => {
    const history: Message[] = [userText("a"), assistantText("b")];
    const result = splitForCompaction(history, 4);
    expect(result.older).toEqual([]);
    expect(result.recent).toEqual(history);

    const exact = splitForCompaction(history, 2);
    expect(exact.older).toEqual([]);
    expect(exact.recent).toEqual(history);
  });

  test("default keepRecent is 4", () => {
    const history: Message[] = Array.from({ length: 5 }, (_, i) => userText(`m${i}`));
    const result = splitForCompaction(history);
    expect(result.older).toEqual(history.slice(0, 1));
    expect(result.recent).toEqual(history.slice(1));
  });
});

describe("renderTranscript", () => {
  test("excludes thinking blocks entirely", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "secret reasoning" },
          { type: "text", text: "the answer" },
        ],
      },
    ];

    const out = renderTranscript(messages);
    expect(out).not.toContain("secret reasoning");
    expect(out).toContain("the answer");
  });

  test("truncates long tool_result content with a marker", () => {
    const longContent = "x".repeat(600);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: longContent }],
      },
    ];

    const out = renderTranscript(messages);
    expect(out).toContain("… (truncated)");
    expect(out.length).toBeLessThan(longContent.length);
  });

  test("renders tool_use as [tool: name]", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }],
      },
    ];

    expect(renderTranscript(messages)).toContain("[tool: bash]");
  });

  test("renders text blocks under their role prefix", () => {
    const messages: Message[] = [userText("hello"), assistantText("hi there")];
    const out = renderTranscript(messages);
    expect(out).toContain("user: hello");
    expect(out).toContain("assistant: hi there");
  });
});

describe("estimateTokens", () => {
  test("roughly matches text.length / 4", () => {
    const text = "a".repeat(400);
    const messages: Message[] = [userText(text)];
    expect(estimateTokens(messages)).toBe(100);
  });
});

describe("shouldAutoCompact", () => {
  test("false when contextLength is undefined", () => {
    expect(shouldAutoCompact({ inputTokens: 1000 })).toBe(false);
  });

  test("false when contextLength is zero or negative", () => {
    expect(shouldAutoCompact({ inputTokens: 1000, contextLength: 0 })).toBe(false);
    expect(shouldAutoCompact({ inputTokens: 1000, contextLength: -5 })).toBe(false);
  });

  test("false when inputTokens is 0", () => {
    expect(shouldAutoCompact({ inputTokens: 0, contextLength: 1000 })).toBe(false);
  });

  test("true at/above the default 0.85 threshold, false just below it", () => {
    expect(shouldAutoCompact({ inputTokens: 850, contextLength: 1000 })).toBe(true);
    expect(shouldAutoCompact({ inputTokens: 851, contextLength: 1000 })).toBe(true);
    expect(shouldAutoCompact({ inputTokens: 849, contextLength: 1000 })).toBe(false);
  });

  test("respects a custom threshold", () => {
    expect(shouldAutoCompact({ inputTokens: 500, contextLength: 1000, threshold: 0.5 })).toBe(
      true,
    );
    expect(shouldAutoCompact({ inputTokens: 499, contextLength: 1000, threshold: 0.5 })).toBe(
      false,
    );
  });
});

describe("describeCompaction", () => {
  test("produces a one-line human summary", () => {
    // messagesAfter (5) is compacted.length = 1 summary + 4 recent, per
    // buildCompactedHistory — the rendered "recent" figure must be 4, not 5.
    const line = describeCompaction({
      summary: "s",
      messagesBefore: 10,
      messagesAfter: 5,
      estimatedTokensBefore: 12000,
      estimatedTokensAfter: 900,
    });
    expect(line).toContain("10 messages");
    expect(line).toContain("12.0k");
    expect(line).toContain("4 recent messages");
    expect(line).not.toContain("5 recent messages");
    expect(line).toContain("900");
  });
});

describe("compactHistory", () => {
  function context(provider: Provider, history: Message[]): CompactableContext {
    return { provider, model: "test", history };
  }

  test("mutates ctx.history in place rather than reassigning", async () => {
    const history: Message[] = Array.from({ length: 10 }, (_, i) => userText(`m${i}`));
    const provider = scriptedProvider([
      { type: "text-delta", text: "sum" },
      { type: "text-delta", text: "mary" },
      { type: "message-done", stopReason: "end_turn" },
    ]);
    const ctx = context(provider, history);
    const originalRef = ctx.history;

    await compactHistory(ctx);

    expect(ctx.history).toBe(originalRef);
    expect(ctx.history[0]?.content[0]).toMatchObject({ type: "text" });
  });

  test("returns correct messagesBefore/messagesAfter counts", async () => {
    const history: Message[] = Array.from({ length: 10 }, (_, i) => userText(`m${i}`));
    const provider = scriptedProvider([
      { type: "text-delta", text: "summary text" },
      { type: "message-done", stopReason: "end_turn" },
    ]);
    const ctx = context(provider, history);

    const result = await compactHistory(ctx, { keepRecent: 4 });

    expect(result.messagesBefore).toBe(10);
    // 1 summary message + keepRecent tail (default boundary scan keeps the
    // last 4 for this all-user-message history).
    expect(result.messagesAfter).toBe(ctx.history.length);
    expect(ctx.history.length).toBe(1 + 4);
  });

  test("rejects when the provider yields an error event", async () => {
    const history: Message[] = Array.from({ length: 10 }, (_, i) => userText(`m${i}`));
    const boom = new Error("provider exploded");
    const provider = scriptedProvider([{ type: "error", error: boom }]);
    const ctx = context(provider, history);

    await expect(compactHistory(ctx)).rejects.toThrow("provider exploded");
  });

  test("throws on a short history without calling the provider", async () => {
    const history: Message[] = [userText("a"), assistantText("b")];
    const streamChat = vi.fn(async function* () {
      yield { type: "message-done", stopReason: "end_turn" } as ProviderStreamEvent;
    });
    const provider: Provider = { name: "ollama", streamChat };
    const ctx = context(provider, history);

    await expect(compactHistory(ctx, { keepRecent: 4 })).rejects.toThrow(
      "still short",
    );
    expect(streamChat).not.toHaveBeenCalled();
  });

  test("throws when the model returns an empty summary", async () => {
    const history: Message[] = Array.from({ length: 10 }, (_, i) => userText(`m${i}`));
    const provider = scriptedProvider([
      { type: "message-done", stopReason: "end_turn" },
    ]);
    const ctx = context(provider, history);

    await expect(compactHistory(ctx)).rejects.toThrow("empty summary");
  });
});
