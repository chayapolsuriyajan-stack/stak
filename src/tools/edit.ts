import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describeFsError } from "./read.js";
import type { Tool } from "./types.js";

const schema = z.object({
  path: z.string().describe("Path to the file to edit"),
  old_string: z.string().describe("Exact text to replace, including whitespace"),
  new_string: z.string().describe("Text to replace it with"),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring a unique match"),
});

export const editTool: Tool<z.infer<typeof schema>> = {
  name: "edit",
  description:
    "Replace exact text in a file. Fails if old_string is missing or appears more than once, unless replace_all is set.",
  schema,
  riskTier: "edit",

  async execute(args, ctx) {
    const target = path.resolve(ctx.cwd, args.path);

    if (args.old_string === args.new_string) {
      return { output: "old_string and new_string are identical.", isError: true };
    }

    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (error) {
      return { output: describeFsError(error, target), isError: true };
    }

    const occurrences = countOccurrences(content, args.old_string);

    // Failing loudly here matters: a silent no-op would let the model believe
    // an edit landed when the file is unchanged.
    if (occurrences === 0) {
      return {
        output: `old_string was not found in ${target}. Read the file and match its exact text, including indentation.`,
        isError: true,
      };
    }

    if (occurrences > 1 && !args.replace_all) {
      return {
        output: `old_string appears ${occurrences} times in ${target}. Include more surrounding context to make it unique, or set replace_all.`,
        isError: true,
      };
    }

    const updated = args.replace_all
      ? content.split(args.old_string).join(args.new_string)
      : content.replace(args.old_string, args.new_string);

    try {
      await fs.writeFile(target, updated, "utf8");
    } catch (error) {
      return { output: describeFsError(error, target), isError: true };
    }

    return {
      output: `Replaced ${occurrences} occurrence${occurrences === 1 ? "" : "s"} in ${target}.`,
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}
