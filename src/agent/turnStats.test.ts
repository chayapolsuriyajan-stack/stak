import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TurnStats } from "./turnStats.js";

describe("TurnStats", () => {
  test("estimates output tokens from streamed characters before any authoritative count arrives", () => {
    const stats = new TurnStats();
    stats.recordTextDelta("a".repeat(40)); // 40 chars / 4 default chars-per-token = 10

    expect(stats.snapshot().outputTokens).toBe(10);
    expect(stats.snapshot().approx).toBe(true);
  });

  test("reconciles to the authoritative count once a round's usage arrives", () => {
    const stats = new TurnStats();
    stats.recordTextDelta("a".repeat(40));
    stats.recordRoundUsage({ inputTokens: 5, outputTokens: 7 }, 100);

    const snap = stats.snapshot();
    expect(snap.outputTokens).toBe(7);
    expect(snap.approx).toBe(false);
  });

  test("recalibrates the chars-per-token ratio from the real round, improving the next estimate", () => {
    const stats = new TurnStats();
    // 40 chars really was 8 tokens -> 5 chars/token, not the 4 default.
    stats.recordTextDelta("a".repeat(40));
    stats.recordRoundUsage({ inputTokens: 1, outputTokens: 8 }, 10);

    // Next round streams 25 chars; at the recalibrated 5 chars/token that's
    // 5 tokens, not the 6.25 the stale default would have guessed.
    stats.recordTextDelta("b".repeat(25));
    expect(stats.snapshot().outputTokens).toBe(8 + 5);
  });

  test("latestInputTokens reflects only the most recent round, not the turn sum", () => {
    const stats = new TurnStats();
    stats.recordRoundUsage({ inputTokens: 100, outputTokens: 10 }, 10);
    stats.recordRoundUsage({ inputTokens: 130, outputTokens: 5 }, 10);

    // This is the number a "context used" readout should show -- the
    // current prompt size, not 230 (which would overstate it).
    expect(stats.snapshot().latestInputTokens).toBe(130);
  });

  test("finalUsage sums across every round, unlike latestInputTokens", () => {
    const stats = new TurnStats();
    stats.recordRoundUsage({ inputTokens: 100, outputTokens: 20 }, 10);
    stats.recordRoundUsage({ inputTokens: 130, outputTokens: 5 }, 10);

    expect(stats.finalUsage()).toMatchObject({ inputTokens: 230, outputTokens: 25 });
  });

  test("prefers the provider's own generatingMs over the wall-clock fallback", () => {
    const stats = new TurnStats();
    stats.recordRoundUsage({ inputTokens: 1, outputTokens: 1, generatingMs: 42 }, 9999);

    expect(stats.finalUsage().generatingMs).toBe(42);
  });

  test("falls back to the wall-clock measurement when the provider reports no generatingMs", () => {
    const stats = new TurnStats();
    stats.recordRoundUsage({ inputTokens: 1, outputTokens: 1 }, 77);

    expect(stats.finalUsage().generatingMs).toBe(77);
  });

  test("accumulates generatingMs across rounds", () => {
    const stats = new TurnStats();
    stats.recordRoundUsage({ inputTokens: 1, outputTokens: 1, generatingMs: 30 }, 10);
    stats.recordRoundUsage({ inputTokens: 1, outputTokens: 1, generatingMs: 20 }, 10);

    expect(stats.finalUsage().generatingMs).toBe(50);
  });

  test("setPhase and setRound are reflected in the snapshot", () => {
    const stats = new TurnStats();
    stats.setRound(3);
    stats.setPhase({ tool: "bash" });

    const snap = stats.snapshot();
    expect(snap.round).toBe(3);
    expect(snap.phase).toEqual({ tool: "bash" });
  });

  test("setRound resets phase back to waiting, so the previous round's phase doesn't leak", () => {
    const stats = new TurnStats();
    stats.setPhase("generating");
    stats.setRound(2);

    expect(stats.snapshot().phase).toBe("waiting");
  });

  test("starts at round 1, phase waiting, zero tokens", () => {
    const stats = new TurnStats();
    const snap = stats.snapshot();

    expect(snap).toMatchObject({ round: 1, phase: "waiting", outputTokens: 0, approx: false });
  });

  test("a round with zero output tokens does not recalibrate to a division by zero", () => {
    const stats = new TurnStats();
    stats.recordTextDelta("some text that streamed before an empty round");
    stats.recordRoundUsage({ inputTokens: 5, outputTokens: 0 }, 10);
    stats.recordTextDelta("aaaa"); // 4 chars at the still-default 4 chars/token

    expect(stats.snapshot().outputTokens).toBe(1);
  });

  // Regression: recordRoundUsage only adds to generatingMs once a round has
  // *finished*, so a naive live snapshot mid-round reported 0ms the entire
  // time — and since tok/s divides by that, the status bar showed nothing
  // until a round (usually the whole turn, for an ordinary no-tool-calls
  // reply) was already done.
  describe("live generatingMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("reports elapsed time while a round is still generating, before it finishes", () => {
      const stats = new TurnStats();
      stats.setPhase("generating");
      vi.advanceTimersByTime(500);

      expect(stats.snapshot().generatingMs).toBe(500);
    });

    test("a thinking -> generating transition within one round keeps one continuous timer", () => {
      const stats = new TurnStats();
      stats.setPhase("thinking");
      vi.advanceTimersByTime(200);
      stats.setPhase("generating"); // should not reset the clock
      vi.advanceTimersByTime(300);

      expect(stats.snapshot().generatingMs).toBe(500);
    });

    test("the live timer does not run while waiting or executing a tool", () => {
      const stats = new TurnStats();
      stats.setPhase("waiting");
      vi.advanceTimersByTime(1000);
      expect(stats.snapshot().generatingMs).toBe(0);

      stats.setPhase({ tool: "bash" });
      vi.advanceTimersByTime(1000);
      expect(stats.snapshot().generatingMs).toBe(0);
    });

    test("recordRoundUsage finalizes the live segment without double-counting it", () => {
      const stats = new TurnStats();
      stats.setPhase("generating");
      vi.advanceTimersByTime(500);
      stats.recordRoundUsage({ inputTokens: 1, outputTokens: 1, generatingMs: 500 }, 500);

      // Not 1000 -- the round is over, so its time lives in the finalized
      // total exactly once, not also still ticking as a live segment.
      vi.advanceTimersByTime(9999);
      expect(stats.snapshot().generatingMs).toBe(500);
    });

    test("setRound abandons the previous round's in-progress timer instead of carrying it over", () => {
      const stats = new TurnStats();
      stats.setPhase("generating");
      vi.advanceTimersByTime(500);
      stats.setRound(2);

      expect(stats.snapshot().generatingMs).toBe(0);
    });
  });
});
