/**
 * Pure event-to-output rendering for stak's headless/print mode.
 *
 * Two halves live here:
 *
 *  - `renderEvent` turns each `AgentEvent` streamed out of the agent loop
 *    into stdout/stderr fragments, per output format, as the turn runs.
 *  - `ResultAccumulator` + `renderResult` build and render the final
 *    summary record emitted once the turn completes.
 *
 * Deliberately dependency-free beyond `../agent/types.js` and `./options.js`
 * (a type-only import) — this module has no business knowing about the TUI,
 * the provider adapters, or anything else.
 */

import type { AgentEvent } from "../agent/types.js";
import type { OutputFormat } from "./options.js";

export interface RenderedOutput {
  stdout?: string;
  stderr?: string;
}

/**
 * Renders a single agent event for streamed, per-event output.
 *
 * - "text": human-readable — assistant text goes to stdout as-is; tool
 *   activity, errors, and diagnostics go to stderr so piped stdout stays
 *   clean. Reasoning (thinking-delta) is dropped entirely.
 * - "json": nothing per-event — only the final `renderResult` output
 *   matters in this format.
 * - "stream-json": every event becomes one NDJSON line on stdout.
 */
export function renderEvent(event: AgentEvent, format: OutputFormat): RenderedOutput {
  if (format === "json") return {};
  if (format === "stream-json") return { stdout: JSON.stringify(toJsonRecord(event)) + "\n" };
  return renderEventText(event);
}

function renderEventText(event: AgentEvent): RenderedOutput {
  switch (event.type) {
    case "text-delta":
      return { stdout: event.text };
    case "thinking-delta":
      return {};
    case "tool-call-start":
      return { stderr: `[tool] ${event.name}\n` };
    case "tool-call-result":
      return event.isError ? { stderr: `[tool] ${event.name} failed: ${event.output}\n` } : {};
    case "truncated":
      return { stderr: "Response cut off — hit the context/output limit.\n" };
    case "error":
      return { stderr: `Error: ${event.error.message}\n` };
    case "interrupted":
      return { stderr: "Interrupted.\n" };
    case "usage":
    case "turn-complete":
    case "progress":
      return {};
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Reconstructs an `AgentEvent` as a plain, JSON.stringify-safe object.
 *
 * The only event whose fields aren't already stringify-safe is "error":
 * `event.error` is a real `Error` instance, and `JSON.stringify(new
 * Error("x"))` serializes to `{}` because Error's own properties (message,
 * stack) aren't enumerable. Every other event shape is plain data already,
 * so it's returned as-is.
 */
function toJsonRecord(event: AgentEvent): unknown {
  if (event.type === "error") {
    return { type: "error", error: { name: event.error.name, message: event.error.message } };
  }
  return event;
}

export interface HeadlessResult {
  type: "result";
  subtype: "success" | "error" | "interrupted";
  isError: boolean;
  result: string;
  sessionId: string;
  provider: string;
  model: string;
  durationMs: number;
  numTurns: number;
  usage: { inputTokens: number; outputTokens: number };
  truncated: boolean;
  error?: string;
}

/**
 * Accumulates state across a whole turn's worth of events into the final
 * `HeadlessResult`. Pure bookkeeping — does no rendering itself.
 */
export class ResultAccumulator {
  private text = "";
  /**
   * "numTurns" tracks provider round count, not tool-call count. The
   * "progress" event carries the loop's authoritative `round` number
   * (incremented once per provider round-trip, whether or not that round
   * called a tool — see `src/agent/loop.ts`/`turnStats.ts`), so the latest
   * observed round is a more accurate "how many turns did this take" figure
   * than counting `tool-call-start` events: a tool-free final round (the
   * common case — the model's last round is just the closing reply) would
   * otherwise be silently uncounted. Defaults to 1: even a turn that never
   * emits a "progress" event (e.g. it errors out immediately) still spans
   * at least one round.
   */
  private numTurns = 1;
  private usage = { inputTokens: 0, outputTokens: 0 };
  private truncated = false;
  private errorMessage: string | undefined;
  private interrupted = false;

  observe(event: AgentEvent): void {
    switch (event.type) {
      case "text-delta":
        this.text += event.text;
        break;
      case "progress":
        this.numTurns = event.round;
        break;
      case "usage":
        // Latest wins, not summed — loop.ts's "usage" event already reports
        // cumulative totals for the whole turn (TurnStats.finalUsage sums
        // across every round internally), so the last one observed before
        // "turn-complete" is authoritative on its own.
        this.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      case "truncated":
        this.truncated = true;
        break;
      case "error":
        this.errorMessage = event.error.message;
        break;
      case "interrupted":
        this.interrupted = true;
        break;
      default:
        break;
    }
  }

  build(meta: {
    sessionId: string;
    provider: string;
    model: string;
    durationMs: number;
  }): HeadlessResult {
    const base = {
      type: "result" as const,
      result: this.text,
      sessionId: meta.sessionId,
      provider: meta.provider,
      model: meta.model,
      durationMs: meta.durationMs,
      numTurns: this.numTurns,
      usage: this.usage,
      truncated: this.truncated,
    };

    if (this.errorMessage !== undefined) {
      return { ...base, subtype: "error", isError: true, error: this.errorMessage };
    }
    if (this.interrupted) {
      return { ...base, subtype: "interrupted", isError: true };
    }
    return { ...base, subtype: "success", isError: false };
  }
}

/** Renders the final `HeadlessResult` summary, per output format. */
export function renderResult(result: HeadlessResult, format: OutputFormat): RenderedOutput {
  if (format === "json") {
    return { stdout: JSON.stringify(result, null, 2) + "\n" };
  }
  if (format === "stream-json") {
    return { stdout: JSON.stringify(result) + "\n" };
  }
  // Text format already streamed every character of `result.result` live via
  // renderEvent's per-"text-delta" handling — re-emitting it here would
  // print the whole answer a second time. This only tops off a trailing
  // newline when there WAS streamed text that didn't already end with one.
  // An empty result (e.g. an error before anything streamed, whose message
  // renderEvent already put on stderr) gets no stray blank line on stdout.
  if (result.result === "" || result.result.endsWith("\n")) return {};
  return { stdout: "\n" };
}

/** Process exit code for a finished headless turn: 130 for interrupted
 * (matching the conventional SIGINT exit code), 1 for any other error,
 * 0 otherwise. */
export function exitCodeFor(result: HeadlessResult): number {
  if (result.subtype === "interrupted") return 130;
  if (result.isError) return 1;
  return 0;
}
