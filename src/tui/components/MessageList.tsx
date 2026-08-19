import { Box, Static, Text } from "ink";
import type { DisplayMessage } from "../types.js";
import { ACCENT, MUTED } from "../theme.js";

export interface MessageListProps {
  /** Finished messages only — nothing here should change again. Rendered via
   * Ink's Static, which prints each item once to real terminal scrollback
   * and never touches those rows again, instead of re-drawing the whole
   * history on every frame. */
  messages: DisplayMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Static items={messages}>
      {(message, index) => <MessageItem key={index} message={message} />}
    </Static>
  );
}

/** Exported so the live (still-updating) tail message can reuse the same
 * rendering outside of Static. */
export function MessageItem({ message }: { message: DisplayMessage }) {
  switch (message.kind) {
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
            <Text color={MUTED}> {summarize(message.input)}</Text>
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

function summarize(input: unknown): string {
  const json = JSON.stringify(input) ?? "";
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

function firstLines(text: string, limit: number): string {
  const lines = text.split("\n");
  if (lines.length <= limit) return text;
  return `${lines.slice(0, limit).join("\n")}\n… ${lines.length - limit} more lines`;
}
