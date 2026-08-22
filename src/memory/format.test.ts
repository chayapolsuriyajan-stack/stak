import { describe, expect, test } from "vitest";
import { describeMemory, formatMemory } from "./format.js";
import type { MemoryFile } from "./types.js";

describe("formatMemory", () => {
  test("returns an empty string with no files", () => {
    expect(formatMemory([])).toBe("");
  });

  test("produces a heading, standing-instructions line, and one subsection per file in order", () => {
    const files: MemoryFile[] = [
      { path: "/home/.stak/STAK.md", source: "global", content: "Be terse.", bytes: 9, truncated: false },
      { path: "/repo/STAK.md", source: "project", content: "Use pnpm.", bytes: 9, truncated: false },
    ];

    const result = formatMemory(files);

    expect(result).toContain("## Project memory");
    expect(result).toContain("standing instructions");
    const globalIndex = result.indexOf("## /home/.stak/STAK.md (global)");
    const projectIndex = result.indexOf("## /repo/STAK.md (project)");
    expect(globalIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(globalIndex);
    expect(result).toContain("Be terse.");
    expect(result).toContain("Use pnpm.");
  });
});

describe("describeMemory", () => {
  test("reports when no memory files were found", () => {
    const result = describeMemory({ files: [], warnings: [] });

    expect(result).toContain("No memory files found.");
  });

  test("lists each file with its source and byte count", () => {
    const result = describeMemory({
      files: [{ path: "/repo/STAK.md", source: "project", content: "hi", bytes: 2, truncated: false }],
      warnings: [],
    });

    expect(result).toContain("/repo/STAK.md");
    expect(result).toContain("project");
    expect(result).toContain("2");
  });

  test("mentions a non-zero warning count", () => {
    const result = describeMemory({
      files: [],
      warnings: ["oops", "another"],
    });

    expect(result).toContain("2");
    expect(result.toLowerCase()).toContain("warning");
  });

  test("includes the actual warning text inline, not just a count referencing 'above'", () => {
    // console.warn at startup is the only other place warnings ever print —
    // a warning from a later reload (e.g. /memory or /init) has no "above"
    // to point to, so the text itself must be in this output.
    const result = describeMemory({
      files: [{ path: "STAK.md", source: "project", content: "x", bytes: 1, truncated: false }],
      warnings: ['Memory import "@bad.md" was blocked: escapes the project directory.'],
    });

    expect(result).toContain('Memory import "@bad.md" was blocked: escapes the project directory.');
  });
});
