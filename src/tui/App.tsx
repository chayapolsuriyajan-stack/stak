import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_KEEP_RECENT, describeCompaction, shouldAutoCompact } from "../agent/compact.js";
import type { AgentContext } from "../agent/loop.js";
import type { ModelInfoCache } from "../agent/modelInfo.js";
import type { Message } from "../agent/types.js";
import type { CommandRegistry } from "../commands/dispatch.js";
import { isCommand } from "../commands/dispatch.js";
import type { CommandOutcome } from "../commands/types.js";
import type { McpServerStatus } from "../mcp/types.js";
import { MODE_LABELS, type PermissionManager } from "../permissions/manager.js";
import type { PermissionMode } from "../permissions/types.js";
import { InputBox } from "./components/InputBox.js";
import { MessageItem, MessageList } from "./components/MessageList.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { usePermissionPrompt } from "./hooks/usePermissionPrompt.js";
import { splitLiveTail } from "./messageLiveness.js";
import { extractNumberedChoices, resolveNumberedReply } from "./numberedChoices.js";
import type { DisplayMessage, TranscriptItem } from "./types.js";

export interface AppProps {
  ctx: AgentContext;
  permissions: PermissionManager;
  commands: CommandRegistry;
  version: string;
  /** Working directory, shown in the banner. */
  cwd: string;
  /** Transcript rebuilt from a resumed session, empty for a new one. */
  initialMessages?: DisplayMessage[];
  /** Starts a new session file, used by /clear. */
  onNewSession?: () => void;
  /** Rebuilds the system prompt for a given plan-mode state, so entering or
   * leaving plan mode keeps the model's instructions in sync with what the
   * tools will actually let it do. */
  systemPromptFor?: (planMode: boolean) => string;
  /** Shared across the process so a repeated /model switch back to a
   * previously-seen model doesn't re-query the provider. */
  modelInfoCache?: ModelInfoCache;
  /** Status of configured MCP servers, surfaced by /mcp. */
  mcpServers?: McpServerStatus[];
  /** Whether auto-compaction runs when context usage crosses the threshold.
   * Defaults to true when undefined. */
  autoCompact?: boolean;
  /** Fraction of the model's context window that triggers auto-compaction.
   * Defaults to shouldAutoCompact's own 0.85 when undefined. */
  autoCompactThreshold?: number;
  /** Called after any compaction (manual or automatic) with the resulting
   * history, e.g. so the caller can persist it. */
  onCompacted?: (history: Message[]) => void;
}

export function App({
  ctx,
  permissions,
  commands,
  version,
  cwd,
  initialMessages,
  onNewSession,
  systemPromptFor,
  modelInfoCache,
  mcpServers,
  autoCompact,
  autoCompactThreshold,
  onCompacted,
}: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { messages, busy, sendMessage, append, clear, interrupt, live, compact } =
    useAgentSession(ctx, initialMessages);
  const { request, decide } = usePermissionPrompt(permissions);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<PermissionMode>(permissions.getMode());
  const [model, setModel] = useState(ctx.model);
  const [contextLength, setContextLength] = useState<number | undefined>(undefined);
  // Applies to new output only, per design: Ink's Static never repaints
  // already-printed scrollback, so toggling this cannot retroactively
  // reveal or hide a thinking block that already printed as a breadcrumb.
  const [showThinking, setShowThinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Fire-and-forget: modelInfo() already fails soft to {}, and the bar
    // simply omits the context segment until (or unless) this resolves —
    // it must never delay the first prompt.
    void modelInfoCache?.get(ctx.provider, model).then((info) => {
      if (!cancelled) setContextLength(info.contextLength);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx.provider, model, modelInfoCache]);
  // Bumped on /clear and remounted onto <MessageList>'s key so Ink's Static
  // resets its printed-count and the banner reprints on a genuinely blank
  // screen, instead of staying stuck at 1 item forever with the old
  // transcript still sitting above it in scrollback.
  const [epoch, setEpoch] = useState(0);

  const applyMode = (next: PermissionMode) => {
    setMode(next);
    ctx.systemPrompt = systemPromptFor?.(next === "plan") ?? ctx.systemPrompt;
  };

  const autoCompactingRef = useRef(false);

  /** Runs a compaction and reports the outcome to the transcript. Used both
   * for the auto-compaction effect below and could be used for a manual
   * trigger — must never throw, since it's fired both from an effect and
   * fire-and-forget call sites. */
  const runCompact = async (
    focus: string | undefined,
    reason: "manual" | "auto",
  ): Promise<void> => {
    try {
      const result = await compact(focus);
      onCompacted?.(ctx.history);
      append({
        kind: "notice",
        text:
          reason === "auto"
            ? "Auto-compacted. " + describeCompaction(result)
            : describeCompaction(result),
      });
    } catch (error) {
      append({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Auto-compaction: once context usage crosses the threshold, compact
  // proactively rather than letting the next turn fail on an over-limit
  // request. Skipped while busy (a turn or an existing compaction is in
  // flight) and guarded by autoCompactingRef so a re-render before the
  // in-flight compaction clears `live` can't fire a second one concurrently.
  useEffect(() => {
    if (busy) return;
    if (autoCompactingRef.current) return;
    const trigger = shouldAutoCompact({
      inputTokens: live?.stats.latestInputTokens ?? 0,
      contextLength,
      ...(autoCompactThreshold !== undefined ? { threshold: autoCompactThreshold } : {}),
    });
    if (!trigger || autoCompact === false) return;
    // Cheap pre-check: a history this short has nothing for
    // splitForCompaction to move into `older` (see compact.ts), so
    // compactHistory would just throw "Nothing to compact yet". Skipping the
    // attempt here avoids wasting a round trip and, combined with the
    // finally-based setLive(undefined) in useAgentSession, means a
    // known-too-short history never even gets a chance to leave `live` set
    // and re-trigger this effect on the next turn.
    if (ctx.history.length <= DEFAULT_KEEP_RECENT) return;

    autoCompactingRef.current = true;
    void runCompact(undefined, "auto").finally(() => {
      autoCompactingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, live, contextLength, autoCompact, autoCompactThreshold]);

  useInput(
    (char, key) => {
      // Shift+Tab cycles how much the agent may do without asking.
      if (key.tab && key.shift) {
        void permissions.cycleMode().then((next) => {
          applyMode(next);
          append({
            kind: "notice",
            text: `Permission mode: ${next} — ${MODE_LABELS[next]}`,
          });
        });
        return;
      }
      if (key.escape) {
        // Escape stops work in progress; when there is none, it leaves.
        if (busy) interrupt();
        else exit();
      }
      // Ctrl+O toggles thinking display, matching Claude Code's binding.
      if (key.ctrl && char === "o") {
        setShowThinking((current) => !current);
      }
    },
    { isActive: request === null },
  );

  const runCommand = async (raw: string) => {
    let outcome: CommandOutcome;
    try {
      outcome = await commands.run(raw, {
        clear: () => {
          clear();
          // A cleared conversation is a new session, not a gap in the old
          // one — reset the real terminal too, since otherwise the old
          // transcript stays sitting in scrollback above a banner that
          // silently didn't reprint (Static only ever grows).
          stdout?.write("\x1B[2J\x1B[3J\x1B[H");
          setEpoch((current) => current + 1);
          onNewSession?.();
        },
        getPermissionMode: () => permissions.getMode(),
        setPermissionMode: async (next) => {
          await permissions.setMode(next as PermissionMode);
          applyMode(permissions.getMode());
          return permissions.getMode();
        },
        setModel: (next) => {
          // The loop reads ctx.model per request, so mutating it takes effect
          // on the next turn without rebuilding the session.
          ctx.model = next;
          setModel(next);
        },
        getModel: () => ctx.model,
        describeModel: () => `${ctx.provider.name} ${ctx.model}`,
        listModels: async () => {
          // A live API call (Anthropic/OpenAI) can fail on a bad key or a
          // network hiccup; that should read as "can't list" plus a visible
          // reason, not crash the session with an unhandled rejection.
          try {
            return await ctx.provider.listModels?.();
          } catch (error) {
            append({
              kind: "error",
              text: `Couldn't list models: ${error instanceof Error ? error.message : String(error)}`,
            });
            return undefined;
          }
        },
        listMcpServers: () => mcpServers ?? [],
        compact: async (focus) => {
          const result = await compact(focus);
          onCompacted?.(ctx.history);
          return result;
        },
      });
    } catch (error) {
      // A command that throws for any other reason should not take the whole
      // session down with it.
      append({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    switch (outcome.kind) {
      case "exit":
        exit();
        break;
      case "notice":
        append({ kind: "notice", text: outcome.text });
        break;
      case "error":
        append({ kind: "error", text: outcome.text });
        break;
      case "prompt":
        await sendMessage(outcome.text);
        break;
      case "handled":
        break;
    }
  };

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "" || busy) return;
    setInput("");

    if (isCommand(trimmed)) {
      void runCommand(trimmed);
      return;
    }

    // A bare "2" after the model offers a numbered list answers that list,
    // rather than being sent to the model as the literal text "2".
    const lastAssistant = [...messages].reverse().find((m) => m.kind === "assistant");
    const choices =
      lastAssistant?.kind === "assistant"
        ? extractNumberedChoices(lastAssistant.text)
        : undefined;
    const resolved = resolveNumberedReply(trimmed, choices);

    void sendMessage(resolved ?? trimmed);
  };

  // Everything but a possible live tail goes to Static, which prints once
  // and leaves real terminal scrollback alone from then on, instead of the
  // whole history re-drawing every frame. The banner leads the same Static
  // stream (Claude-Code-style: printed once, then scrolls away as the
  // transcript grows below it) rather than being a conditionally-rendered
  // screen that vanishes on the first message.
  const { committed, liveTail } = splitLiveTail(messages);
  const items: TranscriptItem[] = [
    { kind: "banner", version, cwd, provider: ctx.provider.name, model },
    ...committed,
  ];

  return (
    <Box flexDirection="column">
      <MessageList key={epoch} items={items} showThinking={showThinking} />
      {liveTail && <MessageItem message={liveTail} showThinking={showThinking} />}

      {request ? (
        <PermissionPrompt request={request} onDecide={decide} />
      ) : (
        <InputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={busy}
          commands={commands.suggestions()}
        />
      )}

      <StatusBar
        provider={ctx.provider.name}
        model={model}
        busy={busy}
        hint={`enter send · shift+tab ${mode}`}
        stats={live?.stats}
        contextLength={contextLength}
        phase={live?.phase}
        round={live?.round}
      />
    </Box>
  );
}
