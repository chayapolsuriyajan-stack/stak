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
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "message-done"; stopReason: StopReason }
  | { type: "error"; error: Error };

export type ProviderName = "anthropic" | "openai" | "ollama";

export interface ModelInfo {
  /** Effective context window in tokens, if knowable. Undefined rather than
   * a guess when the provider has no way to report it. */
  contextLength?: number;
  /** Server-reported feature flags, e.g. Ollama's "thinking"/"tools". */
  capabilities?: string[];
}

export interface Provider {
  readonly name: ProviderName;
  listModels?(): Promise<string[]>;
  /** Best-effort model metadata for the status bar and capability checks.
   * Optional and expected to fail softly — a provider or model that can't
   * report this should resolve to {}, never throw or block a turn. */
  modelInfo?(model: string): Promise<ModelInfo>;
  streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent>;
}
