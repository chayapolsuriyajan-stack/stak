import { useCallback, useRef, useState } from "react";
import { compactHistory } from "../../agent/compact.js";
import type { CompactResult } from "../../agent/compact.js";
import type { AgentContext } from "../../agent/loop.js";
import { runTurn } from "../../agent/loop.js";
import type { TurnPhase } from "../../agent/types.js";
import type { StatsLine } from "../formatStats.js";
import { appendDelta, finalizeStreaming } from "../streamBuffer.js";
import type { DisplayMessage } from "../types.js";

/**
 * Streaming deltas arrive far faster than the terminal can usefully repaint,
 * so text is buffered and flushed on this interval instead of per token.
 * 33ms (~30Hz) used to flicker visibly on Windows terminals — Ink redraws
 * the whole dynamic region (live message + status bar) on every flush, and
 * that many full rewrites a second is more than those terminals repaint
 * cleanly. 60ms (~16Hz) is still smooth for a chat reveal but cuts the
 * redraw rate roughly in half.
 */
const FLUSH_INTERVAL_MS = 60;

export interface LiveTurn {
  stats: StatsLine;
  phase: TurnPhase;
  round: number;
}

type StreamingKind = "assistant" | "thinking";

export function useAgentSession(
  ctx: AgentContext,
  initialMessages: DisplayMessage[] = [],
) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  // Updated from the loop's "progress" events via the same buffer/flush
  // tick as streaming text (see pendingLive below), so a progress update
  // never causes an extra repaint on top of the text flush. Kept after the
  // turn completes rather than cleared, so context usage stays visible at
  // rest instead of vanishing the moment a turn ends.
  const [live, setLive] = useState<LiveTurn | undefined>(undefined);
  // Both channels share one buffer rather than two, so the buffer only ever
  // holds one kind's text at a time — switching kinds flushes immediately
  // (see switchTo below) instead of risking both being non-empty at once
  // when the flush timer happens to land on a thinking/text boundary.
  const pendingKind = useRef<StreamingKind | null>(null);
  const pendingText = useRef("");
  // "progress" events (tok/s, phase, context usage) used to call setLive
  // directly and immediately, outside this buffer entirely — landing as a
  // second, unbatched re-render at some arbitrary offset from the flush
  // tick below, on top of the one that tick already causes. Buffering it
  // here and applying it in the same call as the text flush lets React
  // batch both state updates into one repaint per tick instead of two.
  const pendingLive = useRef<LiveTurn | undefined>(undefined);
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flush = useCallback(() => {
    const kind = pendingKind.current;
    const text = pendingText.current;
    if (kind !== null && text !== "") {
      pendingText.current = "";
      setMessages((current) => appendDelta(current, kind, text));
    }

    const nextLive = pendingLive.current;
    if (nextLive !== undefined) {
      pendingLive.current = undefined;
      setLive(nextLive);
    }
  }, []);

  /** Buffers a delta, flushing first if a different kind was mid-buffer —
   * appendDelta itself would finalize the old one regardless, but flushing
   * eagerly here keeps the two channels from ever needing to be
   * reconciled inside a single buffered string. */
  const bufferDelta = useCallback(
    (kind: StreamingKind, text: string) => {
      if (pendingKind.current !== null && pendingKind.current !== kind) {
        flush();
      }
      pendingKind.current = kind;
      pendingText.current += text;
    },
    [flush],
  );

  const startFlushing = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setInterval(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const stopFlushing = useCallback(() => {
    if (flushTimer.current) {
      clearInterval(flushTimer.current);
      flushTimer.current = null;
    }
    flush();
    pendingKind.current = null;
    setMessages((current) => finalizeStreaming(current));
  }, [flush]);

  const append = useCallback((message: DisplayMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const clear = useCallback(() => {
    ctx.history.length = 0;
    setMessages([]);
    setLive(undefined);
  }, [ctx]);

  const sendMessage = useCallback(
    async (input: string) => {
      append({ kind: "user", text: input });
      setBusy(true);
      startFlushing();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        for await (const event of runTurn(ctx, input, { signal: controller.signal })) {
          switch (event.type) {
            case "text-delta":
              bufferDelta("assistant", event.text);
              break;

            case "thinking-delta":
              bufferDelta("thinking", event.text);
              break;

            case "tool-call-start":
              stopFlushing();
              append({ kind: "tool", name: event.name, input: event.input });
              startFlushing();
              break;

            case "tool-call-result":
              setMessages((current) => {
                const index = current.findLastIndex(
                  (m) => m.kind === "tool" && m.output === undefined,
                );
                const updated = [...current];
                if (index !== -1) {
                  const target = current[index];
                  if (target?.kind === "tool") {
                    updated[index] = {
                      ...target,
                      output: event.output,
                      isError: event.isError,
                    };
                  }
                }
                // afterTool hook stderr — display-only context the user
                // should see, but the model must not (it rides outside the
                // tool_result block on purpose).
                for (const notice of event.notices ?? []) {
                  updated.push({ kind: "notice", text: notice });
                }
                // Image metadata only — pixels never reach the transcript.
                for (const image of event.images ?? []) {
                  updated.push({
                    kind: "notice",
                    text: `[image ${image.sourcePath}]`,
                  });
                }
                return updated;
              });
              break;

            case "error":
              stopFlushing();
              append({ kind: "error", text: event.error.message });
              startFlushing();
              break;

            case "interrupted":
              stopFlushing();
              append({ kind: "notice", text: "Interrupted." });
              startFlushing();
              break;

            case "truncated":
              stopFlushing();
              append({
                kind: "notice",
                text: "⚠ Response cut off — hit the context/output limit. Ask it to continue, or raise num_ctx in the Modelfile.",
              });
              startFlushing();
              break;

            case "progress":
              pendingLive.current = {
                stats: {
                  outputTokens: event.outputTokens,
                  approx: event.approx,
                  latestInputTokens: event.latestInputTokens,
                  generatingMs: event.generatingMs,
                },
                phase: event.phase,
                round: event.round,
              };
              break;

            case "usage":
              // The final progress event (round-end reconciliation of the
              // last round) already carries these fully authoritative
              // totals, so there's nothing further to merge in here beyond
              // what "progress" already set.
              break;

            case "turn-complete":
              break;
          }
        }
      } finally {
        stopFlushing();
        abortRef.current = null;
        setBusy(false);
      }
    },
    [ctx, append, startFlushing, stopFlushing, bufferDelta],
  );

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const compact = useCallback(
    async (focus?: string): Promise<CompactResult> => {
      if (busy) {
        throw new Error("Can't compact while a turn is in progress.");
      }
      setBusy(true);
      try {
        return await compactHistory(ctx, { focus });
      } finally {
        // Stale — history just shrank (or the attempt failed), and the next
        // real turn's "progress" events will produce fresh stats. Left set,
        // this could otherwise make an auto-compaction check re-fire
        // immediately on old numbers — including after a failed attempt,
        // which would otherwise re-arm and re-fire on every subsequent turn.
        setLive(undefined);
        setBusy(false);
      }
    },
    [ctx, busy],
  );

  return { messages, busy, sendMessage, append, clear, interrupt, live, compact };
}
