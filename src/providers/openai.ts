import OpenAI from "openai";
import type { Message } from "../agent/types.js";
import { lookupContextLength } from "./contextLimits.js";
import type {
  ChatRequest,
  ModelInfo,
  Provider,
  ProviderStreamEvent,
  StopReason,
  ToolDefinition,
} from "./types.js";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Flattens block-structured history into OpenAI's message list. Tool results
 * become their own `role: "tool"` messages keyed by the call they answer.
 */
function toOpenAIMessages(systemPrompt: string, history: Message[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  for (const message of history) {
    const textParts: string[] = [];
    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

    for (const block of message.content) {
      switch (block.type) {
        case "text":
          textParts.push(block.text);
          break;
        case "tool_use":
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
          break;
        case "tool_result":
          messages.push({
            role: "tool",
            tool_call_id: block.toolUseId,
            content: block.content,
          });
          break;
      }
    }

    const text = textParts.join("\n");

    if (message.role === "assistant" && (text !== "" || toolCalls.length > 0)) {
      messages.push({
        role: "assistant",
        content: text === "" ? null : text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (message.role === "user" && text !== "") {
      messages.push({ role: "user", content: text });
    }
  }

  return messages;
}

function toOpenAITools(
  tools: ToolDefinition[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    },
  }));
}

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
}

export class OpenAIProvider implements Provider {
  readonly name = "openai" as const;
  private client: OpenAI;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async listModels(): Promise<string[]> {
    const page = await this.client.models.list();
    // The endpoint returns every model the account can see, including
    // embeddings, audio, and image models that cannot serve a chat turn.
    return page.data
      .map((model) => model.id)
      .filter((id) => /^(gpt-|o[1-9])/.test(id))
      .sort();
  }

  modelInfo(model: string): Promise<ModelInfo> {
    // Same situation as Anthropic: no live endpoint reports this.
    return Promise.resolve({ contextLength: lookupContextLength(model) });
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
    // Tool calls arrive as fragments keyed by index, with the id and name
    // usually only present on the first fragment.
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let stopReason: StopReason = "end_turn";

    try {
      const stream = await this.client.chat.completions.create({
        model: req.model,
        messages: toOpenAIMessages(req.systemPrompt, req.history),
        stream: true,
        stream_options: { include_usage: true },
        ...(req.tools.length > 0 ? { tools: toOpenAITools(req.tools) } : {}),
      });

      for await (const chunk of stream) {
        // The usage-bearing final chunk carries no choices.
        if (chunk.usage) {
          yield {
            type: "usage",
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const content = choice.delta?.content;
        if (content) {
          yield { type: "text-delta", text: content };
        }

        for (const call of choice.delta?.tool_calls ?? []) {
          const index = call.index;
          const existing = pending.get(index) ?? { id: "", name: "", args: "" };

          if (call.id) existing.id = call.id;
          if (call.function?.name) existing.name = call.function.name;
          if (call.function?.arguments) {
            existing.args += call.function.arguments;
            yield {
              type: "tool-call-delta",
              id: existing.id,
              ...(call.function.name ? { name: call.function.name } : {}),
              argsFragment: call.function.arguments,
            };
          }

          pending.set(index, existing);
        }

        if (choice.finish_reason) {
          stopReason = toStopReason(choice.finish_reason);
        }
      }

      for (const call of pending.values()) {
        if (call.name === "") continue;
        yield {
          type: "tool-call-done",
          id: call.id,
          name: call.name,
          args: parseArgs(call.args),
        };
      }

      yield { type: "message-done", stopReason };
    } catch (error) {
      yield { type: "error", error: asError(error) };
    }
  }
}

function toStopReason(raw: string): StopReason {
  switch (raw) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

function parseArgs(json: string): unknown {
  const trimmed = json.trim();
  if (trimmed === "") return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { _raw: trimmed };
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
