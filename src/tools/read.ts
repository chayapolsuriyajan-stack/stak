import fs from "node:fs/promises";
import { z } from "zod";
import {
  isImageFile,
  isVideoFile,
  sniffImageMediaType,
} from "../agent/images.js";
import type { ImageData } from "../agent/types.js";
import { resolveWithinRoot } from "./pathSafety.js";
import { extractVideoFrames } from "./video.js";
import type { Tool } from "./types.js";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const schema = z.object({
  path: z.string().describe("Path to the file, absolute or relative to the working directory"),
  offset: z.number().int().min(1).optional().describe("1-based line to start from"),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to read"),
  maxFrames: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Video files only: frames to sample (default 8)"),
});

export const readTool: Tool<z.infer<typeof schema>> = {
  name: "read",
  description:
    "Read a file from the filesystem. Output is line-numbered so you can quote exact strings back to the edit tool. Image files (png/jpg/webp/gif) return as viewable images — this needs a vision-capable model. Video files (mp4/webm/mov/mkv) return sampled frames via ffmpeg.",
  schema,
  riskTier: "read-only",

  async execute(args, ctx) {
    const resolved = resolveWithinRoot(ctx.cwd, args.path);
    if (!resolved.ok) return { output: resolved.reason, isError: true };
    const target = resolved.path;

    if (isImageFile(target)) {
      return readImage(target);
    }
    if (isVideoFile(target)) {
      return readVideo(target, args.maxFrames);
    }

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

async function readImage(target: string): Promise<{
  output: string;
  images?: ImageData[];
  isError?: boolean;
}> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(target);
  } catch (error) {
    return { output: describeFsError(error, target), isError: true };
  }

  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return {
      output: `${target} is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB image limit. Downscale or convert it first.`,
      isError: true,
    };
  }

  const mediaType = sniffImageMediaType(buf);
  if (!mediaType) {
    return {
      output: `${target} has an image extension but its content is not a recognized image format.`,
      isError: true,
    };
  }

  return { output: `[image ${target}]`, images: [{ mediaType, data: buf.toString("base64"), sourcePath: target }] };
}

async function readVideo(
  target: string,
  maxFrames: number | undefined,
): Promise<{ output: string; images?: ImageData[]; isError?: boolean }> {
  try {
    const { frames, note } = await extractVideoFrames(target, maxFrames);
    return { output: `[video ${target}] — ${note}`, images: frames };
  } catch (error) {
    return {
      output: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

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
