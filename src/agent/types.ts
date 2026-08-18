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

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** Events emitted by the agent loop as a turn progresses. */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call-start"; id: string; name: string; input: unknown }
  | {
      type: "tool-call-result";
      id: string;
      name: string;
      output: string;
      isError: boolean;
    }
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
