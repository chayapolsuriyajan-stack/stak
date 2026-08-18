import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputBox({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: InputBoxProps) {
  return (
    <Box borderStyle="round" borderColor={disabled ? "gray" : "#a5b4fc"} paddingX={1}>
      <Text color="#a5b4fc">{"> "}</Text>
      {disabled ? (
        <Text color="gray">{value === "" ? "working…" : value}</Text>
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder ?? ""}
        />
      )}
    </Box>
  );
}
