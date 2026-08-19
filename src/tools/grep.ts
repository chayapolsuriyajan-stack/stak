import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { DEFAULT_IGNORE } from "./glob.js";
import { assertSafeGlobPattern, resolveWithinRoot } from "./pathSafety.js";
import type { Tool } from "./types.js";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 5_000_000;

const schema = z.object({
  pattern: z.string().describe("Regular expression to search for"),
  path: z.string().optional().describe("File or directory to search, defaults to the working directory"),
  glob: z.string().optional().describe("Restrict the search to files matching this glob"),
  case_insensitive: z.boolean().optional().describe("Match without regard to case"),
});

export const grepTool: Tool<z.infer<typeof schema>> = {
  name: "grep",
  description:
    "Search file contents with a regular expression. Returns file:line:text for each match.",
  schema,
  riskTier: "read-only",

  async execute(args, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
    } catch (error) {
      return {
        output: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    if (args.glob !== undefined) {
      const safePattern = assertSafeGlobPattern(args.glob);
      if (!safePattern.ok) return { output: safePattern.reason, isError: true };
    }

    const resolved = resolveWithinRoot(ctx.cwd, args.path ?? ".");
    if (!resolved.ok) return { output: resolved.reason, isError: true };
    const root = resolved.path;
    const files = await collectFiles(root, args.glob);

    if (files.length === 0) {
      return { output: "No files to search." };
    }

    const matches: string[] = [];
    let truncated = false;

    for (const file of files) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }

      let content: string;
      try {
        const stat = await fs.stat(file);
        // Skipping large files keeps a stray search over a data directory from
        // stalling the turn, and they are rarely what the model wants anyway.
        if (stat.size > MAX_FILE_BYTES) continue;
        content = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || !regex.test(line)) continue;

        matches.push(`${path.relative(ctx.cwd, file)}:${i + 1}:${line.trim()}`);
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
      }
    }

    if (matches.length === 0) {
      return { output: `No matches for /${args.pattern}/.` };
    }

    const footer = truncated ? `\n… stopped at ${MAX_MATCHES} matches.` : "";
    return { output: matches.join("\n") + footer };
  },
};

async function collectFiles(root: string, glob: string | undefined): Promise<string[]> {
  try {
    const stat = await fs.stat(root);
    if (stat.isFile()) return [root];
  } catch {
    return [];
  }

  return fg(glob ?? "**/*", {
    cwd: root,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
    absolute: true,
    dot: false,
  });
}
