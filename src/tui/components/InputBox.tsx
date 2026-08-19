import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { ACCENT, MUTED } from "../theme.js";

const MAX_SUGGESTIONS = 5;

export interface CommandSuggestion {
  name: string;
  description: string;
}

export interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** All known slash commands, filtered here against the current input. */
  commands?: CommandSuggestion[];
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  commands,
}: InputBoxProps) {
  const suggestions = disabled ? [] : matchCommands(value, commands ?? []);

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={disabled ? MUTED : ACCENT} paddingX={1}>
        <Text color={ACCENT}>{"> "}</Text>
        {disabled ? (
          <Text color={MUTED}>{value === "" ? "working…" : value}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder ?? ""}
          />
        )}
      </Box>

      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {suggestions.map((command) => (
            <Text key={command.name}>
              <Text color={ACCENT}>/{command.name.padEnd(16)}</Text>
              <Text color={MUTED}>{command.description}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Only offers suggestions while a command name is still being typed, not
 * once the user has moved on to its arguments. */
function matchCommands(
  value: string,
  commands: CommandSuggestion[],
): CommandSuggestion[] {
  if (!value.startsWith("/") || value.includes(" ")) return [];

  const typed = value.slice(1).toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().startsWith(typed))
    .slice(0, MAX_SUGGESTIONS);
}
