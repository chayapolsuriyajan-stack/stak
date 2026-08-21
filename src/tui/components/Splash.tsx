import { Box, Text } from "ink";
import { ACCENT, MUTED } from "../theme.js";

/**
 * Block-character wordmark. Each string is one terminal row; the glyphs are
 * five rows tall so they read as solid letterforms at normal font sizes.
 */
const WORDMARK = [
  "█████ █████  █████ ██   ██",
  "██      ██   ██ ██ ██  ██ ",
  "█████   ██   █████ █████  ",
  "   ██   ██   ██ ██ ██  ██ ",
  "█████   ██   ██ ██ ██   ██",
];

export interface SplashProps {
  version: string;
  cwd: string;
  provider: string;
  model: string;
}

/**
 * Prints once at the head of scrollback, then scrolls away as messages
 * append below it — this is a Static item (see App.tsx), not a
 * conditionally-rendered screen, so it must stay compact rather than the
 * full-height centered block a "welcome screen" would use.
 */
export function Splash({ version, cwd, provider, model }: SplashProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {WORDMARK.map((row, index) => (
        <Text key={index} color={ACCENT} bold>
          {row}
        </Text>
      ))}
      <Text color={MUTED}>
        v{version} · {provider} {model} · {cwd}
      </Text>
      <Text color={MUTED}>
        /help for commands · shift+tab permission mode · ctrl+o show thinking
      </Text>
    </Box>
  );
}
