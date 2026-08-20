import { Ollama } from "ollama";
import type { Message } from "../agent/types.js";
import { createThinkTagSplitter } from "./thinkTags.js";
import type {
  ChatRequest,
  ModelInfo,
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
        case "thinking":
          // Tool results are emitted separately below so they land in their
          // own message. Thinking is dropped entirely: it must never be
          // replayed back to the model as if it were prior assistant
          // speech, and a local model re-reading its own past reasoning
          // verbatim is not something it was trained to expect.
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
  // Capability lookups are cached per model rather than per streamChat call
  // — every round trip in a turn would otherwise re-query show() just to
  // decide whether to set `think`.
  private capabilityCache = new Map<string, Promise<string[]>>();

  constructor(options: OllamaProviderOptions = {}) {
    this.client = new Ollama({
      host: options.host ?? "http://localhost:11434",
    });
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.list();
    return response.models.map((model) => model.name);
  }

  async modelInfo(model: string): Promise<ModelInfo> {
    // Best-effort: the server might be unreachable, or the model unpulled.
    // A status-bar readout is never worth failing or blocking a turn over.
    try {
      const show = await this.client.show({ model });
      return {
        contextLength: parseContextLength(show.model_info, show.parameters),
        capabilities: show.capabilities,
      };
    } catch {
      return {};
    }
  }

  private capabilities(model: string): Promise<string[]> {
    let pending = this.capabilityCache.get(model);
    if (!pending) {
      pending = this.client
        .show({ model })
        .then((show) => show.capabilities ?? [])
        .catch(() => []);
      this.capabilityCache.set(model, pending);
    }
    return pending;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderStreamEvent> {
    let callIndex = 0;
    let sawToolCall = false;
    let doneReason: string | undefined;
    // Runs on the content channel unconditionally, native thinking or not:
    // some Qwen builds inline <think> tags in `content` even with `think`
    // requested, so this is the safety net that makes both paths converge
    // rather than something only the fallback needs. Cheap passthrough when
    // no tags are present.
    const tagSplitter = createThinkTagSplitter();

    try {
      const supportsThinking = (await this.capabilities(req.model)).includes("thinking");

      const messages: OllamaMessage[] = [
        { role: "system", content: req.systemPrompt },
        ...toOllamaMessages(req.history),
      ];

      const stream = await this.client.chat({
        model: req.model,
        messages: messages as never,
        stream: true,
        ...(req.tools.length > 0 ? { tools: toOllamaTools(req.tools) } : {}),
        ...(supportsThinking && req.options?.think ? { think: true } : {}),
      });

      for await (const chunk of stream) {
        // The native field, when the model/server actually populate it —
        // already pure reasoning text, so it bypasses the tag splitter.
        const nativeThinking = chunk.message?.thinking;
        if (nativeThinking) {
          yield { type: "thinking-delta", text: nativeThinking };
        }

        const content = chunk.message?.content;
        if (content) {
          const { thinking, text } = tagSplitter.push(content);
          if (thinking) yield { type: "thinking-delta", text: thinking };
          if (text) yield { type: "text-delta", text };
        }

        if (chunk.done) {
          // "length" means num_predict or the context window was hit and the
          // response was cut off mid-generation, not that the model chose to
          // stop — the loop needs this distinction to tell the user rather
          // than silently presenting a truncated reply as a finished one.
          doneReason = chunk.done_reason;
          yield {
            type: "usage",
            inputTokens: chunk.prompt_eval_count ?? 0,
            outputTokens: chunk.eval_count ?? 0,
            // eval_duration is nanoseconds and covers generation only, not
            // the tool-execution time that would otherwise contaminate a
            // wall-clock tok/s figure.
            ...(chunk.eval_duration !== undefined
              ? { generatingMs: chunk.eval_duration / 1e6 }
              : {}),
          };
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

      const final = tagSplitter.end();
      if (final.thinking) yield { type: "thinking-delta", text: final.thinking };
      if (final.text) yield { type: "text-delta", text: final.text };

      yield { type: "message-done", stopReason: toStopReason(doneReason, sawToolCall) };
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

/**
 * Reads the architecture's native context length from `show()`'s
 * `model_info` (keyed like `qwen35.context_length`, architecture-prefixed —
 * hence the suffix search rather than a fixed key) and the effective
 * `num_ctx` a Modelfile may have capped it to from `parameters`, a
 * multi-line "key   value" string, and returns whichever is smaller: a
 * Modelfile cap is a real ceiling on what will actually be used, so
 * reporting the larger architectural number would overstate the window.
 *
 * `model_info` is typed as `Map<string, any>` by the ollama package's own
 * .d.ts, but is actually a plain object at runtime (verified against a
 * running server) — accepting `unknown` here decouples this function from
 * that mismatch and keeps it independently testable against plain fixtures.
 */
export function parseContextLength(
  modelInfo: unknown,
  parameters: string | undefined,
): number | undefined {
  const archLength = findArchContextLength(modelInfo);
  const numCtx = parseNumCtx(parameters);

  if (archLength !== undefined && numCtx !== undefined) {
    return Math.min(archLength, numCtx);
  }
  return archLength ?? numCtx;
}

function findArchContextLength(modelInfo: unknown): number | undefined {
  const entries =
    modelInfo instanceof Map
      ? [...modelInfo.entries()]
      : Object.entries((modelInfo ?? {}) as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function parseNumCtx(parameters: string | undefined): number | undefined {
  const match = parameters?.match(/^num_ctx\s+(\d+)/m);
  const value = match?.[1] ? Number(match[1]) : undefined;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * "length" means num_predict or the context window was hit and the response
 * was cut off mid-generation, not that the model chose to stop — the loop
 * needs this distinction to tell the user rather than silently presenting a
 * truncated reply as a finished one.
 */
export function toStopReason(
  doneReason: string | undefined,
  sawToolCall: boolean,
): StopReason {
  if (sawToolCall) return "tool_use";
  return doneReason === "length" ? "max_tokens" : "end_turn";
}
