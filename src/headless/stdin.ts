export const MAX_STDIN_BYTES = 10 * 1024 * 1024;

/** Renders a byte cap as a whole-MB figure when it divides cleanly, else exact bytes. */
function formatMaxBytes(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${maxBytes} bytes`;
}

export async function readPipedStdin(
  stream?: NodeJS.ReadStream,
  maxBytes: number = MAX_STDIN_BYTES,
): Promise<string | undefined> {
  if (!stream || stream.isTTY) {
    return undefined;
  }

  return new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        cleanup();
        stream.destroy();
        settle(() => reject(new Error(`Piped input exceeds ${formatMaxBytes(maxBytes)}.`)));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      cleanup();
      settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    };

    const onError = (err: Error) => {
      cleanup();
      settle(() => reject(err));
    };

    function cleanup() {
      stream!.off("data", onData);
      stream!.off("end", onEnd);
      stream!.off("error", onError);
    }

    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      action();
    }

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
