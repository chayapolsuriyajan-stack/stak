import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendMemory, appendToContent, memoryLine } from "./append.js";

describe("memoryLine", () => {
  test("prefixes with a bullet and trims", () => {
    expect(memoryLine("  remember this  ")).toBe("- remember this");
  });
});

describe("appendToContent", () => {
  test("creates a header when existing content is undefined", () => {
    expect(appendToContent(undefined, "- new fact")).toBe("# Project memory\n\n- new fact\n");
  });

  test("creates a header when existing content is empty", () => {
    expect(appendToContent("", "- new fact")).toBe("# Project memory\n\n- new fact\n");
  });

  test("appends cleanly after an existing bullet list with no double blank lines", () => {
    const existing = "# Project memory\n\n- first fact\n- second fact\n";

    const result = appendToContent(existing, "- third fact");

    expect(result).toBe("# Project memory\n\n- first fact\n- second fact\n\n- third fact\n");
  });
});

describe("appendMemory", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-memory-append-"));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  test("creates the file when absent", async () => {
    const result = await appendMemory(cwd, "always use pnpm");

    expect(result.path).toBe(path.join(cwd, "STAK.md"));
    expect(result.line).toBe("- always use pnpm");

    const written = await fs.readFile(path.join(cwd, "STAK.md"), "utf8");
    expect(written).toBe("# Project memory\n\n- always use pnpm\n");
  });

  test("appends when the file already exists", async () => {
    await fs.writeFile(path.join(cwd, "STAK.md"), "# Project memory\n\n- first fact\n");

    const result = await appendMemory(cwd, "second fact");

    expect(result.line).toBe("- second fact");
    const written = await fs.readFile(path.join(cwd, "STAK.md"), "utf8");
    expect(written).toBe("# Project memory\n\n- first fact\n\n- second fact\n");
  });
});
