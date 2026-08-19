import { describe, expect, test } from "vitest";
import { isLive, splitLiveTail } from "./messageLiveness.js";
import type { DisplayMessage } from "./types.js";

describe("isLive", () => {
  test("a streaming assistant message is live", () => {
    expect(isLive({ kind: "assistant", text: "hi", streaming: true })).toBe(true);
  });

  test("a finished assistant message is not live", () => {
    expect(isLive({ kind: "assistant", text: "hi", streaming: false })).toBe(false);
    expect(isLive({ kind: "assistant", text: "hi" })).toBe(false);
  });

  test("a tool call awaiting its result is live", () => {
    expect(isLive({ kind: "tool", name: "read", input: {} })).toBe(true);
  });

  test("a tool call with a result is not live", () => {
    expect(isLive({ kind: "tool", name: "read", input: {}, output: "done" })).toBe(
      false,
    );
  });

  test("user, notice, and error messages are never live", () => {
    expect(isLive({ kind: "user", text: "hi" })).toBe(false);
    expect(isLive({ kind: "notice", text: "note" })).toBe(false);
    expect(isLive({ kind: "error", text: "oops" })).toBe(false);
  });
});

describe("splitLiveTail", () => {
  test("everything is committed when nothing is live", () => {
    const messages: DisplayMessage[] = [
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello", streaming: false },
    ];

    expect(splitLiveTail(messages)).toEqual({ committed: messages, liveTail: undefined });
  });

  test("splits off a streaming trailing message", () => {
    const finished: DisplayMessage = { kind: "user", text: "hi" };
    const streaming: DisplayMessage = { kind: "assistant", text: "part", streaming: true };

    expect(splitLiveTail([finished, streaming])).toEqual({
      committed: [finished],
      liveTail: streaming,
    });
  });

  test("splits off a trailing tool call still awaiting its result", () => {
    const finished: DisplayMessage = { kind: "user", text: "hi" };
    const pending: DisplayMessage = { kind: "tool", name: "bash", input: {} };

    expect(splitLiveTail([finished, pending])).toEqual({
      committed: [finished],
      liveTail: pending,
    });
  });

  test("an empty transcript has no live tail", () => {
    expect(splitLiveTail([])).toEqual({ committed: [], liveTail: undefined });
  });

  test("a finished message earlier in the transcript is never treated as live", () => {
    // Only the trailing message is ever checked — an interior message being
    // (hypothetically) still-streaming should not surface as the live tail.
    const messages: DisplayMessage[] = [
      { kind: "assistant", text: "stale", streaming: true },
      { kind: "user", text: "hi" },
    ];

    expect(splitLiveTail(messages)).toEqual({ committed: messages, liveTail: undefined });
  });
});
