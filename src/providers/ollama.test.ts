import { describe, expect, test } from "vitest";
import { toStopReason } from "./ollama.js";

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
