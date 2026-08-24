import fs from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { extractVideoFrames } from "./video.js";

const DUMMY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);

function fakeShell(script: {
  duration?: string;
  failWith?: string;
}) {
  return async (
    command: string,
    args: string[],
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
    if (command === "ffprobe") {
      if (script.duration === undefined) {
        return { exitCode: 1, stdout: "", stderr: "ffprobe failed" };
      }
      return { exitCode: 0, stdout: script.duration, stderr: "" };
    }
    if (script.failWith !== undefined) {
      return { exitCode: 1, stdout: "", stderr: script.failWith };
    }
    // Emulate ffmpeg producing its output file — the last argument.
    await fs.writeFile(args[args.length - 1] as string, DUMMY_JPEG);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

describe("extractVideoFrames", () => {
  test("samples evenly across a known duration", async () => {
    const seeks: number[] = [];
    const shell = async (command: string, args: string[]) => {
      if (command === "ffprobe") return { exitCode: 0, stdout: "10.0\n", stderr: "" };
      if (command === "ffmpeg") {
        const ss = args[args.indexOf("-ss") + 1];
        if (ss !== undefined) seeks.push(Number.parseFloat(ss));
        await fs.writeFile(args[args.length - 1] as string, DUMMY_JPEG);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await extractVideoFrames("clip.mp4", 4, shell);

    expect(result.frames).toHaveLength(4);
    expect(seeks).toEqual([0, 2.5, 5.0, 7.5]);
    expect(result.note).toContain("10.0s");
  });

  test("falls back to start-anchored sampling without ffprobe", async () => {
    const result = await extractVideoFrames("clip.webm", 2, fakeShell({}));

    expect(result.frames).toHaveLength(2);
    expect(result.note).toContain("ffprobe unavailable");
  });

  test("surfaces a friendly message when ffmpeg is missing", async () => {
    const shell = fakeShell({ duration: "5", failWith: "ffmpeg: not recognized" });
    await expect(extractVideoFrames("clip.mov", 8, shell)).rejects.toThrow(
      /ffmpeg is not installed/i,
    );
  });
});
