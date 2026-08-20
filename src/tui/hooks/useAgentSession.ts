import { useCallback, useRef, useState } from "react";
import type { AgentContext } from "../../agent/loop.js";
import { runTurn } from "../../agent/loop.js";
import type { TurnPhase } from "../../agent/types.js";
import type { StatsLine } from "../formatStats.js";
import type { DisplayMessage } from "../types.js";

/**
 * Streaming deltas arrive far faster than the terminal can usefully repaint,
 * so text is buffered and flushed on this interval instead of per token.
 */
const FLUSH_INTERVAL_MS = 33;

export interface LiveTurn {
  stats: StatsLine;
  phase: TurnPhase;
  round: number;
}

export function useAgentSession(
  ctx: AgentContext,
  initialMessages: DisplayMessage[] = [],
) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  // Updated from the loop's "progress" events, which are already throttled
  // at the source (only on phase transitions and round-end reconciliation,
  // not per token) — no extra throttling needed here. Kept after the turn
  // completes rather than cleared, so context usage stays visible at rest
  // instead of vanishing the moment a turn ends.
  const [live, setLive] = useState<LiveTurn | undefined>(undefined);
  const pendingText = useRef("");
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flush = useCallback(() => {
    const text = pendingText.current;
    if (text === "") return;
    pendingText.current = "";

    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.kind === "assistant" && last.streaming) {
        return [
          ...current.slice(0, -1),
          { ...last, text: last.text + text },
        ];
      }
      return [...current, { kind: "assistant", text, streaming: true }];
    });
  }, []);

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
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.kind === "assistant" && last.streaming) {
        return [...current.slice(0, -1), { ...last, streaming: false }];
      }
      return current;
    });
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
              pendingText.current += event.text;
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
                if (index === -1) return current;
                const target = current[index];
                if (target?.kind !== "tool") return current;
                const updated = [...current];
                updated[index] = {
                  ...target,
                  output: event.output,
                  isError: event.isError,
                };
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
              setLive({
                stats: {
                  outputTokens: event.outputTokens,
                  approx: event.approx,
                  latestInputTokens: event.latestInputTokens,
                  generatingMs: event.generatingMs,
                },
                phase: event.phase,
                round: event.round,
              });
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
    [ctx, append, startFlushing, stopFlushing],
  );

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, busy, sendMessage, append, clear, interrupt, live };
}
