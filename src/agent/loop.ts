import type { Provider, StopReason } from "../providers/types.js";
import { TurnStats } from "./turnStats.js";
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

  const turnStart = Date.now();
  const stats = new TurnStats();

  // Every exit routes through here so a `usage` event — and the tokens/time
  // already spent — is never silently dropped on an abort, a provider
  // error, or hitting MAX_ITERATIONS the way it was before this existed.
  function* endTurn(terminal: AgentEvent): Generator<AgentEvent> {
    const usage = stats.finalUsage();
    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      elapsedMs: Date.now() - turnStart,
      generatingMs: usage.generatingMs,
    };
    yield terminal;
  }

  function* progress(): Generator<AgentEvent> {
    yield { type: "progress", ...stats.snapshot() };
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) return yield* endTurn(interrupted());

    stats.setRound(iteration + 1);
    yield* progress();

    const assistantBlocks: ContentBlock[] = [];
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let text = "";
    let providerError: Error | undefined;
    let stopReason: StopReason = "end_turn";
    let generating = false;
    let roundUsage: { inputTokens: number; outputTokens: number; generatingMs?: number } = {
      inputTokens: 0,
      outputTokens: 0,
    };

    const roundStart = Date.now();
    const stream = ctx.provider.streamChat({
      model: ctx.model,
      systemPrompt: ctx.systemPrompt,
      history: ctx.history,
      tools: ctx.tools ?? [],
    });

    for await (const event of stream) {
      // Stop consuming the stream promptly rather than after the model has
      // finished producing a response the user no longer wants.
      if (signal?.aborted) return yield* endTurn(interrupted());

      switch (event.type) {
        case "text-delta":
          text += event.text;
          stats.recordTextDelta(event.text);
          if (!generating) {
            generating = true;
            stats.setPhase("generating");
            yield* progress();
          }
          yield { type: "text-delta", text: event.text };
          break;

        case "tool-call-done":
          toolCalls.push({ id: event.id, name: event.name, input: event.args });
          break;

        case "usage":
          roundUsage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            ...(event.generatingMs !== undefined
              ? { generatingMs: event.generatingMs }
              : {}),
          };
          break;

        case "error":
          // Captured rather than yielded here: the terminal "error" event
          // must come after "usage", same as every other exit, so it goes
          // through endTurn below instead of being emitted inline.
          providerError = event.error;
          break;

        case "message-done":
          stopReason = event.stopReason;
          break;

        // `tool-call-delta` is for incremental UI feedback only; the loop
        // acts on the completed call.
      }
    }

    if (providerError) {
      return yield* endTurn({ type: "error", error: providerError });
    }

    stats.recordRoundUsage(roundUsage, Date.now() - roundStart);
    yield* progress();

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
      // A tool-call round hitting the limit just means "call more tools next
      // round" and self-corrects; a *final* reply hitting it means the text
      // on screen is genuinely incomplete, which the model gives no other
      // sign of — the response just stops mid-thought.
      if (stopReason === "max_tokens") yield { type: "truncated" };

      return yield* endTurn({ type: "turn-complete" });
    }

    // Tool results go back as a single user message — both Anthropic and
    // OpenAI require the assistant's tool_use message to precede them, which
    // the append above guarantees.
    const resultBlocks: ContentBlock[] = [];

    for (const call of toolCalls) {
      if (signal?.aborted) return yield* endTurn(interrupted());

      stats.setPhase({ tool: call.name });
      yield* progress();

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

  yield* endTurn({
    type: "error",
    error: new Error(
      `Stopped after ${MAX_ITERATIONS} tool-call rounds without a final response.`,
    ),
  });
}

function append(ctx: AgentContext, message: Message): void {
  ctx.history.push(message);
  ctx.onMessage?.(message);
}

function interrupted(): AgentEvent {
  return { type: "interrupted" };
}
