const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export interface ThinkTagChunk {
  thinking: string;
  text: string;
}

export interface ThinkTagSplitter {
  /** Feed the next raw content chunk; returns what should be routed to each
   * output channel for this call. Safe to call with an empty string. */
  push(chunk: string): ThinkTagChunk;
  /**
   * Flushes whatever is still held back once the stream ends. push() already
   * releases content as soon as it's unambiguous — including an unclosed
   * `<think>`'s contents, which stream out immediately as thinking rather
   * than waiting for a closing tag that may never come — so end() only ever
   * has a few characters to return: a genuine partial-tag match (e.g.
   * `</thi`) that never resolved because the stream stopped first.
   */
  end(): ThinkTagChunk;
}

/**
 * Splits `<think>...</think>` out of a raw content stream as it arrives,
 * for models (Qwen among them) that inline reasoning in-band rather than
 * using a provider's native thinking field. A near-zero-cost passthrough
 * when no tags are present, which is the common case — every push() does a
 * single indexOf scan and nothing more unless a tag is actually found.
 */
export function createThinkTagSplitter(): ThinkTagSplitter {
  let buffer = "";
  let inThinking = false;

  function drain(): ThinkTagChunk {
    let thinking = "";
    let text = "";

    for (;;) {
      const tag = inThinking ? CLOSE_TAG : OPEN_TAG;
      const index = buffer.indexOf(tag);

      if (index !== -1) {
        const before = buffer.slice(0, index);
        if (inThinking) thinking += before;
        else text += before;
        buffer = buffer.slice(index + tag.length);
        inThinking = !inThinking;
        continue; // more tags may be waiting later in the same buffer
      }

      // No complete tag in the buffer. Hold back a suffix that could still
      // become one once more chunks arrive (e.g. "<thi" awaiting "nk>") —
      // everything before that point is safe to release now.
      const holdLen = partialTagSuffixLength(buffer, tag);
      const safe = buffer.slice(0, buffer.length - holdLen);
      if (inThinking) thinking += safe;
      else text += safe;
      buffer = buffer.slice(buffer.length - holdLen);
      return { thinking, text };
    }
  }

  return {
    push(chunk: string): ThinkTagChunk {
      buffer += chunk;
      return drain();
    },
    end(): ThinkTagChunk {
      const remainder = buffer;
      buffer = "";
      return inThinking ? { thinking: remainder, text: "" } : { thinking: "", text: remainder };
    },
  };
}

/** The length of the longest suffix of `buffer` that is also a proper
 * (non-full) prefix of `tag` — how much must be held back because it could
 * still turn into `tag` once more input arrives. */
function partialTagSuffixLength(buffer: string, tag: string): number {
  const maxLen = Math.min(buffer.length, tag.length - 1);
  for (let len = maxLen; len > 0; len--) {
    if (buffer.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
