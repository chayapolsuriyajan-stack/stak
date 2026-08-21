import { describe, expect, test, vi } from "vitest";
import type {
  ChatRequest,
  Provider,
  ProviderStreamEvent,
} from "../providers/types.js";
import { runTurn, type AgentContext } from "./loop.js";
import type { AgentEvent, Message } from "./types.js";

/** A provider that replays scripted events, one script per round trip. */
function scriptedProvider(scripts: ProviderStreamEvent[][]): Provider {
  let call = 0;
  return {
    name: "ollama",
    async *streamChat(_req: ChatRequest) {
      const script = scripts[call++] ?? [];
      for (const event of script) yield event;
    },
  };
}

function context(provider: Provider, overrides: Partial<AgentContext> = {}) {
  const history: Message[] = [];
  return {
    provider,
    model: "test",
    systemPrompt: "system",
    history,
    ...overrides,
  } satisfies AgentContext;
}

async function collect(generator: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

/** "progress" fires on every phase transition, which makes an exact
 * event-sequence assertion fragile to touch every time a transition is
 * added — filtered out here for tests asserting the substantive flow;
 * progress itself has its own dedicated coverage below. */
function withoutProgress(events: AgentEvent[]): AgentEvent[] {
  return events.filter((e) => e.type !== "progress");
}

describe("a plain text turn", () => {
  test("streams text and completes", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hel" },
          { type: "text-delta", text: "lo" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(withoutProgress(events).map((e) => e.type)).toEqual([
      "text-delta",
      "text-delta",
      "usage",
      "turn-complete",
    ]);
  });

  test("records both sides of the exchange in history", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hello" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    await collect(runTurn(ctx, "hi"));

    expect(ctx.history).toHaveLength(2);
    expect(ctx.history[0]?.role).toBe("user");
    expect(ctx.history[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });
  });
});

describe("tool calls", () => {
  test("executes a call and feeds the result back for a second round trip", async () => {
    const executeTool = vi.fn().mockResolvedValue({ output: "file body", isError: false });
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: { path: "a" } },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [
          { type: "text-delta", text: "done" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
      { executeTool },
    );

    const events = await collect(runTurn(ctx, "read a"));

    expect(executeTool).toHaveBeenCalledWith({
      id: "t1",
      name: "read",
      input: { path: "a" },
    });
    expect(withoutProgress(events).map((e) => e.type)).toEqual([
      "tool-call-start",
      "tool-call-result",
      "text-delta",
      "usage",
      "turn-complete",
    ]);
  });

  test("puts the tool_use message before its result, as providers require", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: {} },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [{ type: "message-done", stopReason: "end_turn" }],
      ]),
      { executeTool: async () => ({ output: "ok", isError: false }) },
    );

    await collect(runTurn(ctx, "go"));

    expect(ctx.history[1]?.content[0]?.type).toBe("tool_use");
    expect(ctx.history[2]?.content[0]?.type).toBe("tool_result");
  });

  test("reports an unavailable tool instead of hanging", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: {} },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [{ type: "message-done", stopReason: "end_turn" }],
      ]),
    );

    const events = await collect(runTurn(ctx, "go"));
    const result = events.find((e) => e.type === "tool-call-result");

    expect(result).toMatchObject({ isError: true });
  });
});

describe("truncation", () => {
  test("a final reply that hits the token/context limit is flagged", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "This response got cut off mid" },
          { type: "message-done", stopReason: "max_tokens" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(withoutProgress(events).map((e) => e.type)).toEqual([
      "text-delta",
      "truncated",
      "usage",
      "turn-complete",
    ]);
  });

  test("a normal end_turn reply is not flagged", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "Done." },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(events.some((e) => e.type === "truncated")).toBe(false);
  });

  test("hitting the limit mid tool-call round is not flagged as a truncated reply", async () => {
    // The round continues (more tool calls follow), so nothing here is a cut-off
    // final answer.
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: {} },
          { type: "message-done", stopReason: "max_tokens" },
        ],
        [{ type: "message-done", stopReason: "end_turn" }],
      ]),
      { executeTool: async () => ({ output: "ok", isError: false }) },
    );

    const events = await collect(runTurn(ctx, "go"));

    expect(events.some((e) => e.type === "truncated")).toBe(false);
  });
});

describe("thinking", () => {
  test("streams thinking-delta events and records a thinking block before the text block", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "thinking-delta", text: "let me consider this" },
          { type: "text-delta", text: "the answer" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(events.some((e) => e.type === "thinking-delta" && e.text === "let me consider this")).toBe(
      true,
    );
    expect(ctx.history[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", text: "let me consider this" },
        { type: "text", text: "the answer" },
      ],
    });
  });

  test("transitions phase to thinking on the first thinking delta", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "thinking-delta", text: "hmm" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(
      events.some((e) => e.type === "progress" && e.phase === "thinking"),
    ).toBe(true);
  });

  test("a round with no thinking does not add a thinking block to history", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "just an answer" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    await collect(runTurn(ctx, "hi"));

    expect(ctx.history[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "just an answer" }],
    });
  });

  test("always requests native thinking from the provider", async () => {
    let capturedOptions: unknown;
    const provider: Provider = {
      name: "ollama",
      async *streamChat(req: ChatRequest) {
        capturedOptions = req.options;
        yield { type: "message-done", stopReason: "end_turn" };
      },
    };
    const ctx = context(provider);

    await collect(runTurn(ctx, "hi"));

    expect(capturedOptions).toEqual({ think: true });
  });
});

describe("usage", () => {
  test("sums tokens across every round trip in the turn", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: {} },
          { type: "usage", inputTokens: 100, outputTokens: 20 },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [
          { type: "text-delta", text: "done" },
          { type: "usage", inputTokens: 130, outputTokens: 5 },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
      { executeTool: async () => ({ output: "ok", isError: false }) },
    );

    const events = await collect(runTurn(ctx, "go"));
    const usage = events.find((e) => e.type === "usage");

    expect(usage).toMatchObject({ inputTokens: 230, outputTokens: 25 });
  });

  test("a provider that never reports usage yields zero, not undefined", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hi" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const usage = events.find((e) => e.type === "usage");

    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  test("generatingMs excludes tool-execution time", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hi" },
          { type: "usage", inputTokens: 10, outputTokens: 2, generatingMs: 50 },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const usage = events.find((e) => e.type === "usage");

    // The provider's own reported generatingMs (50ms) should pass through
    // essentially unchanged -- nowhere close to a slow tool's execution time.
    expect(usage).toMatchObject({ type: "usage" });
    if (usage?.type !== "usage") throw new Error("expected a usage event");
    expect(usage.generatingMs).toBeLessThan(1000);
  });

  test("a slow tool does not inflate generatingMs", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "bash", args: {} },
          { type: "usage", inputTokens: 10, outputTokens: 2, generatingMs: 20 },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [
          { type: "text-delta", text: "done" },
          { type: "usage", inputTokens: 5, outputTokens: 1, generatingMs: 10 },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
      {
        executeTool: async () => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { output: "slow result", isError: false };
        },
      },
    );

    const events = await collect(runTurn(ctx, "go"));
    const usage = events.find((e) => e.type === "usage");

    if (usage?.type !== "usage") throw new Error("expected a usage event");
    // 20ms + 10ms of reported generation time; the 300ms tool sleep must not
    // leak in, since it happens strictly between the two rounds' streams.
    expect(usage.generatingMs).toBeLessThan(300);
  });
});

describe("progress", () => {
  test("reports waiting at the start of a round, then generating on the first delta", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hi" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const progress = events.filter((e) => e.type === "progress");

    expect(progress[0]).toMatchObject({ phase: "waiting", round: 1 });
    expect(progress.some((e) => e.type === "progress" && e.phase === "generating")).toBe(
      true,
    );
  });

  test("does not fire on every delta — only on transitions and round-end reconciliation", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "a" },
          { type: "text-delta", text: "b" },
          { type: "text-delta", text: "c" },
          { type: "text-delta", text: "d" },
          { type: "text-delta", text: "e" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const progress = events.filter((e) => e.type === "progress");
    const deltas = events.filter((e) => e.type === "text-delta");

    // One round: "waiting" at round start, "generating" on the first delta,
    // then one more at round-end reconciliation — not one per delta.
    expect(progress).toHaveLength(3);
    expect(progress.length).toBeLessThan(deltas.length);
  });

  test("reports the tool name while a tool call is running", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "bash", args: {} },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [{ type: "message-done", stopReason: "end_turn" }],
      ]),
      { executeTool: async () => ({ output: "ok", isError: false }) },
    );

    const events = await collect(runTurn(ctx, "go"));

    expect(
      events.some(
        (e) =>
          e.type === "progress" &&
          typeof e.phase === "object" &&
          e.phase.tool === "bash",
      ),
    ).toBe(true);
  });

  test("round number increments across tool-calling round trips", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "tool-call-done", id: "t1", name: "read", args: {} },
          { type: "message-done", stopReason: "tool_use" },
        ],
        [{ type: "message-done", stopReason: "end_turn" }],
      ]),
      { executeTool: async () => ({ output: "ok", isError: false }) },
    );

    const events = await collect(runTurn(ctx, "go"));
    const rounds = events
      .filter((e): e is Extract<AgentEvent, { type: "progress" }> => e.type === "progress")
      .map((e) => e.round);

    expect(Math.max(...rounds)).toBe(2);
  });

  test("reconciles the estimate to the authoritative count after a round", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hello world" },
          { type: "usage", inputTokens: 5, outputTokens: 3 },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const progress = events.filter(
      (e): e is Extract<AgentEvent, { type: "progress" }> => e.type === "progress",
    );
    const afterUsage = progress.at(-1);

    expect(afterUsage?.outputTokens).toBe(3);
    expect(afterUsage?.approx).toBe(false);
  });
});

describe("failure handling", () => {
  test("surfaces a provider error and stops, but still reports usage first", async () => {
    const ctx = context(
      scriptedProvider([[{ type: "error", error: new Error("network down") }]]),
    );

    const events = await collect(runTurn(ctx, "hi"));
    const withoutProg = withoutProgress(events);

    expect(withoutProg.map((e) => e.type)).toEqual(["usage", "error"]);
  });

  test("stops rather than looping forever on endless tool calls, but still reports usage", async () => {
    const endless: ProviderStreamEvent[][] = Array.from({ length: 60 }, () => [
      { type: "tool-call-done" as const, id: "t", name: "read", args: {} },
      { type: "message-done" as const, stopReason: "tool_use" as const },
    ]);
    const ctx = context(scriptedProvider(endless), {
      executeTool: async () => ({ output: "again", isError: false }),
    });

    const events = await collect(runTurn(ctx, "go"));
    const withoutProg = withoutProgress(events);
    const last = withoutProg[withoutProg.length - 1];

    expect(withoutProg.some((e) => e.type === "usage")).toBe(true);
    expect(last).toMatchObject({ type: "error" });
    if (last?.type !== "error") return;
    expect(last.error.message).toContain("50");
  });
});

describe("interruption", () => {
  test("stops mid-stream when the signal aborts, but still reports usage", async () => {
    const controller = new AbortController();
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "one" },
          { type: "text-delta", text: "two" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );

    const events: AgentEvent[] = [];
    for await (const event of runTurn(ctx, "hi", { signal: controller.signal })) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }
    const withoutProg = withoutProgress(events);

    expect(withoutProg.at(-1)).toMatchObject({ type: "interrupted" });
    expect(withoutProg.some((e) => e.type === "usage")).toBe(true);
    expect(events.filter((e) => e.type === "text-delta")).toHaveLength(1);
  });

  test("does not start when already aborted, but still reports (zero) usage", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = context(scriptedProvider([]));

    const events = await collect(runTurn(ctx, "hi", { signal: controller.signal }));

    expect(withoutProgress(events).map((e) => e.type)).toEqual(["usage", "interrupted"]);
  });
});

test("notifies the caller of each message for persistence", async () => {
  const onMessage = vi.fn();
  const ctx = context(
    scriptedProvider([
      [
        { type: "text-delta", text: "hello" },
        { type: "message-done", stopReason: "end_turn" },
      ],
    ]),
    { onMessage },
  );

  await collect(runTurn(ctx, "hi"));

  expect(onMessage).toHaveBeenCalledTimes(2);
});
