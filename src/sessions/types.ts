import type { Message } from "../agent/types.js";

/** One line of a session's JSONL file. */
export type SessionRecord =
  | {
      type: "meta";
      sessionId: string;
      provider: string;
      model: string;
      cwd: string;
      startedAt: string;
    }
  | { type: "message"; message: Message; ts: string }
  | { type: "compaction"; history: Message[]; ts: string };

export interface LoadedSession {
  sessionId: string;
  filePath: string;
  provider?: string;
  model?: string;
  history: Message[];
}
