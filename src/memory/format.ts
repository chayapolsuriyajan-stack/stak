import type { LoadedMemory, MemoryFile } from "./types.js";

const STANDING_INSTRUCTIONS =
  "The following files were loaded as persistent context for this project; treat them as standing instructions unless they conflict with the user's direct request.";

/**
 * Renders loaded memory files as a system-prompt section, in the order
 * given (callers are expected to have already sorted by precedence).
 * Returns "" when there is nothing to add.
 *
 * Uses "## Project memory" (not "#") because the only current caller,
 * systemPrompt.ts, already wraps this output in its own "# Memory" heading
 * — a top-level heading here would print two "#" headings back to back.
 */
export function formatMemory(files: MemoryFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((file) => `## ${file.path} (${file.source})\n\n${file.content}`);

  return [`## Project memory\n${STANDING_INSTRUCTIONS}`, ...sections].join("\n\n");
}

/** A short human summary for a `/memory` command notice. */
export function describeMemory(loaded: LoadedMemory): string {
  if (loaded.files.length === 0) {
    const warningSuffix =
      loaded.warnings.length > 0
        ? ` (${loaded.warnings.length} warning${loaded.warnings.length === 1 ? "" : "s"}:\n${loaded.warnings.join("\n")})`
        : "";
    return `No memory files found.${warningSuffix}`;
  }

  const lines = loaded.files.map(
    (file) => `- ${file.path} (${file.source}, ${file.bytes} bytes)${file.truncated ? " [truncated]" : ""}`,
  );

  // The warning text itself is inlined here rather than just a count
  // referencing "above" — console.warn at CLI startup is the only other
  // place warnings ever print, so a warning produced later (e.g. from a
  // /memory-triggered reload, or /init's reload) would otherwise never be
  // visible anywhere the user can actually see it.
  const warningBlock =
    loaded.warnings.length > 0
      ? `\n\n${loaded.warnings.length} warning${loaded.warnings.length === 1 ? "" : "s"}:\n${loaded.warnings.join("\n")}`
      : "";

  return `${lines.join("\n")}${warningBlock}`;
}
