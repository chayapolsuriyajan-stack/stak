import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveWithinRoot } from "./pathSafety.js";
import { describeFsError } from "./read.js";
import type { Tool } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path to write, absolute or relative to the working directory"),
  content: z.string().describe("Full contents to write to the file"),
});

export const writeTool: Tool<z.infer<typeof schema>> = {
  name: "write",
  description:
    "Write a file, creating it or replacing its entire contents. To change part of an existing file, prefer the edit tool.",
  schema,
  riskTier: "edit",

  async execute(args, ctx) {
    const resolved = resolveWithinRoot(ctx.cwd, args.path);
    if (!resolved.ok) return { output: resolved.reason, isError: true };
    const target = resolved.path;

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const existed = await exists(target);
      await fs.writeFile(target, args.content, "utf8");

      const lineCount = args.content.split("\n").length;
      return {
        output: `${existed ? "Overwrote" : "Created"} ${target} (${lineCount} lines).`,
      };
    } catch (error) {
      return { output: describeFsError(error, target), isError: true };
    }
  },
};

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
