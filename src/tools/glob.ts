import fg from "fast-glob";
import { z } from "zod";
import type { Tool } from "./types.js";

const MAX_RESULTS = 500;

/** Directories that would otherwise swamp every result set. */
export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
];

const schema = z.object({
  pattern: z.string().describe("Glob pattern, for example src/**/*.ts"),
  cwd: z.string().optional().describe("Directory to search from, defaults to the working directory"),
});

export const globTool: Tool<z.infer<typeof schema>> = {
  name: "glob",
  description:
    "Find files by glob pattern. Returns matching paths; node_modules, .git, and build output are skipped.",
  schema,
  riskTier: "read-only",

  async execute(args, ctx) {
    try {
      const matches = await fg(args.pattern, {
        cwd: args.cwd ?? ctx.cwd,
        ignore: DEFAULT_IGNORE,
        onlyFiles: true,
        dot: false,
      });

      if (matches.length === 0) {
        return { output: `No files match ${args.pattern}.` };
      }

      const sorted = matches.sort();
      const shown = sorted.slice(0, MAX_RESULTS);
      const footer =
        sorted.length > MAX_RESULTS
          ? `\n… ${sorted.length - MAX_RESULTS} more matches not shown.`
          : "";

      return { output: shown.join("\n") + footer };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },
};
