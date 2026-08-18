/** What the transcript renders — a display view of the conversation, not the
 * provider-facing history. */
export type DisplayMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "tool"; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string };
