import { Box, Text } from "ink";
import type { DisplayMessage } from "../types.js";

export interface MessageListProps {
  messages: DisplayMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <MessageItem key={index} message={message} />
      ))}
    </Box>
  );
}

function MessageItem({ message }: { message: DisplayMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <Box marginBottom={1}>
          <Text color="#a5b4fc" bold>
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
            <Text color="gray"> {summarize(message.input)}</Text>
          </Text>
          {message.output !== undefined && (
            <Text color={message.isError ? "red" : "gray"}>
              {"    "}
              {firstLines(message.output, 6)}
            </Text>
          )}
        </Box>
      );

    case "notice":
      return (
        <Box marginBottom={1}>
          <Text color="gray">{message.text}</Text>
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
