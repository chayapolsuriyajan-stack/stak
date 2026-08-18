import type { Provider } from "../providers/types.js";
import type { AgentEvent, ContentBlock, Message } from "./types.js";
import { userText } from "./types.js";

/** Guards against a model that keeps calling tools without ever concluding. */
const MAX_ITERATIONS = 50;

export interface AgentContext {
  provider: Provider;
  model: string;
  systemPrompt: string;
  history: Message[];
  /** Resolves a tool call to its result. Absent until milestone 3. */
  executeTool?: (
    call: { id: string; name: string; input: unknown },
  ) => Promise<{ output: string; isError: boolean }>;
  /** Tool schemas passed to the provider. Empty until milestone 3. */
  tools?: { name: string; description: string; jsonSchema: Record<string, unknown> }[];
  /** Called for every message appended to history, for session persistence. */
  onMessage?: (message: Message) => void;
}

export interface RunTurnOptions {
  /** Aborts the turn between streaming steps when the user interrupts. */
  signal?: AbortSignal;
}

/**
 * Runs one user turn to completion, which may span several provider round
 * trips if the model calls tools. Mutates `ctx.history` as it goes so the
 * caller keeps the conversation state.
 */
export async function* runTurn(
  ctx: AgentContext,
  input: string,
  options: RunTurnOptions = {},
): AsyncGenerator<AgentEvent> {
  const { signal } = options;
  append(ctx, userText(input));

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) return yield interrupted();
    const assistantBlocks: ContentBlock[] = [];
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let text = "";
    let failed = false;

    const stream = ctx.provider.streamChat({
      model: ctx.model,
      systemPrompt: ctx.systemPrompt,
      history: ctx.history,
      tools: ctx.tools ?? [],
    });

    for await (const event of stream) {
      // Stop consuming the stream promptly rather than after the model has
      // finished producing a response the user no longer wants.
      if (signal?.aborted) return yield interrupted();

      switch (event.type) {
        case "text-delta":
          text += event.text;
          yield { type: "text-delta", text: event.text };
          break;

        case "tool-call-done":
          toolCalls.push({ id: event.id, name: event.name, input: event.args });
          break;

        case "error":
          failed = true;
          yield { type: "error", error: event.error };
          break;

        // `tool-call-delta` is for incremental UI feedback only; the loop acts
        // on the completed call. `message-done` needs no handling here since
        // stream exhaustion already tells us the turn ended.
      }
    }

    if (failed) return;

    if (text !== "") assistantBlocks.push({ type: "text", text });
    for (const call of toolCalls) {
      assistantBlocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }

    if (assistantBlocks.length > 0) {
      append(ctx, { role: "assistant", content: assistantBlocks });
    }

    if (toolCalls.length === 0) {
      yield { type: "turn-complete" };
      return;
    }

    // Tool results go back as a single user message — both Anthropic and
    // OpenAI require the assistant's tool_use message to precede them, which
    // the append above guarantees.
    const resultBlocks: ContentBlock[] = [];

    for (const call of toolCalls) {
      if (signal?.aborted) return yield interrupted();

      yield {
        type: "tool-call-start",
        id: call.id,
        name: call.name,
        input: call.input,
      };

      const result = ctx.executeTool
        ? await ctx.executeTool(call)
        : {
            output: `Tool "${call.name}" is not available.`,
            isError: true,
          };

      yield {
        type: "tool-call-result",
        id: call.id,
        name: call.name,
        output: result.output,
        isError: result.isError,
      };

      resultBlocks.push({
        type: "tool_result",
        toolUseId: call.id,
        content: result.output,
        isError: result.isError,
      });
    }

    append(ctx, { role: "user", content: resultBlocks });
  }

  yield {
    type: "error",
    error: new Error(
      `Stopped after ${MAX_ITERATIONS} tool-call rounds without a final response.`,
    ),
  };
}

function append(ctx: AgentContext, message: Message): void {
  ctx.history.push(message);
  ctx.onMessage?.(message);
}

function interrupted(): AgentEvent {
  return { type: "interrupted" };
}
