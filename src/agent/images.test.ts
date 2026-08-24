import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  isImageFile,
  isVideoFile,
  rehydrateImages,
  sniffImageMediaType,
  stripImagePayloads,
} from "./images.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

describe("sniffImageMediaType", () => {
  test("recognizes png/jpeg/gif/webp magic bytes", () => {
    expect(sniffImageMediaType(PNG_BYTES)).toBe("image/png");
    expect(sniffImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMediaType(Buffer.from("GIF89a...."))).toBe("image/gif");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
    expect(sniffImageMediaType(webp)).toBe("image/webp");
  });

  test("rejects short or non-image buffers", () => {
    expect(sniffImageMediaType(Buffer.from("<html>"))).toBeUndefined();
    expect(sniffImageMediaType(Buffer.from([0x00]))).toBeUndefined();
  });
});

describe("extension helpers", () => {
  test("classifies image and video extensions case-insensitively", () => {
    expect(isImageFile("a.PNG")).toBe(true);
    expect(isImageFile("b.jpeg")).toBe(true);
    expect(isImageFile("c.txt")).toBe(false);
    expect(isVideoFile("d.MP4")).toBe(true);
    expect(isVideoFile("e.mov")).toBe(true);
    expect(isVideoFile("f.png")).toBe(false);
  });
});

describe("stripImagePayloads", () => {
  test("empties data but keeps mediaType and sourcePath", () => {
    const message = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "see attached" },
        {
          type: "image" as const,
          mediaType: "image/png" as const,
          data: "AAAA",
          sourcePath: "/p/shot.png",
        },
      ],
    };

    const stripped = stripImagePayloads(message);

    expect(stripped.content[1]).toMatchObject({ type: "image", data: "", sourcePath: "/p/shot.png" });
    expect(message.content[1]).toHaveProperty("data", "AAAA"); // original untouched
  });

  test("returns the same message object when nothing to strip", () => {
    const message = { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] };
    expect(stripImagePayloads(message)).toBe(message);
  });
});

describe("rehydrateImages", () => {
  test("refills empty payloads from disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stak-img-"));
    const imagePath = path.join(dir, "shot.png");
    await fs.writeFile(imagePath, PNG_BYTES);

    const [refilled] = await rehydrateImages([
      {
        role: "user",
        content: [
          { type: "image", mediaType: "image/png", data: "", sourcePath: imagePath },
        ],
      },
    ]);
    if (!refilled) throw new Error("expected one message back");

    expect(refilled.content[0]).toMatchObject({
      type: "image",
      data: PNG_BYTES.toString("base64"),
    });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("replaces unreadable files with a missing marker", async () => {
    const [result] = await rehydrateImages([
      {
        role: "user",
        content: [
          {
            type: "image",
            mediaType: "image/png",
            data: "",
            sourcePath: path.join(os.tmpdir(), "definitely-gone-xyz.png"),
          },
        ],
      },
    ]);
    if (!result) throw new Error("expected one message back");

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("[missing image:"),
    });
  });
});
