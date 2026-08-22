import { describe, expect, test } from "vitest";
import type { AgentEvent } from "../agent/types.js";
import {
  ResultAccumulator,
  exitCodeFor,
  renderEvent,
  renderResult,
  type HeadlessResult,
} from "./render.js";

describe("renderEvent — text format", () => {
  test("text-delta passes through to stdout as-is", () => {
    expect(renderEvent({ type: "text-delta", text: "hello" }, "text")).toEqual({
      stdout: "hello",
    });
  });

  test("thinking-delta produces nothing", () => {
    expect(renderEvent({ type: "thinking-delta", text: "reasoning..." }, "text")).toEqual({});
  });

  test("tool-call-start produces a stderr line", () => {
    const out = renderEvent(
      { type: "tool-call-start", id: "1", name: "bash", input: {} },
      "text",
    );
    expect(out.stdout).toBeUndefined();
    expect(out.stderr).toBeDefined();
    expect(out.stderr).toContain("bash");
  });

  test("tool-call-result with isError true produces a stderr diagnostic", () => {
    const out = renderEvent(
      { type: "tool-call-result", id: "1", name: "bash", output: "boom", isError: true },
      "text",
    );
    expect(out.stdout).toBeUndefined();
    expect(out.stderr).toBeDefined();
    expect(out.stderr).toContain("bash");
  });

  test("tool-call-result with isError false produces no output", () => {
    expect(
      renderEvent(
        { type: "tool-call-result", id: "1", name: "bash", output: "ok", isError: false },
        "text",
      ),
    ).toEqual({});
  });

  test("truncated produces a stderr message", () => {
    const out = renderEvent({ type: "truncated" }, "text");
    expect(out.stdout).toBeUndefined();
    expect(out.stderr).toMatch(/cut off/i);
  });

  test("error produces a stderr message with the error text", () => {
    const out = renderEvent({ type: "error", error: new Error("boom") }, "text");
    expect(out.stdout).toBeUndefined();
    expect(out.stderr).toContain("boom");
  });

  test("interrupted produces a stderr message", () => {
    const out = renderEvent({ type: "interrupted" }, "text");
    expect(out.stdout).toBeUndefined();
    expect(out.stderr).toMatch(/interrupted/i);
  });

  test("usage, turn-complete, and progress produce nothing", () => {
    const events: AgentEvent[] = [
      { type: "usage", inputTokens: 1, outputTokens: 2, elapsedMs: 3, generatingMs: 4 },
      { type: "turn-complete" },
      {
        type: "progress",
        phase: "generating",
        round: 1,
        outputTokens: 1,
        approx: false,
        latestInputTokens: 1,
        generatingMs: 1,
      },
    ];
    for (const event of events) {
      expect(renderEvent(event, "text")).toEqual({});
    }
  });
});

describe("renderEvent — json format", () => {
  test("every event type produces {} in json format", () => {
    const events: AgentEvent[] = [
      { type: "text-delta", text: "hi" },
      { type: "thinking-delta", text: "hmm" },
      { type: "tool-call-start", id: "1", name: "bash", input: {} },
      { type: "tool-call-result", id: "1", name: "bash", output: "ok", isError: false },
      { type: "usage", inputTokens: 1, outputTokens: 2, elapsedMs: 3, generatingMs: 4 },
      {
        type: "progress",
        phase: "waiting",
        round: 1,
        outputTokens: 0,
        approx: false,
        latestInputTokens: 0,
        generatingMs: 0,
      },
      { type: "truncated" },
      { type: "turn-complete" },
      { type: "interrupted" },
      { type: "error", error: new Error("boom") },
    ];
    for (const event of events) {
      expect(renderEvent(event, "json")).toEqual({});
    }
  });
});

describe("renderEvent — stream-json format", () => {
  test("a normal event round-trips through JSON.parse", () => {
    const event: AgentEvent = { type: "text-delta", text: "hello world" };
    const out = renderEvent(event, "stream-json");
    expect(out.stdout).toBeDefined();
    expect(out.stdout!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(out.stdout!.trimEnd());
    expect(parsed).toEqual(event);
  });

  test("a real Error instance round-trips with error.message intact", () => {
    const event: AgentEvent = { type: "error", error: new Error("boom") };
    const out = renderEvent(event, "stream-json");
    expect(out.stdout).toBeDefined();
    const parsed = JSON.parse(out.stdout!.trimEnd());
    expect(parsed.type).toBe("error");
    expect(parsed.error.message).toBe("boom");
  });
});

describe("ResultAccumulator", () => {
  const meta = {
    sessionId: "sess-1",
    provider: "anthropic",
    model: "claude",
    durationMs: 1000,
  };

  test("accumulates text across multiple text-delta events", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "text-delta", text: "Hello, " });
    acc.observe({ type: "text-delta", text: "world!" });
    const result = acc.build(meta);
    expect(result.result).toBe("Hello, world!");
  });

  test("numTurns tracks the latest progress event's round number", () => {
    const acc = new ResultAccumulator();
    acc.observe({
      type: "progress",
      phase: "generating",
      round: 1,
      outputTokens: 0,
      approx: false,
      latestInputTokens: 0,
      generatingMs: 0,
    });
    acc.observe({
      type: "progress",
      phase: { tool: "bash" },
      round: 3,
      outputTokens: 0,
      approx: false,
      latestInputTokens: 0,
      generatingMs: 0,
    });
    const result = acc.build(meta);
    expect(result.numTurns).toBe(3);
  });

  test("numTurns defaults to 1 when no progress event is observed", () => {
    const acc = new ResultAccumulator();
    const result = acc.build(meta);
    expect(result.numTurns).toBe(1);
  });

  test("usage takes the latest event, not a sum", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "usage", inputTokens: 10, outputTokens: 5, elapsedMs: 1, generatingMs: 1 });
    acc.observe({ type: "usage", inputTokens: 100, outputTokens: 50, elapsedMs: 2, generatingMs: 2 });
    const result = acc.build(meta);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  test("truncated is sticky once observed", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "truncated" });
    acc.observe({ type: "text-delta", text: "more text after truncation" });
    const result = acc.build(meta);
    expect(result.truncated).toBe(true);
  });

  test("an error event yields subtype error, isError true, and the message", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "text-delta", text: "partial" });
    acc.observe({ type: "error", error: new Error("something broke") });
    const result = acc.build(meta);
    expect(result.subtype).toBe("error");
    expect(result.isError).toBe(true);
    expect(result.error).toBe("something broke");
  });

  test("an interrupted event (no error) yields subtype interrupted, isError true, no error message", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "interrupted" });
    const result = acc.build(meta);
    expect(result.subtype).toBe("interrupted");
    expect(result.isError).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("neither error nor interrupted yields subtype success, isError false", () => {
    const acc = new ResultAccumulator();
    acc.observe({ type: "text-delta", text: "all good" });
    const result = acc.build(meta);
    expect(result.subtype).toBe("success");
    expect(result.isError).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test("build passes through all meta fields", () => {
    const acc = new ResultAccumulator();
    const result = acc.build(meta);
    expect(result.sessionId).toBe(meta.sessionId);
    expect(result.provider).toBe(meta.provider);
    expect(result.model).toBe(meta.model);
    expect(result.durationMs).toBe(meta.durationMs);
  });
});

describe("renderResult", () => {
  function makeResult(overrides: Partial<HeadlessResult> = {}): HeadlessResult {
    return {
      type: "result",
      subtype: "success",
      isError: false,
      result: "some output",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude",
      durationMs: 1000,
      numTurns: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      truncated: false,
      ...overrides,
    };
  }

  // Text format streams every character of the assistant's reply live via
  // renderEvent's per-"text-delta" handling as the turn runs, so renderResult
  // must NOT re-emit the accumulated text here too — that would print the
  // whole answer a second time. It only ever tops off a missing trailing
  // newline.
  test("text format adds only a trailing newline when the streamed text is missing one, not the text itself", () => {
    const result = makeResult({ result: "no newline here" });
    const out = renderResult(result, "text");
    expect(out.stdout).toBe("\n");
  });

  test("text format emits nothing when the streamed text already ended with a newline", () => {
    const result = makeResult({ result: "already has one\n" });
    const out = renderResult(result, "text");
    expect(out.stdout).toBeUndefined();
  });

  test("json format produces valid, parseable JSON matching the input result", () => {
    const result = makeResult();
    const out = renderResult(result, "json");
    expect(out.stdout).toBeDefined();
    const parsed = JSON.parse(out.stdout!);
    expect(parsed).toEqual(result);
  });

  test("stream-json format produces one valid parseable JSON line", () => {
    const result = makeResult();
    const out = renderResult(result, "stream-json");
    expect(out.stdout).toBeDefined();
    expect(out.stdout!.split("\n").filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(out.stdout!.trimEnd());
    expect(parsed).toEqual(result);
  });
});

describe("exitCodeFor", () => {
  function makeResult(overrides: Partial<HeadlessResult> = {}): HeadlessResult {
    return {
      type: "result",
      subtype: "success",
      isError: false,
      result: "",
      sessionId: "sess-1",
      provider: "anthropic",
      model: "claude",
      durationMs: 1000,
      numTurns: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      truncated: false,
      ...overrides,
    };
  }

  test("interrupted yields 130", () => {
    expect(
      exitCodeFor(makeResult({ subtype: "interrupted", isError: true })),
    ).toBe(130);
  });

  test("any other isError yields 1", () => {
    expect(
      exitCodeFor(makeResult({ subtype: "error", isError: true, error: "boom" })),
    ).toBe(1);
  });

  test("success yields 0", () => {
    expect(exitCodeFor(makeResult({ subtype: "success", isError: false }))).toBe(0);
  });
});
