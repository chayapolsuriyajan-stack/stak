import { Box, useApp, useInput } from "ink";
import { useState } from "react";
import type { AgentContext } from "../agent/loop.js";
import type { CommandRegistry } from "../commands/dispatch.js";
import { isCommand } from "../commands/dispatch.js";
import type { CommandOutcome } from "../commands/types.js";
import { MODE_LABELS, type PermissionManager } from "../permissions/manager.js";
import type { PermissionMode } from "../permissions/types.js";
import { InputBox } from "./components/InputBox.js";
import { MessageItem, MessageList } from "./components/MessageList.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { Splash } from "./components/Splash.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { usePermissionPrompt } from "./hooks/usePermissionPrompt.js";
import { splitLiveTail } from "./messageLiveness.js";
import { extractNumberedChoices, resolveNumberedReply } from "./numberedChoices.js";
import type { DisplayMessage } from "./types.js";

export interface AppProps {
  ctx: AgentContext;
  permissions: PermissionManager;
  commands: CommandRegistry;
  version: string;
  /** Transcript rebuilt from a resumed session, empty for a new one. */
  initialMessages?: DisplayMessage[];
  /** Starts a new session file, used by /clear. */
  onNewSession?: () => void;
}

export function App({
  ctx,
  permissions,
  commands,
  version,
  initialMessages,
  onNewSession,
}: AppProps) {
  const { exit } = useApp();
  const { messages, busy, sendMessage, append, clear, interrupt, usage } = useAgentSession(
    ctx,
    initialMessages,
  );
  const { request, decide } = usePermissionPrompt(permissions);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<PermissionMode>(permissions.getMode());
  const [model, setModel] = useState(ctx.model);

  useInput(
    (_char, key) => {
      // Shift+Tab cycles how much the agent may do without asking.
      if (key.tab && key.shift) {
        void permissions.cycleMode().then((next) => {
          setMode(next);
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
    },
    { isActive: request === null },
  );

  const runCommand = async (raw: string) => {
    let outcome: CommandOutcome;
    try {
      outcome = await commands.run(raw, {
        clear: () => {
          clear();
          // A cleared conversation is a new session, not a gap in the old one.
          onNewSession?.();
        },
        getPermissionMode: () => permissions.getMode(),
        setPermissionMode: async (next) => {
          await permissions.setMode(next as PermissionMode);
          setMode(permissions.getMode());
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
  // whole history re-drawing every frame.
  const { committed, liveTail } = splitLiveTail(messages);

  return (
    <Box flexDirection="column">
      {messages.length === 0 ? (
        <Splash version={version} />
      ) : (
        <>
          <MessageList messages={committed} />
          {liveTail && <MessageItem message={liveTail} />}
        </>
      )}

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
        usage={usage}
      />
    </Box>
  );
}
