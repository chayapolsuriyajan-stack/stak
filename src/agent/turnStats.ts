import type { TurnPhase } from "./types.js";

const DEFAULT_CHARS_PER_TOKEN = 4;

export interface TurnStatsSnapshot {
  /** Output tokens so far this turn: authoritative rounds plus a live
   * character-based estimate for whatever is still streaming. */
  outputTokens: number;
  /** True while the in-flight round's contribution is an estimate rather
   * than a provider-reported count. */
  approx: boolean;
  /** The most recent round's prompt size — what "context used" means for
   * the status bar, not the turn-wide sum, which would overstate it across
   * a multi-round tool-calling turn. */
  latestInputTokens: number;
  /** Generation time only, excluding tool execution. */
  generatingMs: number;
  phase: TurnPhase;
  round: number;
}

export interface RoundUsage {
  inputTokens: number;
  outputTokens: number;
  /** The provider's own generation time (e.g. Ollama's eval_duration),
   * preferred over the wall-clock fallback when available since it excludes
   * queueing and prompt evaluation too. */
  generatingMs?: number;
}

/**
 * Pure, timer-free accumulator for one turn's live stats. Providers only
 * report authoritative token counts once per round (at stream end), so
 * output tokens are estimated from streamed characters in between and
 * reconciled — with the char/token ratio recalibrated — every time a real
 * count arrives, so the estimate converges toward the model's actual
 * tokenizer instead of guessing blind for the whole turn.
 */
export class TurnStats {
  private charsPerToken = DEFAULT_CHARS_PER_TOKEN;
  private charsSinceAuthoritative = 0;
  private authoritativeOutputTokens = 0;
  private latestInputTokens = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private generatingMs = 0;
  private phase: TurnPhase = "waiting";
  private round = 1;

  recordTextDelta(text: string): void {
    this.charsSinceAuthoritative += text.length;
  }

  setPhase(phase: TurnPhase): void {
    this.phase = phase;
  }

  setRound(round: number): void {
    this.round = round;
    // A fresh round starts back at "waiting" until its first delta arrives —
    // the previous round's phase should not linger across the boundary.
    this.phase = "waiting";
  }

  /**
   * Call once a round's stream has finished, with the provider's usage for
   * it. `fallbackGeneratingMs` is the loop's own wall-clock measurement
   * (stream start to stream end, excluding tool execution), used when the
   * provider doesn't report its own `generatingMs`.
   */
  recordRoundUsage(usage: RoundUsage, fallbackGeneratingMs: number): void {
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.latestInputTokens = usage.inputTokens;
    this.generatingMs += usage.generatingMs ?? fallbackGeneratingMs;

    // Recalibrate against what actually happened this round, so the estimate
    // for the next round starts from the real ratio rather than drifting
    // further from a guess made at turn start.
    if (usage.outputTokens > 0 && this.charsSinceAuthoritative > 0) {
      this.charsPerToken = this.charsSinceAuthoritative / usage.outputTokens;
    }
    this.authoritativeOutputTokens += usage.outputTokens;
    this.charsSinceAuthoritative = 0;
  }

  snapshot(): TurnStatsSnapshot {
    const estimateThisRound = Math.round(this.charsSinceAuthoritative / this.charsPerToken);
    return {
      outputTokens: this.authoritativeOutputTokens + estimateThisRound,
      approx: estimateThisRound > 0,
      latestInputTokens: this.latestInputTokens,
      generatingMs: this.generatingMs,
      phase: this.phase,
      round: this.round,
    };
  }

  /** The turn-total figures for the final `usage` AgentEvent — summed
   * across every round trip, since each is a distinct billed call. Same
   * semantics the loop had before this accumulator existed. */
  finalUsage(): { inputTokens: number; outputTokens: number; generatingMs: number } {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      generatingMs: this.generatingMs,
    };
  }
}
