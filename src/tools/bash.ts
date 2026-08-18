import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

const schema = z.object({
  command: z.string().describe("Shell command to run"),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe("Timeout in milliseconds, default 120000"),
  cwd: z.string().optional().describe("Directory to run in, defaults to the working directory"),
});

export const bashTool: Tool<z.infer<typeof schema>> = {
  name: "bash",
  description:
    "Run a shell command and return its combined output. Use dedicated tools for reading, writing, and searching files where possible.",
  schema,
  riskTier: "bash",

  execute(args, ctx) {
    return new Promise((resolve) => {
      const timeout = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      const child = spawn(args.command, {
        shell: true,
        cwd: args.cwd ?? ctx.cwd,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        child.kill();
        finish(`Command timed out after ${timeout}ms.\n${combine(stdout, stderr)}`, true);
      }, timeout);

      const finish = (output: string, isError: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ output: truncate(output), isError });
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        finish(`Failed to run command: ${error.message}`, true);
      });

      child.on("close", (code) => {
        const output = combine(stdout, stderr);
        if (code === 0) {
          finish(output === "" ? "(no output)" : output, false);
        } else {
          finish(`Exited with code ${code}.\n${output}`, true);
        }
      });

      ctx.signal?.addEventListener("abort", () => {
        child.kill();
        finish("Command was interrupted.", true);
      });
    });
  },
};

function combine(stdout: string, stderr: string): string {
  return [stdout, stderr].filter((part) => part !== "").join("\n").trimEnd();
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated at ${MAX_OUTPUT_CHARS} characters.`;
}
