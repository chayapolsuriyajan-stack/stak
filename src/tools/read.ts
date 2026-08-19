import fs from "node:fs/promises";
import { z } from "zod";
import { resolveWithinRoot } from "./pathSafety.js";
import type { Tool } from "./types.js";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const schema = z.object({
  path: z.string().describe("Path to the file, absolute or relative to the working directory"),
  offset: z.number().int().min(1).optional().describe("1-based line to start from"),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to read"),
});

export const readTool: Tool<z.infer<typeof schema>> = {
  name: "read",
  description:
    "Read a file from the filesystem. Output is line-numbered so you can quote exact strings back to the edit tool.",
  schema,
  riskTier: "read-only",

  async execute(args, ctx) {
    const resolved = resolveWithinRoot(ctx.cwd, args.path);
    if (!resolved.ok) return { output: resolved.reason, isError: true };
    const target = resolved.path;

    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (error) {
      return { output: describeFsError(error, target), isError: true };
    }

    if (content === "") {
      return { output: `${target} exists but is empty.` };
    }

    const lines = content.split("\n");
    const start = (args.offset ?? 1) - 1;
    const limit = args.limit ?? DEFAULT_LIMIT;
    const slice = lines.slice(start, start + limit);

    if (slice.length === 0) {
      return {
        output: `Offset ${args.offset} is past the end of the file (${lines.length} lines).`,
        isError: true,
      };
    }

    // Mirrors `cat -n`: a right-aligned line number, a tab, then the text.
    const numbered = slice
      .map((line, index) => {
        const lineNumber = String(start + index + 1).padStart(6, " ");
        const truncated =
          line.length > MAX_LINE_LENGTH
            ? `${line.slice(0, MAX_LINE_LENGTH)}… (line truncated)`
            : line;
        return `${lineNumber}\t${truncated}`;
      })
      .join("\n");

    const remaining = lines.length - (start + slice.length);
    const footer =
      remaining > 0 ? `\n\n… ${remaining} more lines. Use offset to continue.` : "";

    return { output: numbered + footer };
  },
};

export function describeFsError(error: unknown, target: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return `No such file: ${target}`;
    case "EISDIR":
      return `${target} is a directory, not a file.`;
    case "EACCES":
      return `Permission denied: ${target}`;
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
