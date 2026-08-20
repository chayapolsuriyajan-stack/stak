import { describe, expect, test } from "vitest";
import {
  formatContext,
  formatPhase,
  formatPhaseLine,
  formatStatsLine,
  formatTokRate,
} from "./formatStats.js";

describe("formatPhase", () => {
  test("formats the built-in phases", () => {
    expect(formatPhase("waiting")).toBe("waiting for the model");
    expect(formatPhase("generating")).toBe("generating");
  });

  test("formats a tool phase with its name", () => {
    expect(formatPhase({ tool: "bash" })).toBe("bash");
  });
});

describe("formatTokRate", () => {
  test("computes tokens per second", () => {
    expect(formatTokRate(100, 2000)).toBe("50.0 tok/s");
  });

  test("omits the rate for a sub-100ms duration rather than showing a spike", () => {
    expect(formatTokRate(5, 50)).toBeUndefined();
  });

  test("handles zero generatingMs without dividing by zero into a real number", () => {
    expect(formatTokRate(5, 0)).toBeUndefined();
  });
});

describe("formatContext", () => {
  test("formats used/limit with a percentage", () => {
    expect(formatContext(24_100, 128_000)).toBe("24.1k/128.0k ctx (19%)");
  });

  test("omits the segment when the limit is unknown", () => {
    expect(formatContext(1000, undefined)).toBeUndefined();
  });

  test("omits the segment for a non-positive limit", () => {
    expect(formatContext(1000, 0)).toBeUndefined();
  });

  test("does not compact numbers under 1000", () => {
    expect(formatContext(500, 8000)).toBe("500/8.0k ctx (6%)");
  });
});

describe("formatStatsLine", () => {
  test("combines output tokens, rate, and context when all are known", () => {
    const line = formatStatsLine(
      { outputTokens: 1204, approx: false, latestInputTokens: 24_100, generatingMs: 30_000 },
      128_000,
    );

    expect(line).toBe("1,204 out · 40.1 tok/s · 24.1k/128.0k ctx (19%)");
  });

  test("marks an estimate with a tilde", () => {
    const line = formatStatsLine(
      { outputTokens: 50, approx: true, latestInputTokens: 100, generatingMs: 10_000 },
      undefined,
    );

    expect(line).toContain("50~ out");
  });

  test("omits rate and context segments individually when they are not available", () => {
    const line = formatStatsLine(
      { outputTokens: 10, approx: true, latestInputTokens: 0, generatingMs: 0 },
      undefined,
    );

    expect(line).toBe("10~ out");
  });
});

describe("formatPhaseLine", () => {
  test("combines phase and round with the interrupt hint", () => {
    expect(formatPhaseLine({ tool: "read" }, 3)).toBe("read · round 3 · esc to interrupt");
    expect(formatPhaseLine("generating", 1)).toBe("generating · round 1 · esc to interrupt");
  });
});
