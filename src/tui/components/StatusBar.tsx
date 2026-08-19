import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { ACCENT, MUTED } from "../theme.js";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

export interface StatusBarProps {
  provider: string;
  model: string;
  busy: boolean;
  hint?: string;
  usage?: TurnUsage;
}

export function StatusBar({ provider, model, busy, hint, usage }: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={MUTED}>
        {busy ? (
          <>
            <Text color={ACCENT}>
              <Spinner type="dots" />
            </Text>
            <Text color={MUTED}> working… esc to interrupt</Text>
          </>
        ) : (
          (hint ?? "enter send")
        )}
      </Text>
      <Box gap={2}>
        {usage && <Text color={MUTED}>{formatUsage(usage)}</Text>}
        <Text color={MUTED}>
          {provider} {model}
        </Text>
      </Box>
    </Box>
  );
}

function formatUsage({ inputTokens, outputTokens, elapsedMs }: TurnUsage): string {
  const total = inputTokens + outputTokens;
  const seconds = elapsedMs / 1000;
  // Sub-second turns (a cached or trivial reply) would otherwise divide by a
  // near-zero duration and print a meaningless spike.
  const tokensPerSecond = seconds >= 0.1 ? outputTokens / seconds : 0;

  const rate = tokensPerSecond > 0 ? ` · ${tokensPerSecond.toFixed(1)} tok/s` : "";
  return `${total.toLocaleString()} tokens (${inputTokens.toLocaleString()} in, ${outputTokens.toLocaleString()} out)${rate}`;
}
