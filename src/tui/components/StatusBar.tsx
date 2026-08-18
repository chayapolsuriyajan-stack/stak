import { Box, Text } from "ink";
import Spinner from "ink-spinner";

export interface StatusBarProps {
  provider: string;
  model: string;
  busy: boolean;
  hint?: string;
}

export function StatusBar({ provider, model, busy, hint }: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color="gray">
        {busy ? (
          <>
            <Text color="#a5b4fc">
              <Spinner type="dots" />
            </Text>
            <Text color="gray"> working… esc to interrupt</Text>
          </>
        ) : (
          (hint ?? "enter send")
        )}
      </Text>
      <Text color="gray">
        {provider} {model}
      </Text>
    </Box>
  );
}
