import type { Message } from "../agent/types.js";

/**
 * A tool as presented to a model. `jsonSchema` is plain JSON Schema so that
 * tools from any source (zod-defined built-ins today, MCP servers later) can
 * flow through the same path without adapters caring where they came from.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  history: Message[];
  tools: ToolDefinition[];
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

/**
 * Normalized stream events. Providers differ in how granular their tool-call
 * streaming is — Anthropic and OpenAI stream argument JSON in fragments, while
 * Ollama typically delivers a complete call in one chunk. Adapters smooth this
 * over: whoever gets a whole call at once emits a `tool-call-delta` immediately
 * followed by `tool-call-done`.
 */
export type ProviderStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call-delta"; id: string; name?: string; argsFragment?: string }
  | { type: "tool-call-done"; id: string; name: string; args: unknown }
  | { type: "message-done"; stopReason: StopReason }
  | { type: "error"; error: Error };

export type ProviderName = "anthropic" | "openai" | "ollama";

export interface Provider {
  readonly name: ProviderName;
  listModels?(): Promise<string[]>;
  streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent>;
}
