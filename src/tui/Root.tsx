import { useState } from "react";
import type { SessionSummary } from "../sessions/resume.js";
import { App, type AppProps } from "./App.js";
import { SessionPicker } from "./components/SessionPicker.js";
import type { DisplayMessage } from "./types.js";

export interface RootProps extends Omit<AppProps, "initialMessages"> {
  /** "picker" shows the session list first; "direct" goes straight to chat
   * (a fresh session, or one already resolved via --continue/--resume <id>). */
  mode: "picker" | "direct";
  sessions: SessionSummary[];
  initialMessages: DisplayMessage[];
  /** Loads the chosen session's full history and points persistence at its
   * file, returning the transcript to display. */
  onResumeSession: (session: SessionSummary) => Promise<DisplayMessage[]>;
}

/**
 * Sits in front of App so --resume with no id can show a picker before the
 * chat UI exists, then hands off to the same App used for every other mode.
 */
export function Root({
  mode,
  sessions,
  initialMessages,
  onResumeSession,
  onNewSession,
  ...appProps
}: RootProps) {
  const [stage, setStage] = useState<"picker" | "chat">(
    mode === "picker" ? "picker" : "chat",
  );
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);

  if (stage === "picker") {
    return (
      <SessionPicker
        sessions={sessions}
        onSelect={(session) => {
          void onResumeSession(session).then((resolved) => {
            setMessages(resolved);
            setStage("chat");
          });
        }}
        onCancel={() => {
          onNewSession?.();
          setStage("chat");
        }}
      />
    );
  }

  return <App {...appProps} onNewSession={onNewSession} initialMessages={messages} />;
}
