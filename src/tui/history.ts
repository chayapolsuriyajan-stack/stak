import type { Message } from "../agent/types.js";
import type { DisplayMessage } from "./types.js";

/**
 * Rebuilds the visible transcript from conversation history when resuming.
 * Tool calls and their results live in separate messages, so results are
 * matched back onto the call they belong to by id.
 */
export function toDisplayMessages(history: Message[]): DisplayMessage[] {
  const display: DisplayMessage[] = [];
  const toolIndexById = new Map<string, number>();

  for (const message of history) {
    for (const block of message.content) {
      switch (block.type) {
        case "text": {
          if (block.text.trim() === "") break;
          display.push(
            message.role === "user"
              ? { kind: "user", text: block.text }
              : { kind: "assistant", text: block.text },
          );
          break;
        }

        case "thinking": {
          if (block.text.trim() === "") break;
          display.push({ kind: "thinking", text: block.text });
          break;
        }

        case "tool_use": {
          toolIndexById.set(block.id, display.length);
          display.push({ kind: "tool", name: block.name, input: block.input });
          break;
        }

        case "tool_result": {
          const index = toolIndexById.get(block.toolUseId);
          if (index === undefined) break;
          const existing = display[index];
          if (existing?.kind !== "tool") break;
          display[index] = {
            ...existing,
            output: block.content,
            isError: block.isError ?? false,
          };
          break;
        }
      }
    }
  }

  return display;
}
