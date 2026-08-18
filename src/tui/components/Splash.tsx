import { Box, Text } from "ink";

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

const COMMANDS: [string, string][] = [
  ["/help", "show help"],
  ["/sessions", "list sessions"],
  ["/new", "start a new session"],
  ["/model", "switch model"],
  ["/permissions", "change permission mode"],
  ["/exit", "exit the app"],
];

export interface SplashProps {
  version: string;
}

export function Splash({ version }: SplashProps) {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      <Box flexDirection="column">
        {WORDMARK.map((row, index) => (
          <Text key={index} color="#a5b4fc" bold>
            {row}
          </Text>
        ))}
        <Box justifyContent="flex-end">
          <Text color="gray">v{version}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={2}>
        {COMMANDS.map(([name, description]) => (
          <Text key={name}>
            <Text color="#a5b4fc">{name.padEnd(14)}</Text>
            <Text color="gray">{description}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
