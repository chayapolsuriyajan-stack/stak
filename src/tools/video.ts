import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

const DEFAULT_MAX_FRAMES = 8;
const FALLBACK_FPS = 2;

export interface VideoFrameResult {
  frames: { mediaType: "image/jpeg"; data: string; sourcePath: string }[];
  /** Human-readable context, e.g. how the frames were sampled. */
  note: string;
}

export interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

type Shell = (
  command: string,
  args: string[],
) => Promise<ShellResult>;

/** Default runner: real ffmpeg/ffprobe via shell so Windows PATH resolution
 * (ffmpeg.exe) works without hand-rolling .cmd normalization here. */
const defaultShell: Shell = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(`${command} ${args.map(quoteArg).join(" ")}`, {
      shell: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (error) =>
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}` }),
    );
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });

function quoteArg(arg: string): string {
  return arg.includes(" ") ? `"${arg}"` : arg;
}

/**
 * Samples up to maxFrames evenly spaced JPEG frames from a video using
 * ffmpeg. Duration comes from ffprobe; when ffprobe is unavailable, falls
 * back to fps-based sampling from the start of the file (noted honestly).
 * Frames land in OS temp — never the project directory.
 */
export async function extractVideoFrames(
  videoPath: string,
  maxFrames: number = DEFAULT_MAX_FRAMES,
  shell: Shell = defaultShell,
): Promise<VideoFrameResult> {
  const dir = path.join(os.tmpdir(), `stak-video-${nanoid(8)}`);
  await fs.mkdir(dir, { recursive: true });

  try {
    const duration = await probeDuration(videoPath, shell);
    const count = Math.max(1, Math.min(maxFrames, 8));
    const frames: VideoFrameResult["frames"] = [];

    for (let index = 0; index < count; index++) {
      // Even spacing with a small inset so frame 0 isn't a black lead-in.
      const seek =
        duration !== undefined
          ? Math.max(0, (duration * index) / count)
          : index / FALLBACK_FPS;

      const out = path.join(dir, `frame-${String(index).padStart(2, "0")}.jpg`);
      const result = await shell("ffmpeg", [
        "-y",
        "-ss",
        seek.toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "5",
        out,
      ]);
      if (result.exitCode !== 0 && result.exitCode !== null) {
        throw new Error(
          `ffmpeg failed (${describeFfmpegProblem(result.stderr)})`,
        );
      }
      try {
        const buf = await fs.readFile(out);
        frames.push({ mediaType: "image/jpeg", data: buf.toString("base64"), sourcePath: videoPath });
      } catch {
        // Seek past EOF yields no file; skip rather than fail the batch.
      }
    }

    if (frames.length === 0) {
      throw new Error("ffmpeg produced no decodable frames — is this a valid video file?");
    }

    const note =
      duration !== undefined
        ? `Sampled ${frames.length} frame(s) at even intervals across ${duration.toFixed(1)}s of ${path.basename(videoPath)}.`
        : `ffprobe unavailable — sampled ${frames.length} frame(s) from the beginning of ${path.basename(videoPath)} at ~${FALLBACK_FPS}s intervals.`;

    return { frames, note };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeDuration(
  videoPath: string,
  shell: Shell,
): Promise<number | undefined> {
  const probe = await shell("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  if (probe.exitCode !== 0 || probe.exitCode === null) return undefined;
  const parsed = Number.parseFloat(probe.stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function describeFfmpegProblem(stderr: string): string {
  if (/ffmpeg.*(not recognized|not found|no such file)/i.test(stderr)) {
    return "ffmpeg is not installed or not on PATH — install it to read video files";
  }
  const meaningful = stderr
    .split("\n")
    .filter((line) => /error|invalid|corrupt/i.test(line))
    .slice(-1)[0];
  return meaningful?.trim() ?? "unknown ffmpeg error";
}
