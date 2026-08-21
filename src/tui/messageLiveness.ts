import type { DisplayMessage } from "./types.js";

/**
 * True while a message can still change — a streaming assistant reply, or a
 * tool call still waiting on its result. Only the trailing message in the
 * transcript can ever be live: useAgentSession finalizes (stops streaming,
 * fills in a tool's output) whatever was previously live before it appends
 * anything new, so an earlier message is never revisited once superseded.
 *
 * This distinction is what lets the transcript use Ink's Static component —
 * everything that isn't live gets printed once to real terminal scrollback
 * and never touches those rows again, instead of Ink erasing and redrawing
 * the entire history on every streamed token or keystroke.
 */
export function isLive(message: DisplayMessage): boolean {
  return (
    (message.kind === "assistant" && message.streaming === true) ||
    (message.kind === "thinking" && message.streaming === true) ||
    (message.kind === "tool" && message.output === undefined)
  );
}

/** Splits a transcript into the part safe for Static and the live tail, if
 * there is one. */
export function splitLiveTail(messages: DisplayMessage[]): {
  committed: DisplayMessage[];
  liveTail: DisplayMessage | undefined;
} {
  const last = messages[messages.length - 1];
  const liveTail = last && isLive(last) ? last : undefined;
  return { committed: liveTail ? messages.slice(0, -1) : messages, liveTail };
}
