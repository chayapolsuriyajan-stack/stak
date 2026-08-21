import { describe, expect, test } from "vitest";
import { appendDelta, finalizeStreaming } from "./streamBuffer.js";
import type { DisplayMessage } from "./types.js";

describe("appendDelta", () => {
  test("starts a new streaming message when there is none", () => {
    const result = appendDelta([], "assistant", "hello");

    expect(result).toEqual([{ kind: "assistant", text: "hello", streaming: true }]);
  });

  test("extends a live message of the same kind", () => {
    const messages: DisplayMessage[] = [
      { kind: "assistant", text: "hel", streaming: true },
    ];

    const result = appendDelta(messages, "assistant", "lo");

    expect(result).toEqual([{ kind: "assistant", text: "hello", streaming: true }]);
  });

  test("does not extend a finished message of the same kind — starts a new one", () => {
    const messages: DisplayMessage[] = [
      { kind: "assistant", text: "earlier reply", streaming: false },
    ];

    const result = appendDelta(messages, "assistant", "new reply");

    expect(result).toEqual([
      { kind: "assistant", text: "earlier reply", streaming: false },
      { kind: "assistant", text: "new reply", streaming: true },
    ]);
  });

  test("finalizes a live thinking message before starting assistant text", () => {
    const messages: DisplayMessage[] = [
      { kind: "thinking", text: "reasoning...", streaming: true },
    ];

    const result = appendDelta(messages, "assistant", "the answer");

    expect(result).toEqual([
      { kind: "thinking", text: "reasoning...", streaming: false },
      { kind: "assistant", text: "the answer", streaming: true },
    ]);
  });

  test("finalizes a live assistant message before starting thinking (a later round)", () => {
    const messages: DisplayMessage[] = [
      { kind: "assistant", text: "prior answer", streaming: true },
    ];

    const result = appendDelta(messages, "thinking", "next round's reasoning");

    expect(result).toEqual([
      { kind: "assistant", text: "prior answer", streaming: false },
      { kind: "thinking", text: "next round's reasoning", streaming: true },
    ]);
  });

  test("leaves an unrelated message kind untouched when appending", () => {
    const messages: DisplayMessage[] = [{ kind: "user", text: "hi" }];

    const result = appendDelta(messages, "assistant", "hello");

    expect(result).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello", streaming: true },
    ]);
  });

  test("only ever one live message exists after any sequence of appends", () => {
    let messages: DisplayMessage[] = [];
    messages = appendDelta(messages, "thinking", "a");
    messages = appendDelta(messages, "thinking", "b");
    messages = appendDelta(messages, "assistant", "c");
    messages = appendDelta(messages, "assistant", "d");

    const liveCount = messages.filter(
      (m) => (m.kind === "assistant" || m.kind === "thinking") && m.streaming,
    ).length;

    expect(liveCount).toBe(1);
    expect(messages).toEqual([
      { kind: "thinking", text: "ab", streaming: false },
      { kind: "assistant", text: "cd", streaming: true },
    ]);
  });
});

describe("finalizeStreaming", () => {
  test("flips a live assistant message to finished", () => {
    const result = finalizeStreaming([{ kind: "assistant", text: "hi", streaming: true }]);

    expect(result).toEqual([{ kind: "assistant", text: "hi", streaming: false }]);
  });

  test("flips a live thinking message to finished", () => {
    const result = finalizeStreaming([{ kind: "thinking", text: "hmm", streaming: true }]);

    expect(result).toEqual([{ kind: "thinking", text: "hmm", streaming: false }]);
  });

  test("is a no-op when nothing is live", () => {
    const messages: DisplayMessage[] = [{ kind: "user", text: "hi" }];

    expect(finalizeStreaming(messages)).toEqual(messages);
  });

  test("is a no-op on an empty transcript", () => {
    expect(finalizeStreaming([])).toEqual([]);
  });
});
