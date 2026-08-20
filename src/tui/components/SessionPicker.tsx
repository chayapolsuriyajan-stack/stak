import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { SessionSummary } from "../../sessions/resume.js";
import { ACCENT, MUTED } from "../theme.js";

export interface SessionPickerProps {
  sessions: SessionSummary[];
  onSelect: (session: SessionSummary) => void;
  /** Esc backs out to a fresh session instead of resuming one. */
  onCancel: () => void;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps) {
  const [selected, setSelected] = useState(0);

  useInput((char, key) => {
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) {
      setSelected((current) => Math.min(sessions.length - 1, current + 1));
    }
    if (key.return) {
      const session = sessions[selected];
      if (session) onSelect(session);
    }
    if (key.escape) onCancel();

    const asNumber = Number(char);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= sessions.length) {
      const session = sessions[asNumber - 1];
      if (session) onSelect(session);
    }
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={MUTED} paddingX={1}>
        <Text color={MUTED}>No previous sessions in this directory. Starting fresh.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Text color={ACCENT} bold>
        Resume which session?
      </Text>

      <Box flexDirection="column" marginY={1}>
        {sessions.map((session, index) => (
          <Text key={session.sessionId} color={index === selected ? ACCENT : MUTED}>
            {index === selected ? "❯ " : "  "}
            {index + 1}. {formatWhen(session.startedAt)} · {session.messageCount} msgs
            {session.model ? ` · ${session.model}` : ""}
            {"  "}
            {session.preview}
          </Text>
        ))}
      </Box>

      <Text color={MUTED}>enter select · esc start fresh</Text>
    </Box>
  );
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
