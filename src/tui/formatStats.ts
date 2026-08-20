import type { TurnPhase } from "../agent/types.js";

/** Live/final stats display needs from a turn, shared shape with
 * TurnStatsSnapshot from agent/turnStats.ts — kept as a separate local
 * interface (rather than importing that one directly) so this stays pure UI
 * formatting with no coupling beyond the data it actually reads. */
export interface StatsLine {
  outputTokens: number;
  approx: boolean;
  latestInputTokens: number;
  generatingMs: number;
}

export function formatPhase(phase: TurnPhase): string {
  if (phase === "waiting") return "waiting for the model";
  if (phase === "generating") return "generating";
  if (phase === "thinking") return "thinking";
  return phase.tool;
}

/** Sub-second generation would otherwise divide by a near-zero duration and
 * print a meaningless spike — same guard the old formatUsage had. */
export function formatTokRate(outputTokens: number, generatingMs: number): string | undefined {
  const seconds = generatingMs / 1000;
  if (seconds < 0.1) return undefined;
  return `${(outputTokens / seconds).toFixed(1)} tok/s`;
}

/** Omitted entirely (returns undefined) rather than showing a guess when
 * the context limit isn't known — Anthropic/OpenAI without a table entry,
 * or an Ollama server that hasn't answered yet. A missing segment reads
 * better than a wrong or placeholder one. */
export function formatContext(
  inputTokens: number,
  contextLength: number | undefined,
): string | undefined {
  if (contextLength === undefined || contextLength <= 0) return undefined;
  const pct = Math.round((inputTokens / contextLength) * 100);
  return `${formatCompact(inputTokens)}/${formatCompact(contextLength)} ctx (${pct}%)`;
}

function formatCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** The right-hand status bar segment: token count, throughput, context —
 * each omitted individually when it isn't meaningful yet. */
export function formatStatsLine(
  stats: StatsLine,
  contextLength: number | undefined,
): string {
  const parts = [`${stats.outputTokens.toLocaleString()}${stats.approx ? "~" : ""} out`];

  const rate = formatTokRate(stats.outputTokens, stats.generatingMs);
  if (rate) parts.push(rate);

  const ctx = formatContext(stats.latestInputTokens, contextLength);
  if (ctx) parts.push(ctx);

  return parts.join(" · ");
}

/** The left-hand status bar segment while a turn is busy. */
export function formatPhaseLine(phase: TurnPhase, round: number): string {
  return `${formatPhase(phase)} · round ${round} · esc to interrupt`;
}
