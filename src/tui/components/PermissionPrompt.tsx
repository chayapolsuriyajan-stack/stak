import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type {
  PermissionDecision,
  PermissionRequest,
} from "../../permissions/types.js";

const CHOICES: { label: string; decision: PermissionDecision }[] = [
  { label: "Yes, run it", decision: "approved" },
  { label: "No, tell the model what to do instead", decision: "denied" },
];

export interface PermissionPromptProps {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecision) => void;
}

export function PermissionPrompt({ request, onDecide }: PermissionPromptProps) {
  const [selected, setSelected] = useState(0);

  useInput((_char, key) => {
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) setSelected((current) => Math.min(CHOICES.length - 1, current + 1));
    if (key.return) onDecide(CHOICES[selected]?.decision ?? "denied");
    // Escape is a fast path for the common answer when something looks wrong.
    if (key.escape) onDecide("denied");
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {request.riskTier === "bash" ? "Run this command?" : "Allow this change?"}
      </Text>

      <Box marginY={1}>
        <Text>{describe(request)}</Text>
      </Box>

      {CHOICES.map((choice, index) => (
        <Text key={choice.decision} color={index === selected ? "#a5b4fc" : "gray"}>
          {index === selected ? "❯ " : "  "}
          {choice.label}
        </Text>
      ))}
    </Box>
  );
}

function describe(request: PermissionRequest): string {
  const args = request.args as Record<string, unknown>;

  if (request.toolName === "bash" && typeof args["command"] === "string") {
    return `$ ${args["command"]}`;
  }

  if (typeof args["path"] === "string") {
    return `${request.toolName} ${args["path"]}`;
  }

  return `${request.toolName} ${JSON.stringify(args)}`;
}
