import { Ollama } from "ollama";
import type { Message } from "../agent/types.js";
import type {
  ChatRequest,
  Provider,
  ProviderStreamEvent,
  StopReason,
  ToolDefinition,
} from "./types.js";

/** Ollama follows OpenAI's message conventions rather than content blocks. */
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

/**
 * Flattens our block-structured history into Ollama's flat message list. A
 * single internal message can expand into several Ollama messages, since tool
 * results each need their own `role: "tool"` entry.
 */
function toOllamaMessages(history: Message[]): OllamaMessage[] {
  const messages: OllamaMessage[] = [];

  for (const message of history) {
    const textParts: string[] = [];
    const toolCalls: NonNullable<OllamaMessage["tool_calls"]> = [];

    for (const block of message.content) {
      switch (block.type) {
        case "text":
          textParts.push(block.text);
          break;
        case "tool_use":
          toolCalls.push({
            function: {
              name: block.name,
              arguments: (block.input ?? {}) as Record<string, unknown>,
            },
          });
          break;
        case "tool_result":
          // Emitted separately below so it lands in its own tool message.
          break;
      }
    }

    const toolResults = message.content.filter((b) => b.type === "tool_result");

    if (textParts.length > 0 || toolCalls.length > 0) {
      messages.push({
        role: message.role,
        content: textParts.join("\n"),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    }

    for (const result of toolResults) {
      messages.push({ role: "tool", content: result.content });
    }
  }

  return messages;
}

function toOllamaTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema as never,
    },
  }));
}

export interface OllamaProviderOptions {
  host?: string;
}

export class OllamaProvider implements Provider {
  readonly name = "ollama" as const;
  private client: Ollama;

  constructor(options: OllamaProviderOptions = {}) {
    this.client = new Ollama({
      host: options.host ?? "http://localhost:11434",
    });
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.list();
    return response.models.map((model) => model.name);
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
    let callIndex = 0;
    let sawToolCall = false;

    try {
      const messages: OllamaMessage[] = [
        { role: "system", content: req.systemPrompt },
        ...toOllamaMessages(req.history),
      ];

      const stream = await this.client.chat({
        model: req.model,
        messages: messages as never,
        stream: true,
        ...(req.tools.length > 0 ? { tools: toOllamaTools(req.tools) } : {}),
      });

      for await (const chunk of stream) {
        const content = chunk.message?.content;
        if (content) {
          yield { type: "text-delta", text: content };
        }

        // Unlike Anthropic and OpenAI, Ollama hands over a complete tool call
        // in one chunk, so synthesize the delta/done pair the loop expects.
        const calls = chunk.message?.tool_calls;
        if (calls) {
          for (const call of calls) {
            sawToolCall = true;
            const id = `ollama_call_${callIndex++}`;
            const name = call.function.name;
            yield { type: "tool-call-delta", id, name };
            yield {
              type: "tool-call-done",
              id,
              name,
              args: normalizeArgs(call.function.arguments),
            };
          }
        }
      }

      const stopReason: StopReason = sawToolCall ? "tool_use" : "end_turn";
      yield { type: "message-done", stopReason };
    } catch (error) {
      yield { type: "error", error: asError(error) };
    }
  }
}

/**
 * Local models are less disciplined than hosted ones about argument encoding —
 * some emit a JSON string where an object is expected. Recover where we can so
 * a sloppy encoding does not abort the turn.
 */
function normalizeArgs(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  const trimmed = args.trim();
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
