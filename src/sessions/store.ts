import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Message } from "../agent/types.js";
import { sessionsDir } from "../config/paths.js";
import type { SessionRecord } from "./types.js";

/**
 * Appends conversation records to a JSONL file as they happen. Writing on each
 * message rather than at exit means an interrupted session still leaves a
 * resumable transcript behind.
 */
export class SessionStore {
  readonly sessionId: string;
  readonly filePath: string;
  private started = false;
  /** Serializes appends so concurrent writes cannot interleave mid-line. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly meta: { provider: string; model: string; cwd: string },
    sessionId: string = nanoid(12),
  ) {
    this.sessionId = sessionId;
    this.filePath = path.join(sessionsDir(meta.cwd), `${sessionId}.jsonl`);
  }

  /**
   * Continues an existing session file rather than starting a new one, so a
   * resumed conversation stays in a single transcript. Without this, resuming
   * twice would leave the earliest turns behind in an older file.
   */
  static resuming(
    meta: { provider: string; model: string; cwd: string },
    existing: { sessionId: string; filePath: string },
  ): SessionStore {
    const store = new SessionStore(meta, existing.sessionId);
    // The meta record is already at the top of the file being continued.
    store.started = true;
    return store;
  }

  append(message: Message): void {
    this.queue = this.queue.then(async () => {
      try {
        if (!this.started) {
          await fs.mkdir(path.dirname(this.filePath), { recursive: true });
          await this.write({
            type: "meta",
            sessionId: this.sessionId,
            provider: this.meta.provider,
            model: this.meta.model,
            cwd: this.meta.cwd,
            startedAt: new Date().toISOString(),
          });
          this.started = true;
        }

        await this.write({
          type: "message",
          message,
          ts: new Date().toISOString(),
        });
      } catch {
        // Persistence is a convenience; losing it should not end the session.
      }
    });
  }

  /**
   * Persists a compaction: the summarized history that should replace
   * everything before it on the next load. Compaction can only happen once a
   * session already has messages in it (there is nothing to compact
   * otherwise), so by the time this is called `append` has already written
   * the meta record and `this.started` is already true — no header-writing
   * concern to duplicate here.
   */
  compacted(history: Message[]): void {
    // Snapshot synchronously, before any queuing/async work — `history` is
    // the caller's live array (ctx.history), which runTurn can mutate in
    // place if a new turn starts before this queued write actually runs.
    // Serializing that live reference instead of a snapshot risks writing a
    // history that has since gained more messages than were actually
    // compacted.
    const snapshot = [...history];
    this.queue = this.queue.then(async () => {
      try {
        await this.write({
          type: "compaction",
          history: snapshot,
          ts: new Date().toISOString(),
        });
      } catch {
        // Persistence is a convenience; losing it should not end the session.
      }
    });
  }

  /** Resolves once every queued append has been flushed. */
  async flush(): Promise<void> {
    await this.queue;
  }

  private async write(record: SessionRecord): Promise<void> {
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}
