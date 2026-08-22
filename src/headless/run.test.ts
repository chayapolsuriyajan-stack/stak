import { describe, expect, test } from "vitest";
import type { ChatRequest, Provider, ProviderStreamEvent } from "../providers/types.js";
import type { AgentContext } from "../agent/loop.js";
import type { Message } from "../agent/types.js";
import { runHeadless } from "./run.js";

/** A provider that replays scripted events, one script per round trip —
 * copied from src/agent/loop.test.ts's local helper per this codebase's
 * convention of not importing test helpers across test files. */
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

function context(provider: Provider, overrides: Partial<AgentContext> = {}): AgentContext {
  const history: Message[] = [];
  return {
    provider,
    model: "test-model",
    systemPrompt: "system",
    history,
    ...overrides,
  } satisfies AgentContext;
}

/** Accumulates every write() call into a single string, plus the raw list
 * of chunks for assertions that need to check granularity. */
function fakeWriter(): { write(s: string): void; text(): string; chunks: string[] } {
  const chunks: string[] = [];
  return {
    write(s: string) {
      chunks.push(s);
    },
    text() {
      return chunks.join("");
    },
    chunks,
  };
}

describe("a plain text-only turn", () => {
  test("stdout contains the accumulated text ending in exactly one newline, exit code 0", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hel" },
          { type: "text-delta", text: "lo" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "text",
      sessionId: "s1",
      stdout,
      stderr,
    });

    // "text" format streams each text-delta live (renderEvent) and then
    // renders the accumulated result again at the end (renderResult) — so
    // the full turn text appears, ending in exactly one trailing newline.
    expect(stdout.text()).toContain("hello");
    expect(stdout.text().endsWith("\n")).toBe(true);
    expect(stdout.text().endsWith("\n\n")).toBe(false);
    expect(code).toBe(0);
  });
});

describe("a tool-call turn", () => {
  test("emits a tool-activity line on stderr, not stdout", async () => {
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
      { executeTool: async () => ({ output: "file body", isError: false }) },
    );
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "read a",
      format: "text",
      sessionId: "s1",
      stdout,
      stderr,
    });

    expect(stderr.text()).toContain("[tool] read");
    expect(stdout.text()).not.toContain("[tool]");
    expect(code).toBe(0);
  });
});

describe("a provider error", () => {
  test("text format: exit code 1, error message on stderr", async () => {
    const ctx = context(scriptedProvider([[{ type: "error", error: new Error("boom") }]]));
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "text",
      sessionId: "s1",
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("boom");
  });

  test("json format: error field and isError in the final JSON on stdout", async () => {
    const ctx = context(scriptedProvider([[{ type: "error", error: new Error("boom") }]]));
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "json",
      sessionId: "s1",
      stdout,
      stderr,
    });

    const parsed = JSON.parse(stdout.text());
    expect(parsed.error).toContain("boom");
    expect(parsed.isError).toBe(true);
    expect(code).toBe(1);
  });
});

describe("format: json on a successful plain-text turn", () => {
  test("the single JSON object written to stdout parses and has the right shape", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hello" },
          { type: "usage", inputTokens: 10, outputTokens: 5 },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "json",
      sessionId: "s1",
      stdout,
      stderr,
    });

    const parsed = JSON.parse(stdout.text());
    expect(parsed.subtype).toBe("success");
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(parsed.numTurns).toBe(1);
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.provider).toBe("ollama");
    expect(parsed.model).toBe("test-model");
    expect(code).toBe(0);
  });
});

describe("format: stream-json", () => {
  test("every line written to stdout parses individually; the last line is the result record", async () => {
    const ctx = context(
      scriptedProvider([
        [
          { type: "text-delta", text: "hi" },
          { type: "message-done", stopReason: "end_turn" },
        ],
      ]),
    );
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "stream-json",
      sessionId: "s1",
      stdout,
      stderr,
    });

    const lines = stdout.text().split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const parsedLines = lines.map((line) => JSON.parse(line));
    for (const parsed of parsedLines) expect(typeof parsed).toBe("object");

    const last = parsedLines[parsedLines.length - 1];
    expect(last.type).toBe("result");
    expect(code).toBe(0);
  });
});

describe("aborting via an AbortSignal", () => {
  test("exit code 130 when already aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = context(scriptedProvider([]));
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "text",
      sessionId: "s1",
      stdout,
      stderr,
      signal: controller.signal,
    });

    expect(code).toBe(130);
  });

  test("exit code 130 when aborted mid-turn", async () => {
    const controller = new AbortController();
    const provider: Provider = {
      name: "ollama",
      async *streamChat(_req: ChatRequest) {
        yield { type: "text-delta", text: "one" };
        controller.abort();
        yield { type: "text-delta", text: "two" };
        yield { type: "message-done", stopReason: "end_turn" };
      },
    };
    const ctx = context(provider);
    const stdout = fakeWriter();
    const stderr = fakeWriter();

    const code = await runHeadless(ctx, {
      prompt: "hi",
      format: "text",
      sessionId: "s1",
      stdout,
      stderr,
      signal: controller.signal,
    });

    expect(code).toBe(130);
    expect(stdout.text()).not.toContain("two");
  });
});
