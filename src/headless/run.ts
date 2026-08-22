/**
 * Headless turn-runner for stak's print mode (`stak -p "..."`).
 *
 * Drives exactly one turn through `runTurn` and pipes every event through
 * `./render.js`, writing to the caller-supplied stdout/stderr sinks. The
 * prompt is passed to `runTurn` completely unmodified — headless input may
 * come from untrusted piped stdin (`curl ... | stak -p "..."`), so it must
 * be treated as pure model input. This module deliberately does not import
 * `CommandRegistry` from `src/commands/` or anything from `src/memory/`:
 * slash-command dispatch and the `# fact` memory-append shortcut are
 * interactive-TUI-only affordances (see `src/tui/App.tsx`) and must never
 * be reachable from headless/piped input.
 */

import type { AgentContext } from "../agent/loop.js";
import { runTurn } from "../agent/loop.js";
import type { OutputFormat } from "../headless/options.js";
import { ResultAccumulator, exitCodeFor, renderEvent, renderResult } from "./render.js";

export interface HeadlessOptions {
  prompt: string;
  format: OutputFormat;
  sessionId: string;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  signal?: AbortSignal;
}

export async function runHeadless(ctx: AgentContext, options: HeadlessOptions): Promise<number> {
  const startTime = Date.now();
  const accumulator = new ResultAccumulator();

  for await (const event of runTurn(ctx, options.prompt, { signal: options.signal })) {
    accumulator.observe(event);
    const rendered = renderEvent(event, options.format);
    if (rendered.stdout !== undefined) options.stdout.write(rendered.stdout);
    if (rendered.stderr !== undefined) options.stderr.write(rendered.stderr);
  }

  const result = accumulator.build({
    sessionId: options.sessionId,
    provider: ctx.provider.name,
    model: ctx.model,
    durationMs: Date.now() - startTime,
  });

  const finalRendered = renderResult(result, options.format);
  if (finalRendered.stdout !== undefined) options.stdout.write(finalRendered.stdout);
  if (finalRendered.stderr !== undefined) options.stderr.write(finalRendered.stderr);

  return exitCodeFor(result);
}
