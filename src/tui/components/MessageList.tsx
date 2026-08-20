import { Box, Static, Text } from "ink";
import type { TranscriptItem } from "../types.js";
import { ACCENT, MUTED } from "../theme.js";
import { summarizeToolCall } from "../toolSummary.js";
import { Splash } from "./Splash.js";

export interface MessageListProps {
  /** Finished items only — nothing here should change again. Rendered via
   * Ink's Static, which prints each item once to real terminal scrollback
   * and never touches those rows again, instead of re-drawing the whole
   * history on every frame. The banner is always index 0. */
  items: TranscriptItem[];
}

export function MessageList({ items }: MessageListProps) {
  return (
    <Static items={items}>
      {(item, index) => <MessageItem key={index} message={item} />}
    </Static>
  );
}

/** Exported so the live (still-updating) tail message can reuse the same
 * rendering outside of Static. The live tail is always a DisplayMessage —
 * the banner never streams — but this accepts the wider type since callers
 * pass items straight from the same array. */
export function MessageItem({ message }: { message: TranscriptItem }) {
  switch (message.kind) {
    case "banner":
      return (
        <Splash
          version={message.version}
          cwd={message.cwd}
          provider={message.provider}
          model={message.model}
        />
      );

    case "user":
      return (
        <Box marginBottom={1}>
          <Text color={ACCENT} bold>
            {"> "}
          </Text>
          <Text>{message.text}</Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginBottom={1}>
          <Text>{message.text}</Text>
        </Box>
      );

    case "tool":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan">
            {"  ⚒ "}
            {message.name}
            <Text color={MUTED}>({summarizeToolCall(message.name, message.input)})</Text>
          </Text>
          {message.output !== undefined && (
            <Text color={message.isError ? "red" : MUTED}>
              {"    "}
              {firstLines(message.output, 6)}
            </Text>
          )}
        </Box>
      );

    case "notice":
      return (
        <Box marginBottom={1}>
          <Text color={MUTED}>{message.text}</Text>
        </Box>
      );

    case "error":
      return (
        <Box marginBottom={1}>
          <Text color="red">{message.text}</Text>
        </Box>
      );
  }
}

function firstLines(text: string, limit: number): string {
  const lines = text.split("\n");
  if (lines.length <= limit) return text;
  return `${lines.slice(0, limit).join("\n")}\n… ${lines.length - limit} more lines`;
}
