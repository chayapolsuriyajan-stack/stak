import { describe, expect, test } from "vitest";
import { lookupContextLength } from "./contextLimits.js";

describe("lookupContextLength", () => {
  test("matches a known Anthropic model", () => {
    expect(lookupContextLength("claude-sonnet-4-5")).toBe(200_000);
  });

  test("matches a known OpenAI model", () => {
    expect(lookupContextLength("gpt-4o-mini")).toBe(128_000);
  });

  test("prefers the more specific gpt-4.1 entry over the generic gpt-4 one", () => {
    expect(lookupContextLength("gpt-4.1")).toBe(1_047_576);
  });

  test("returns undefined for an unrecognized model rather than guessing", () => {
    expect(lookupContextLength("some-future-model-nobody-has-heard-of")).toBeUndefined();
  });
});
