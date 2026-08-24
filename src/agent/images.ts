import fs from "node:fs/promises";
import path from "node:path";
import type { ImageBlock, ImageMediaType, Message } from "./types.js";

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
export const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);

export function fileExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(filePath));
}

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(fileExtension(filePath));
}

/** Magic-byte sniffing — the extension is a claim, these bytes are evidence.
 * A `.png` that is really an HTML error page must not reach the model. */
export function sniffImageMediaType(buf: Buffer): ImageMediaType | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

/** Replaces pixel payloads with empty strings for persistence — the block
 * survives with its mediaType and sourcePath, so resume can refill it. */
export function stripImagePayloads(message: Message): Message {
  let touched = false;
  const content = message.content.map((block) => {
    if (block.type !== "image" || block.data === "") return block;
    touched = true;
    return { ...block, data: "" };
  });
  return touched ? { ...message, content } : message;
}

/** Inverse of stripImagePayloads for --resume: refills emptied image blocks
 * from disk. A file that no longer exists (or changed type) becomes a plain
 * text marker so providers never receive an empty payload. */
export async function rehydrateImages(history: Message[]): Promise<Message[]> {
  return Promise.all(
    history.map(async (message) => {
      let touched = false;
      const content = await Promise.all(
        message.content.map(async (block): Promise<Message["content"][number]> => {
          if (block.type !== "image" || block.data !== "") return block;
          try {
            const buf = await fs.readFile(block.sourcePath);
            const mediaType = sniffImageMediaType(buf);
            if (mediaType) {
              touched = true;
              return { ...block, mediaType, data: buf.toString("base64") };
            }
          } catch {
            // Fall through to the missing-marker below.
          }
          touched = true;
          return { type: "text", text: `[missing image: ${block.sourcePath}]` };
        }),
      );
      return touched ? { ...message, content } : message;
    }),
  );
}

export function isImageBlock(block: Message["content"][number]): block is ImageBlock {
  return block.type === "image";
}
