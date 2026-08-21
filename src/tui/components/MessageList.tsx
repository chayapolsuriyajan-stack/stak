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
  /** Whether thinking blocks render in full (dimmed) or collapsed to a
   * one-line breadcrumb. Applies to whatever is about to print — a thinking
   * block already sitting in Static keeps whatever it was printed with,
   * since Ink never repaints committed scrollback either way. */
  showThinking?: boolean;
}

export function MessageList({ items, showThinking = false }: MessageListProps) {
  return (
    <Static items={items}>
      {(item, index) => (
        <MessageItem key={index} message={item} showThinking={showThinking} />
      )}
    </Static>
  );
}

export interface MessageItemProps {
  /** The live (still-updating) tail message reuses this outside of Static;
   * the wider TranscriptItem type covers the banner, which never streams. */
  message: TranscriptItem;
  showThinking?: boolean;
}

export function MessageItem({ message, showThinking = false }: MessageItemProps) {
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

    case "thinking":
      return (
        <Box marginBottom={1}>
          <Text color={MUTED}>
            {showThinking ? message.text : thinkingBreadcrumb(message)}
          </Text>
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

function thinkingBreadcrumb(message: { text: string; streaming?: boolean }): string {
  if (message.streaming) return "✻ Thinking…";
  const n = message.text.split("\n").length;
  return `✻ Thought for ${n} line${n === 1 ? "" : "s"}`;
}

function firstLines(text: string, limit: number): string {
  const lines = text.split("\n");
  if (lines.length <= limit) return text;
  return `${lines.slice(0, limit).join("\n")}\n… ${lines.length - limit} more lines`;
}
