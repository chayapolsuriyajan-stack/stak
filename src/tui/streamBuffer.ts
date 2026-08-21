import type { DisplayMessage } from "./types.js";

type StreamingKind = "assistant" | "thinking";

/**
 * Appends streamed text to the transcript, extending a live message of the
 * same kind or starting a new one. A model's turn can stream thinking, then
 * text, in that order — appending a delta of a *different* kind than
 * whatever is currently live finalizes the old one first, so there is never
 * more than one live message at a time. That single-live-tail invariant is
 * what messageLiveness.ts's splitLiveTail relies on to keep the transcript
 * safe for Ink's Static.
 */
export function appendDelta(
  messages: DisplayMessage[],
  kind: StreamingKind,
  text: string,
): DisplayMessage[] {
  const last = messages[messages.length - 1];

  if (last?.kind === kind && last.streaming) {
    return [...messages.slice(0, -1), { ...last, text: last.text + text }];
  }

  const finalized = finalizeStreaming(messages);
  return [...finalized, { kind, text, streaming: true }];
}

/** Flips a live assistant/thinking message to finished, if there is one —
 * the same operation whether it's ending because the turn is over or
 * because a different kind of content is about to start. */
export function finalizeStreaming(messages: DisplayMessage[]): DisplayMessage[] {
  const last = messages[messages.length - 1];
  if ((last?.kind === "assistant" || last?.kind === "thinking") && last.streaming) {
    return [...messages.slice(0, -1), { ...last, streaming: false }];
  }
  return messages;
}
