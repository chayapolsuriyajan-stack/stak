import { Box, useApp, useInput } from "ink";
import { useState } from "react";
import type { AgentContext } from "../agent/loop.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList } from "./components/MessageList.js";
import { Splash } from "./components/Splash.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgentSession } from "./hooks/useAgentSession.js";

export interface AppProps {
  ctx: AgentContext;
  version: string;
}

export function App({ ctx, version }: AppProps) {
  const { exit } = useApp();
  const { messages, busy, sendMessage } = useAgentSession(ctx);
  const [input, setInput] = useState("");

  useInput((_char, key) => {
    if (key.escape && !busy) exit();
  });

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

      <InputBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={busy}
      />

      <StatusBar provider={ctx.provider.name} model={ctx.model} busy={busy} />
    </Box>
  );
}
