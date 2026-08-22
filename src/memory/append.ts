import fs from "node:fs/promises";
import { projectMemoryFile } from "../config/paths.js";

/** Formats one line to append to a memory file, e.g. "- remember this". */
export function memoryLine(text: string): string {
  return `- ${text.trim()}`;
}

/**
 * Appends `line` to `existing` content, creating a "# Project memory"
 * header when `existing` is undefined/empty, and normalizing so there is
 * exactly one blank line before the new bullet and exactly one trailing
 * newline in the result.
 */
export function appendToContent(existing: string | undefined, line: string): string {
  const trimmed = (existing ?? "").trim();

  if (trimmed === "") {
    return `# Project memory\n\n${line}\n`;
  }

  return `${trimmed}\n\n${line}\n`;
}

/**
 * Appends `text` as a bullet to the project's STAK.md, creating the file if
 * it doesn't exist yet. Returns the file path and the exact line added so a
 * caller can show the user what changed.
 */
export async function appendMemory(cwd: string, text: string): Promise<{ path: string; line: string }> {
  const filePath = projectMemoryFile(cwd);

  let existing: string | undefined;
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    existing = undefined;
  }

  const line = memoryLine(text);
  const newContent = appendToContent(existing, line);
  await fs.writeFile(filePath, newContent, "utf8");

  return { path: filePath, line };
}
