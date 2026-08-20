/**
 * Provider-agnostic conversation types.
 *
 * The internal shape is modeled on Anthropic's content-block format because it
 * is the most structurally explicit of the three providers we target. Each
 * provider adapter translates to and from its own wire format.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/** Reasoning text, kept distinct from TextBlock since it must never be
 * replayed back to a provider as if it were assistant speech — every
 * adapter drops these on the way out. Persisted to session JSONL so
 * --resume can still redisplay it, even though it never round-trips
 * through a live conversation. */
export interface ThinkingBlock {
  type: "thinking";
  text: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** What the agent is doing right now, for a live "phase" readout. A tool
 * name rather than a bare string so it can't be confused with an
 * in-progress tool call. */
export type TurnPhase = "waiting" | "generating" | "thinking" | { tool: string };

/** Events emitted by the agent loop as a turn progresses. */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call-start"; id: string; name: string; input: unknown }
  | {
      type: "tool-call-result";
      id: string;
      name: string;
      output: string;
      isError: boolean;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      elapsedMs: number;
      /** Generation time only, excluding tool execution — the honest
       * denominator for tok/s, unlike elapsedMs which includes it. */
      generatingMs: number;
    }
  /** A live snapshot mid-turn: output tokens seen so far (possibly a live
   * estimate — see `approx`), the phase, and which round this is. Emitted
   * on phase transitions, not per token. */
  | {
      type: "progress";
      phase: TurnPhase;
      round: number;
      outputTokens: number;
      approx: boolean;
      latestInputTokens: number;
      generatingMs: number;
    }
  /** The final reply was cut off by the model's output/context limit, not a
   * natural stop — the visible text is incomplete. */
  | { type: "truncated" }
  | { type: "turn-complete" }
  | { type: "interrupted" }
  | { type: "error"; error: Error };

/** Convenience constructors — these shapes get built in a lot of places. */
export function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

export function assistantText(text: string): Message {
  return { role: "assistant", content: [{ type: "text", text }] };
}
