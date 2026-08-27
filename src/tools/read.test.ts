import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readTool } from "./read.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-read-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe("image reading", () => {
  test("returns an image payload for a real png", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
    ]);
    await fs.writeFile(path.join(cwd, "shot.png"), png);

    const result = await readTool.execute({ path: "shot.png" }, { cwd });

    expect(result.isError ?? false).toBe(false);
    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]).toMatchObject({
      mediaType: "image/png",
      data: png.toString("base64"),
    });
  });

  test("rejects a fake png whose bytes are not an image", async () => {
    await fs.writeFile(path.join(cwd, "fake.png"), "<html>not really</html>");

    const result = await readTool.execute({ path: "fake.png" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not a recognized image");
  });

  test("rejects oversized images", async () => {
    const bigPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(6 * 1024 * 1024),
    ]);
    await fs.writeFile(path.join(cwd, "big.png"), bigPng);

    const result = await readTool.execute({ path: "big.png" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("image limit");
  });
});
