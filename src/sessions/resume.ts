import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "../agent/types.js";
import { sessionsDir } from "../config/paths.js";
import type { LoadedSession, SessionRecord } from "./types.js";

/** Finds the most recently written session in this project, if any. */
export async function findLatestSession(
  cwd: string = process.cwd(),
): Promise<string | undefined> {
  const dir = sessionsDir(cwd);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return undefined;
  }

  const candidates: { file: string; mtimeMs: number }[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const file = path.join(dir, entry);
    try {
      const stat = await fs.stat(file);
      candidates.push({ file, mtimeMs: stat.mtimeMs });
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file;
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
