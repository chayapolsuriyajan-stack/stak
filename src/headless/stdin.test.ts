import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { MAX_STDIN_BYTES, readPipedStdin } from "./stdin.js";

function fakeTtyStream(): NodeJS.ReadStream {
  const r = Readable.from([]) as unknown as NodeJS.ReadStream;
  (r as unknown as { isTTY: boolean }).isTTY = true;
  return r;
}

function fakePipedStream(chunks: (string | Buffer)[]): NodeJS.ReadStream {
  const r = Readable.from(chunks) as unknown as NodeJS.ReadStream;
  (r as unknown as { isTTY: boolean }).isTTY = false;
  return r;
}

describe("readPipedStdin", () => {
  test("undefined stream -> resolves to undefined", async () => {
    await expect(readPipedStdin(undefined)).resolves.toBeUndefined();
  });

  test("isTTY stream -> resolves to undefined without reading data", async () => {
    const stream = fakeTtyStream();
    let dataEmitted = false;
    stream.on("data", () => {
      dataEmitted = true;
    });
    const result = await readPipedStdin(stream);
    expect(result).toBeUndefined();
    expect(dataEmitted).toBe(false);
  });

  test("small piped input resolves to concatenated string", async () => {
    const stream = fakePipedStream(["hello", " ", "world"]);
    await expect(readPipedStdin(stream)).resolves.toBe("hello world");
  });

  test("isTTY undefined (CI/container/wrapper environments) still attempts a read", async () => {
    // process.stdin.isTTY is `undefined`, not `false`, in many real
    // sandboxed/CI environments — the TTY early-return must not fire just
    // because isTTY is falsy-but-not-strictly-true.
    const r = Readable.from(["piped", " ", "content"]) as unknown as NodeJS.ReadStream;
    (r as unknown as { isTTY: boolean | undefined }).isTTY = undefined;

    await expect(readPipedStdin(r)).resolves.toBe("piped content");
  });

  test("isTTY undefined with genuinely empty piped input resolves to empty string, not undefined", async () => {
    const r = Readable.from([]) as unknown as NodeJS.ReadStream;
    (r as unknown as { isTTY: boolean | undefined }).isTTY = undefined;

    const result = await readPipedStdin(r);
    expect(result).toBe("");
    expect(result).not.toBeUndefined();
  });

  test("input exceeding the byte cap rejects with size-limit error", async () => {
    // Use an injectable low limit so we don't need to build an 11MB string.
    // The error message must reflect this 15-byte maxBytes, not a hardcoded
    // "10 MB" that only matches the default cap.
    const stream = fakePipedStream(["a".repeat(10), "b".repeat(10)]);
    await expect(readPipedStdin(stream, 15)).rejects.toThrow(/15 bytes/);
  });

  test("default MAX_STDIN_BYTES cap is enforced (large input)", async () => {
    expect(MAX_STDIN_BYTES).toBe(10 * 1024 * 1024);
    const bigChunk = Buffer.alloc(MAX_STDIN_BYTES + 1, "x");
    const stream = fakePipedStream([bigChunk]);
    await expect(readPipedStdin(stream)).rejects.toThrow("Piped input exceeds 10 MB.");
  });

  test("stream error event causes rejection, not hang", async () => {
    const emitter = new EventEmitter() as unknown as NodeJS.ReadStream;
    (emitter as unknown as { isTTY: boolean }).isTTY = false;
    (emitter as unknown as { destroy: () => void }).destroy = () => {};

    const promise = readPipedStdin(emitter);
    const boom = new Error("boom");
    emitter.emit("error", boom);

    await expect(promise).rejects.toBe(boom);
  });

  test("multi-byte UTF-8 content decodes correctly across chunk boundaries", async () => {
    const text = "héllo wörld 你好 🎉";
    const buf = Buffer.from(text, "utf8");
    // Split in the middle of a multi-byte sequence to ensure correct decoding
    // only happens because we concat buffers before decoding, not per-chunk.
    const mid = Math.floor(buf.length / 2);
    const chunk1 = buf.subarray(0, mid);
    const chunk2 = buf.subarray(mid);
    const stream = fakePipedStream([chunk1, chunk2]);
    await expect(readPipedStdin(stream)).resolves.toBe(text);
  });
});
