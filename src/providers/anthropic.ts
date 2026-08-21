import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, Message } from "../agent/types.js";
import { lookupContextLength } from "./contextLimits.js";
import type {
  ChatRequest,
  ModelInfo,
  Provider,
  ProviderStreamEvent,
  StopReason,
  ToolDefinition,
} from "./types.js";

/**
 * Anthropic's block shapes line up almost 1:1 with our internal format.
 * flatMap rather than map since a thinking block is dropped outright — it
 * must never be replayed back as if it were prior assistant speech, and
 * Anthropic specifically would reject an unsigned thinking block outright
 * if one were sent (its own extended-thinking blocks carry a signature this
 * adapter never generates, since it doesn't request native thinking).
 */
export function toAnthropicContent(blocks: ContentBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.flatMap((block): Anthropic.ContentBlockParam[] => {
    switch (block.type) {
      case "text":
        return [{ type: "text", text: block.text }];
      case "tool_use":
        return [
          {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          },
        ];
      case "tool_result":
        return [
          {
            type: "tool_result",
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError ?? false,
          },
        ];
      case "thinking":
        return [];
    }
  });
}

function toAnthropicMessages(history: Message[]): Anthropic.MessageParam[] {
  return history.map((message) => ({
    role: message.role,
    content: toAnthropicContent(message.content),
  }));
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.jsonSchema as Anthropic.Tool.InputSchema,
  }));
}

function toStopReason(raw: string | null): StopReason {
  switch (raw) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    default:
      return "end_turn";
  }
}

export interface AnthropicProviderOptions {
  apiKey: string;
  maxTokens?: number;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.maxTokens = options.maxTokens ?? 8192;
  }

  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of this.client.models.list()) {
      models.push(model.id);
    }
    return models;
  }

  modelInfo(model: string): Promise<ModelInfo> {
    // The Anthropic API has no live source for this; a small hardcoded
    // table is the only option, and undefined for anything it doesn't
    // recognize rather than a guess.
    return Promise.resolve({ contextLength: lookupContextLength(model) });
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
    // Tool-call arguments arrive as JSON string fragments; buffer per block
    // index and parse once the block closes.
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >();
    let stopReason: StopReason = "end_turn";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = this.client.messages.stream({
        model: req.model,
        max_tokens: this.maxTokens,
        system: req.systemPrompt,
        messages: toAnthropicMessages(req.history),
        ...(req.tools.length > 0 ? { tools: toAnthropicTools(req.tools) } : {}),
      });

      for await (const event of stream) {
        switch (event.type) {
          case "message_start": {
            // Input tokens are only known at the start of the message; output
            // tokens accumulate and are read from message_delta below.
            inputTokens = event.message.usage.input_tokens;
            outputTokens = event.message.usage.output_tokens;
            break;
          }

          case "content_block_start": {
            const block = event.content_block;
            if (block.type === "tool_use") {
              pendingToolCalls.set(event.index, {
                id: block.id,
                name: block.name,
                argsJson: "",
              });
              yield { type: "tool-call-delta", id: block.id, name: block.name };
            }
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              yield { type: "text-delta", text: delta.text };
            } else if (delta.type === "input_json_delta") {
              const pending = pendingToolCalls.get(event.index);
              if (pending) {
                pending.argsJson += delta.partial_json;
                yield {
                  type: "tool-call-delta",
                  id: pending.id,
                  argsFragment: delta.partial_json,
                };
              }
            }
            break;
          }

          case "content_block_stop": {
            const pending = pendingToolCalls.get(event.index);
            if (pending) {
              pendingToolCalls.delete(event.index);
              yield {
                type: "tool-call-done",
                id: pending.id,
                name: pending.name,
                args: parseToolArgs(pending.argsJson),
              };
            }
            break;
          }

          case "message_delta": {
            stopReason = toStopReason(event.delta.stop_reason);
            if (event.usage) outputTokens = event.usage.output_tokens;
            break;
          }
        }
      }

      yield { type: "usage", inputTokens, outputTokens };
      yield { type: "message-done", stopReason };
    } catch (error) {
      yield { type: "error", error: asError(error) };
    }
  }
}

/**
 * Empty-argument tool calls stream no JSON at all, so treat a blank buffer as
 * `{}` rather than letting JSON.parse throw.
 */
function parseToolArgs(json: string): unknown {
  const trimmed = json.trim();
  if (trimmed === "") return {};
  return JSON.parse(trimmed);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
