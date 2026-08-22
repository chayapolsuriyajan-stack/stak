import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "../agent/types.js";
import { sessionsDir } from "../config/paths.js";
import type { LoadedSession, SessionRecord } from "./types.js";

export interface SessionSummary {
  sessionId: string;
  filePath: string;
  startedAt?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  /** First user message, trimmed for display — the picker's main way of
   * telling sessions apart at a glance. */
  preview: string;
}

interface SessionFile {
  file: string;
  mtimeMs: number;
}

async function listSessionFiles(cwd: string): Promise<SessionFile[]> {
  const dir = sessionsDir(cwd);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const files: SessionFile[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const file = path.join(dir, entry);
    try {
      const stat = await fs.stat(file);
      files.push({ file, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Finds the most recently written session in this project, if any. */
export async function findLatestSession(
  cwd: string = process.cwd(),
): Promise<string | undefined> {
  return (await listSessionFiles(cwd))[0]?.file;
}

/** Resolves a session by its id (the JSONL filename minus the extension). */
export async function findSessionById(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<string | undefined> {
  const file = path.join(sessionsDir(cwd), `${sessionId}.jsonl`);
  try {
    await fs.access(file);
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Lightweight summaries for every session in this project, newest first —
 * enough to populate a picker without materializing full conversation
 * history for sessions the user won't end up choosing.
 */
export async function listSessions(
  cwd: string = process.cwd(),
): Promise<SessionSummary[]> {
  const files = await listSessionFiles(cwd);
  const summaries: SessionSummary[] = [];

  for (const { file } of files) {
    const summary = await summarizeSession(file);
    if (summary) summaries.push(summary);
  }

  return summaries;
}

async function summarizeSession(filePath: string): Promise<SessionSummary | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  let sessionId = path.basename(filePath, ".jsonl");
  let startedAt: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let messageCount = 0;
  let preview: string | undefined;

  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;

    let record: SessionRecord;
    try {
      record = JSON.parse(line) as SessionRecord;
    } catch {
      continue;
    }

    if (record.type === "meta") {
      sessionId = record.sessionId;
      startedAt = record.startedAt;
      provider = record.provider;
      model = record.model;
    } else if (record.type === "message") {
      messageCount++;
      if (preview === undefined && record.message.role === "user") {
        preview = firstText(record.message);
      }
    } else if (record.type === "compaction") {
      // messageCount should reflect the post-compaction history that will
      // actually load, not records that no longer exist in it. `preview`
      // is left untouched — it should keep showing the session's original
      // first prompt regardless of later compaction.
      messageCount = record.history.length;
    }
  }

  if (messageCount === 0) return undefined;

  return {
    sessionId,
    filePath,
    ...(startedAt ? { startedAt } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    messageCount,
    preview: preview ?? "(no text)",
  };
}

function firstText(message: { content: { type: string; text?: string }[] }): string {
  const text = message.content.find((block) => block.type === "text")?.text ?? "";
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine;
}

/**
 * Rehydrates a session file into conversation history. Malformed lines are
 * skipped rather than aborting the load, so a truncated final write from an
 * interrupted session still yields everything before it.
 */
export async function loadSession(filePath: string): Promise<LoadedSession | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  const history: Message[] = [];
  let sessionId = path.basename(filePath, ".jsonl");
  let provider: string | undefined;
  let model: string | undefined;

  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;

    let record: SessionRecord;
    try {
      record = JSON.parse(line) as SessionRecord;
    } catch {
      continue;
    }

    if (record.type === "meta") {
      sessionId = record.sessionId;
      provider = record.provider;
      model = record.model;
    } else if (record.type === "message") {
      history.push(record.message);
    } else if (record.type === "compaction") {
      // A compaction record replaces everything read so far with its own
      // snapshot. Later `message` records keep appending on top of it as
      // usual; a subsequent compaction record resets again.
      history.length = 0;
      history.push(...record.history);
    }
  }

  return {
    sessionId,
    filePath,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    history,
  };
}
