import { describe, expect, test } from "vitest";
import { isTruncatedToolCallError, parseContextLength, toStopReason } from "./ollama.js";

describe("toStopReason", () => {
  test("a tool call always wins, regardless of done_reason", () => {
    expect(toStopReason("stop", true)).toBe("tool_use");
    expect(toStopReason("length", true)).toBe("tool_use");
    expect(toStopReason(undefined, true)).toBe("tool_use");
  });

  test("done_reason 'length' means the output was cut off", () => {
    expect(toStopReason("length", false)).toBe("max_tokens");
  });

  test("done_reason 'stop' is a normal completion", () => {
    expect(toStopReason("stop", false)).toBe("end_turn");
  });

  test("an unrecognized or missing done_reason defaults to a normal completion", () => {
    expect(toStopReason(undefined, false)).toBe("end_turn");
    expect(toStopReason("load", false)).toBe("end_turn");
  });
});

describe("isTruncatedToolCallError", () => {
  test("recognizes Go's json.Unmarshal message for a truncated document", () => {
    const error = new Error(
      `llama-server returned invalid tool call arguments for "write": unexpected end of JSON input`,
    );
    expect(isTruncatedToolCallError(error)).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isTruncatedToolCallError(new Error("Unexpected End Of JSON Input"))).toBe(true);
  });

  test("does not misclassify an unrelated failure", () => {
    expect(isTruncatedToolCallError(new Error("fetch failed: ECONNREFUSED"))).toBe(false);
    expect(isTruncatedToolCallError(new Error("model not found"))).toBe(false);
  });

  test("handles a thrown non-Error value without crashing", () => {
    expect(isTruncatedToolCallError("unexpected end of JSON input")).toBe(true);
    expect(isTruncatedToolCallError(undefined)).toBe(false);
  });
});

describe("parseContextLength", () => {
  // Fixture matches what a real `show()` call returns (verified against a
  // running server): model_info is a plain object at runtime despite the
  // ollama package's .d.ts claiming Map<string, any>.
  const modelInfoFixture = {
    "general.architecture": "qwen35",
    "qwen35.context_length": 262_144,
  };

  test("reads the architecture-prefixed context_length key", () => {
    expect(parseContextLength(modelInfoFixture, undefined)).toBe(262_144);
  });

  test("also accepts a genuine Map, in case a future SDK version matches its own types", () => {
    const asMap = new Map<string, unknown>(Object.entries(modelInfoFixture));
    expect(parseContextLength(asMap, undefined)).toBe(262_144);
  });

  test("caps to num_ctx from parameters when it is the smaller value", () => {
    const parameters = "num_ctx                        16384\ntemperature   0.7";
    expect(parseContextLength(modelInfoFixture, parameters)).toBe(16_384);
  });

  test("does not cap when num_ctx is larger than the architecture limit", () => {
    const parameters = "num_ctx                        999999999";
    expect(parseContextLength(modelInfoFixture, parameters)).toBe(262_144);
  });

  test("falls back to num_ctx alone when model_info has no context_length", () => {
    const parameters = "num_ctx                        8192";
    expect(parseContextLength({}, parameters)).toBe(8192);
  });

  test("returns undefined when neither source has anything usable", () => {
    expect(parseContextLength({}, undefined)).toBeUndefined();
    expect(parseContextLength(undefined, undefined)).toBeUndefined();
    expect(parseContextLength(null, "temperature 0.7")).toBeUndefined();
  });

  test("ignores an unparseable parameters string", () => {
    expect(parseContextLength(modelInfoFixture, "not a real parameters block")).toBe(262_144);
  });
});
