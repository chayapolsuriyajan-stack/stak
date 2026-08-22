import os from "node:os";
import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import type { AgentContext } from "../agent/loop.js";
import { createModelInfoCache } from "../agent/modelInfo.js";
import type { Message } from "../agent/types.js";
import { builtinCommands } from "../commands/builtins.js";
import { CommandRegistry } from "../commands/dispatch.js";
import { PermissionManager } from "../permissions/manager.js";
import type { Provider, ProviderStreamEvent } from "../providers/types.js";
import { App } from "./App.js";
import type { AppProps } from "./App.js";

/**
 * useInput's raw-mode listener attaches in a useEffect, which runs
 * asynchronously after Ink's initial render — a tick lets that effect (and
 * each subsequent state update) settle first. Same pattern as
 * SessionPicker.test.tsx.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `check` until it returns true, or throws once `timeoutMs` elapses.
 * Real timers are in play here (the app's flush interval, async provider
 * generators), so a fixed number of ticks is not reliable — this waits for
 * the actual observable effect instead. */
async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await wait(20);
  }
}

/** Six messages (three user/assistant pairs) — enough that
 * splitForCompaction's default keepRecent=4 leaves at least two in `older`,
 * so /compact and auto-compaction have something to summarize instead of
 * throwing "Nothing to compact yet". */
function seedHistory(pairs = 3): Message[] {
  const history: Message[] = [];
  for (let i = 0; i < pairs; i++) {
    history.push({ role: "user", content: [{ type: "text", text: `question ${i}` }] });
    history.push({ role: "assistant", content: [{ type: "text", text: `answer ${i}` }] });
  }
  return history;
}

/** A minimal fake Provider. Every streamChat call — whether it's a real
 * turn or the internal summarization request compactHistory makes — yields
 * a text delta, an optional usage event, then message-done. compactHistory
 * only reads text-delta/error, so the usage event is harmless noise there;
 * runTurn reads usage to populate live.stats.latestInputTokens. */
function fakeProvider(opts: { inputTokens?: number; contextLength?: number } = {}): Provider {
  const { inputTokens = 10, contextLength } = opts;
  return {
    name: "anthropic",
    ...(contextLength !== undefined
      ? { modelInfo: async () => ({ contextLength }) }
      : {}),
    async *streamChat(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: "text-delta", text: "a reply" };
      yield { type: "usage", inputTokens, outputTokens: 5 };
      yield { type: "message-done", stopReason: "end_turn" };
    },
  };
}

function makeCtx(provider: Provider, history: Message[]): AgentContext {
  return {
    provider,
    model: "test-model",
    systemPrompt: "You are a test agent.",
    history,
  };
}

function makeApp(ctx: AgentContext, extra: Partial<AppProps> = {}) {
  const permissions = new PermissionManager("ask", os.tmpdir());
  const commands = new CommandRegistry(builtinCommands);
  return render(
    <App
      ctx={ctx}
      permissions={permissions}
      commands={commands}
      version="0.0.0-test"
      cwd={os.tmpdir()}
      {...extra}
    />,
  );
}

test("/compact summarizes the conversation and reports it in the transcript", async () => {
  const ctx = makeCtx(fakeProvider(), seedHistory());
  const { stdin, lastFrame } = makeApp(ctx);
  await tick();

  stdin.write("/compact");
  await tick();
  stdin.write("\r");

  // describeCompaction's exact wording is another job's concern; "Compacted"
  // is the one substring guaranteed stable by its implementation.
  await waitFor(() => (lastFrame() ?? "").includes("Compacted"));
  expect(lastFrame()).toContain("Compacted");
});

test("/compact calls onCompacted so the manual path persists the result, not just the auto-compaction path", async () => {
  // Regression test: the manual /compact command used to be wired straight
  // to the hook's raw compact callback, bypassing onCompacted entirely, so
  // store.compacted(...) (wired in cli.ts) never ran for a manual compact
  // and no `compaction` record was ever written.
  const ctx = makeCtx(fakeProvider(), seedHistory());
  const onCompacted = vi.fn();
  const { stdin, lastFrame } = makeApp(ctx, { onCompacted });
  await tick();

  stdin.write("/compact");
  await tick();
  stdin.write("\r");

  await waitFor(() => (lastFrame() ?? "").includes("Compacted"));
  expect(onCompacted).toHaveBeenCalledTimes(1);
  expect(onCompacted).toHaveBeenCalledWith(ctx.history);
});

test("auto-compaction fires on its own once context usage crosses the threshold", async () => {
  // contextLength 1000 and a turn reporting 950 input tokens crosses the
  // default 0.85 auto-compact threshold (950/1000 = 0.95).
  const ctx = makeCtx(fakeProvider({ inputTokens: 950, contextLength: 1000 }), seedHistory());
  const modelInfoCache = createModelInfoCache();
  const { stdin, lastFrame } = makeApp(ctx, { modelInfoCache });
  await tick();

  stdin.write("hi");
  await tick();
  stdin.write("\r");

  // No /compact was typed — this notice can only come from the auto-compact
  // effect noticing live.stats.latestInputTokens crossed the threshold.
  await waitFor(() => (lastFrame() ?? "").includes("Auto-compacted"));
  expect(lastFrame()).toContain("Auto-compacted");
});

test("auto-compaction stays off when autoCompact={false}, even over threshold", async () => {
  const ctx = makeCtx(fakeProvider({ inputTokens: 950, contextLength: 1000 }), seedHistory());
  const modelInfoCache = createModelInfoCache();
  const { stdin, lastFrame } = makeApp(ctx, { modelInfoCache, autoCompact: false });
  await tick();

  stdin.write("hi");
  await tick();
  stdin.write("\r");

  // Give the same amount of real time the positive test needed for the
  // effect to have fired, then assert it didn't.
  await wait(1500);
  expect(lastFrame()).not.toContain("Auto-compacted");
});
