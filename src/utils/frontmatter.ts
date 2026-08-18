import matter from "gray-matter";

export interface ParsedFile {
  data: Record<string, unknown>;
  body: string;
}

/** `cache` is honoured at runtime but missing from the published types. */
const NO_CACHE = { cache: false } as Parameters<typeof matter>[1];

/**
 * Parses YAML frontmatter, returning undefined when it is malformed rather
 * than throwing, so one bad file cannot take down startup.
 *
 * gray-matter's content cache is disabled: a second parse of identical
 * malformed input returns empty data instead of throwing, which would make a
 * file's fate depend on whether an identical one had been read first. The
 * option works but is absent from the published types, hence the cast.
 */
export function parseFrontmatter(
  raw: string,
): { ok: true; value: ParsedFile } | { ok: false; reason: string } {
  try {
    const parsed = matter(raw, NO_CACHE);

    return {
      ok: true,
      value: {
        data: parsed.data as Record<string, unknown>,
        body: parsed.content.trim(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message.split("\n")[0] ?? "invalid frontmatter" };
  }
}
