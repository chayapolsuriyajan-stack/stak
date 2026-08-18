import { Box, useApp, useInput } from "ink";
import { useState } from "react";
import type { AgentContext } from "../agent/loop.js";
import { MODE_LABELS, type PermissionManager } from "../permissions/manager.js";
import type { PermissionMode } from "../permissions/types.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { Splash } from "./components/Splash.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgentSession } from "./hooks/useAgentSession.js";
import { usePermissionPrompt } from "./hooks/usePermissionPrompt.js";

export interface AppProps {
  ctx: AgentContext;
  permissions: PermissionManager;
  version: string;
}

export function App({ ctx, permissions, version }: AppProps) {
  const { exit } = useApp();
  const { messages, busy, sendMessage, append } = useAgentSession(ctx);
  const { request, decide } = usePermissionPrompt(permissions);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<PermissionMode>(permissions.getMode());

  useInput(
    (_char, key) => {
      // Shift+Tab cycles how much the agent may do without asking.
      if (key.tab && key.shift) {
        void permissions.cycleMode().then((next) => {
          setMode(next);
          append({ kind: "notice", text: `Permission mode: ${next} — ${MODE_LABELS[next]}` });
        });
        return;
      }
      if (key.escape && !busy) exit();
    },
    { isActive: request === null },
  );

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "" || busy) return;
    setInput("");

    if (trimmed === "/exit" || trimmed === "/quit") {
      exit();
      return;
    }

    void sendMessage(trimmed);
  };

  return (
    <Box flexDirection="column">
      {messages.length === 0 ? (
        <Splash version={version} />
      ) : (
        <MessageList messages={messages} />
      )}

      {request ? (
        <PermissionPrompt request={request} onDecide={decide} />
      ) : (
        <InputBox
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={busy}
        />
      )}

      <StatusBar
        provider={ctx.provider.name}
        model={ctx.model}
        busy={busy}
        hint={`enter send · shift+tab ${mode}`}
      />
    </Box>
  );
}
