import { useCallback, useRef, useState } from "react";
import type { AgentContext } from "../../agent/loop.js";
import { runTurn } from "../../agent/loop.js";
import type { DisplayMessage } from "../types.js";

/**
 * Streaming deltas arrive far faster than the terminal can usefully repaint,
 * so text is buffered and flushed on this interval instead of per token.
 */
const FLUSH_INTERVAL_MS = 33;

export function useAgentSession(
  ctx: AgentContext,
  initialMessages: DisplayMessage[] = [],
) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [busy, setBusy] = useState(false);
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

  return { messages, busy, sendMessage, append, clear, interrupt };
}
