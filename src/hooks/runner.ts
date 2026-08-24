import { spawn, type ChildProcess } from "node:child_process";
import type { HookEntry, PhaseHooks } from "./config.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Kills the whole process tree, not just the shell. On Windows the hook
 * command is spawned through cmd.exe, so child.kill() would terminate only
 * the shell and orphan any real work underneath it (a stray node/npx keeps
 * running indefinitely, holding pipes open). taskkill /T walks the tree. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

export interface HookInvocation {
  tool: string;
  args: unknown;
  cwd: string;
}

export interface HookOutcome {
  blocked: boolean;
  reasons: string[];
  notices: string[];
}

/** Replaces $token with the string value of args[token] (exact key or its
 * uppercase form); unknown tokens stay literal so real env vars survive
 * until the shell expands them. */
export function expandArgTokens(command: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return command;
  let expanded = command;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    for (const token of [`$${key}`, `$${key.toUpperCase()}`]) {
      expanded = expanded.split(token).join(value);
    }
  }
  return expanded;
}

export class HookRunner {
  private readonly hooks: PhaseHooks;

  constructor(hooks: PhaseHooks) {
    this.hooks = hooks;
  }

  async run(
    phase: "beforeTool" | "afterTool",
    invocation: HookInvocation,
  ): Promise<HookOutcome> {
    const outcome: HookOutcome = { blocked: false, reasons: [], notices: [] };
    const entries = this.hooks[phase];
    if (entries.length === 0) return outcome;

    const payload = JSON.stringify({ ...invocation, phase });
    for (const hook of entries) {
      if (
        hook.match !== undefined &&
        !new RegExp(hook.match).test(invocation.tool)
      ) {
        continue;
      }
      const result = await this.spawnOne(hook, payload, invocation.cwd);
      if (result.ok) continue;

      const detail = result.stderr.trim();
      if (phase === "beforeTool") {
        outcome.blocked = true;
        outcome.reasons.push(
          detail !== ""
            ? `blocked by hook "${hook.name}": ${detail}`
            : `blocked by hook "${hook.name}" (exit ${result.code ?? "signal"}).`,
        );
      } else {
        outcome.notices.push(
          detail !== ""
            ? `hook "${hook.name}" failed: ${detail}`
            : `hook "${hook.name}" failed with exit ${result.code ?? "signal"}.`,
        );
      }
    }
    return outcome;
  }

  private spawnOne(
    hook: HookEntry,
    payload: string,
    cwd: string,
  ): Promise<{ ok: boolean; code: number | null; stderr: string }> {
    // Entries built outside parseHooks (tests, future programmatic callers)
    // may omit timeout — fall back rather than letting setTimeout treat
    // undefined as an instant fire.
    const timeoutMs = hook.timeout ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      // stdout is piped-but-drained so chatty hooks can't deadlock on a full
      // pipe buffer; stderr is captured to explain vetoes and failures.
      const child = spawn(expandArgTokens(hook.run, payloadArgs(payload)), {
        shell: true,
        cwd,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killTree(child);
        resolve({
          ok: false,
          code: null,
          stderr: `${stderr}\nhook timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      child.stdout?.on("data", () => {});
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: null, stderr: `${stderr}\n${error.message}` });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stderr });
      });

      child.stdin?.end(payload);
    });
  }
}

function payloadArgs(payload: string): unknown {
  try {
    return (JSON.parse(payload) as { args?: unknown }).args;
  } catch {
    return undefined;
  }
}
