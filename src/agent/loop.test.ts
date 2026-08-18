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

    expect(events.map((e) => e.type)).toEqual([
      "text-delta",
      "text-delta",
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
    expect(events.map((e) => e.type)).toEqual([
      "tool-call-start",
      "tool-call-result",
      "text-delta",
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

describe("failure handling", () => {
  test("surfaces a provider error and stops", async () => {
    const ctx = context(
      scriptedProvider([[{ type: "error", error: new Error("network down") }]]),
    );

    const events = await collect(runTurn(ctx, "hi"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
  });

  test("stops rather than looping forever on endless tool calls", async () => {
    const endless: ProviderStreamEvent[][] = Array.from({ length: 60 }, () => [
      { type: "tool-call-done" as const, id: "t", name: "read", args: {} },
      { type: "message-done" as const, stopReason: "tool_use" as const },
    ]);
    const ctx = context(scriptedProvider(endless), {
      executeTool: async () => ({ output: "again", isError: false }),
    });

    const events = await collect(runTurn(ctx, "go"));
    const last = events[events.length - 1];

    expect(last).toMatchObject({ type: "error" });
    if (last?.type !== "error") return;
    expect(last.error.message).toContain("50");
  });
});

describe("interruption", () => {
  test("stops mid-stream when the signal aborts", async () => {
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

    expect(events.at(-1)).toMatchObject({ type: "interrupted" });
    expect(events.filter((e) => e.type === "text-delta")).toHaveLength(1);
  });

  test("does not start when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = context(scriptedProvider([]));

    const events = await collect(runTurn(ctx, "hi", { signal: controller.signal }));

    expect(events).toEqual([{ type: "interrupted" }]);
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
