import type { Message } from "../agent/types.js";

/**
 * The session-file format this build writes and understands. Bump it only for
 * a change an older build would mis-read — adding an optional field doesn't
 * need it. Files written before the marker existed have none and are treated
 * as format 1, which is exactly what they are.
 */
export const SESSION_FORMAT_VERSION = 1;

/** One line of a session's JSONL file. */
export type SessionRecord =
  | {
      type: "meta";
      /** Absent in files written before 1.0; those are format 1. */
      formatVersion?: number;
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
