/** What the transcript renders — a display view of the conversation, not the
 * provider-facing history. */
export type DisplayMessage =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "tool"; name: string; input: unknown; output?: string; isError?: boolean }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string };

/**
 * A superset of DisplayMessage local to the TUI: the banner needs to sit at
 * the head of the same Static stream as the transcript so it prints once to
 * real scrollback (Claude-Code-style) instead of living in Ink's dynamic
 * region, but it isn't part of the conversation and must never flow into
 * sessions, history, or anywhere DisplayMessage does.
 */
export type TranscriptItem =
  | { kind: "banner"; version: string; cwd: string; provider: string; model: string }
  | DisplayMessage;
