import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadMemory, samePath } from "./loader.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "stak-memory-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe("discovery and precedence", () => {
  test("orders global, then ancestors outermost-to-innermost, then project", async () => {
    const home = path.join(root, "home");
    const outer = path.join(home, "a");
    const inner = path.join(home, "a", "b");
    const cwd = path.join(inner, "project");
    const globalFile = path.join(root, "global-STAK.md");

    await write(globalFile, "global memory");
    await write(path.join(outer, "STAK.md"), "outer ancestor memory");
    await write(path.join(inner, "STAK.md"), "inner ancestor memory");
    await write(path.join(cwd, "STAK.md"), "project memory");

    const loaded = await loadMemory(cwd, { globalFile, homeDir: home });

    expect(loaded.files.map((f) => f.source)).toEqual(["global", "ancestor", "ancestor", "project"]);
    expect(loaded.files.map((f) => f.content)).toEqual([
      "global memory",
      "outer ancestor memory",
      "inner ancestor memory",
      "project memory",
    ]);
    expect(loaded.warnings).toEqual([]);
  });

  test("stops the ancestor walk at the injected homeDir and does not walk past it", async () => {
    const home = path.join(root, "home");
    const mid = path.join(home, "mid");
    const cwd = path.join(mid, "project");

    // Above homeDir — must never be picked up.
    await write(path.join(root, "STAK.md"), "outside home, should be excluded");
    // At homeDir itself — excluded, the walk stops before it.
    await write(path.join(home, "STAK.md"), "at home dir, should be excluded");
    // Between homeDir and cwd — the only ancestor that should be included.
    await write(path.join(mid, "STAK.md"), "mid ancestor, should be included");

    const loaded = await loadMemory(cwd, { homeDir: home, globalFile: path.join(root, "no-global.md") });

    expect(loaded.files).toHaveLength(1);
    expect(loaded.files[0]?.content).toBe("mid ancestor, should be included");
    expect(loaded.files[0]?.source).toBe("ancestor");
  });

  test("cwd itself is not double-counted as both an ancestor and a project entry", async () => {
    const home = path.join(root, "home");
    const cwd = path.join(home, "mid", "project");

    await write(path.join(cwd, "STAK.md"), "project only");

    const loaded = await loadMemory(cwd, { homeDir: home, globalFile: path.join(root, "no-global.md") });

    expect(loaded.files).toHaveLength(1);
    expect(loaded.files[0]?.source).toBe("project");
  });

  test("returns empty when nothing is present anywhere", async () => {
    const cwd = path.join(root, "empty-project");
    await fs.mkdir(cwd, { recursive: true });

    const loaded = await loadMemory(cwd, {
      homeDir: path.join(root, "home"),
      globalFile: path.join(root, "no-global.md"),
    });

    expect(loaded).toEqual({ files: [], warnings: [] });
  });
});

describe("@imports", () => {
  function opts(root: string) {
    return { homeDir: path.join(root, "home"), globalFile: path.join(root, "no-global.md") };
  }

  test("resolves a simple one-level import", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "docs", "style.md"), "Use 2-space indentation.");
    await write(path.join(cwd, "STAK.md"), "Intro.\n@docs/style.md\nOutro.");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).toBe("Intro.\nUse 2-space indentation.\nOutro.");
    expect(loaded.warnings).toEqual([]);
  });

  test("resolves nested imports (A imports B imports C)", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "c.md"), "C content");
    await write(path.join(cwd, "b.md"), "B before\n@c.md\nB after");
    await write(path.join(cwd, "STAK.md"), "A before\n@b.md\nA after");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).toBe("A before\nB before\nC content\nB after\nA after");
    expect(loaded.warnings).toEqual([]);
  });

  test("detects an import cycle without hanging", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "b.md"), "B content\n@STAK.md");
    await write(path.join(cwd, "STAK.md"), "A content\n@b.md");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files).toHaveLength(1);
    expect(loaded.files[0]?.content).toContain("import cycle skipped");
    expect(loaded.warnings.join(" ")).toContain("cycle");
  }, 5000);

  test("stops with a marker and warning when maxDepth is exceeded", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "c.md"), "C content");
    await write(path.join(cwd, "b.md"), "@c.md");
    await write(path.join(cwd, "STAK.md"), "@b.md");

    const loaded = await loadMemory(cwd, { ...opts(root), maxDepth: 1 });

    expect(loaded.files[0]?.content).toContain("import depth exceeded");
    expect(loaded.warnings.join(" ")).toContain("depth");
  });

  test("a missing imported file produces a marker and warning, not a throw", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "STAK.md"), "Before\n@does/not/exist.md\nAfter");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).toContain("import not found");
    expect(loaded.warnings.join(" ")).toContain("not found");
  });

  test("import syntax inside a fenced code block is left untouched", async () => {
    const cwd = path.join(root, "project");
    const content = "Intro.\n```\n@fake/import.md\n```\nOutro.";
    await write(path.join(cwd, "STAK.md"), content);

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).toBe(content);
    expect(loaded.warnings).toEqual([]);
  });
});

describe("@import confinement (security)", () => {
  function opts(root: string) {
    return { homeDir: path.join(root, "home"), globalFile: path.join(root, "home", "STAK.md") };
  }

  test("an import trying to escape the project root via ../../ is rejected, not read", async () => {
    const cwd = path.join(root, "project");
    // Lives outside the project root entirely.
    await write(path.join(root, "secret.md"), "TOP SECRET API KEY");
    await write(path.join(cwd, "STAK.md"), "Before\n@../secret.md\nAfter");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).not.toContain("TOP SECRET");
    expect(loaded.files[0]?.content).toContain("import blocked");
    expect(loaded.warnings.join(" ")).toMatch(/blocked|outside/i);
  });

  test("an absolute path import escaping the project root is rejected, not read", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(root, "secret.md"), "TOP SECRET API KEY");
    const absoluteEscape = path.join(root, "secret.md");
    await write(path.join(cwd, "STAK.md"), `Before\n@${absoluteEscape}\nAfter`);

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).not.toContain("TOP SECRET");
    expect(loaded.files[0]?.content).toContain("import blocked");
  });

  test("a project-sourced file's ~-prefixed import is rejected — ~ is only allowed from the global file", async () => {
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    await write(path.join(home, ".stak", "config.json"), '{"apiKey":"sk-should-not-leak"}');
    await write(path.join(cwd, "STAK.md"), "Before\n@~/.stak/config.json\nAfter");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).not.toContain("sk-should-not-leak");
    expect(loaded.files[0]?.content).toContain("import blocked");
    expect(loaded.warnings.join(" ")).toContain("only allowed");
  });

  test("an ancestor-sourced file's ~-prefixed import is also rejected", async () => {
    const home = path.join(root, "home");
    const mid = path.join(home, "mid");
    const cwd = path.join(mid, "project");
    await write(path.join(home, "secret.txt"), "leak me");
    await write(path.join(mid, "STAK.md"), "@~/secret.txt");
    await fs.mkdir(cwd, { recursive: true });

    const loaded = await loadMemory(cwd, opts(root));

    const ancestorFile = loaded.files.find((f) => f.source === "ancestor");
    expect(ancestorFile?.content).not.toContain("leak me");
    expect(ancestorFile?.content).toContain("import blocked");
  });

  test("the GLOBAL file's own ~-prefixed import is still allowed — reading its own home directory is not a boundary escape", async () => {
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const globalFile = path.join(home, "STAK.md");
    await fs.mkdir(cwd, { recursive: true });
    await write(path.join(home, "notes.md"), "global notes content");
    await write(globalFile, "Intro\n@~/notes.md\nOutro");

    const loaded = await loadMemory(cwd, { homeDir: home, globalFile });

    const globalEntry = loaded.files.find((f) => f.source === "global");
    expect(globalEntry?.content).toBe("Intro\nglobal notes content\nOutro");
    expect(loaded.warnings).toEqual([]);
  });

  test("an absolute path import that still resolves inside the project root is allowed", async () => {
    const cwd = path.join(root, "project");
    const target = path.join(cwd, "docs", "style.md");
    await write(target, "Use 2-space indentation.");
    await write(path.join(cwd, "STAK.md"), `Intro\n@${target}\nOutro`);

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).toBe("Intro\nUse 2-space indentation.\nOutro");
    expect(loaded.warnings).toEqual([]);
  });

  test("an ancestor-sourced file's relative import resolves against its OWN directory, not cwd", async () => {
    // Regression: confining every non-~ import to `cwd` (rather than the
    // importing file's own directory) broke every relative import in an
    // ancestor STAK.md the moment cwd was a deeper subdirectory than the
    // ancestor itself -- the resolved path (ancestor/docs/x) is not inside
    // cwd (a child of ancestor), so it was wrongly rejected.
    const mid = path.join(root, "home", "mid");
    const cwd = path.join(mid, "deep", "project");
    await write(path.join(mid, "docs", "shared.md"), "shared team conventions");
    await write(path.join(mid, "STAK.md"), "Intro\n@docs/shared.md\nOutro");
    await fs.mkdir(cwd, { recursive: true });

    const loaded = await loadMemory(cwd, opts(root));

    const ancestorFile = loaded.files.find((f) => f.source === "ancestor");
    expect(ancestorFile?.content).toBe("Intro\nshared team conventions\nOutro");
    expect(loaded.warnings).toEqual([]);
  });

  test("a symlink whose target escapes the allowed directory is rejected, not read", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(root, "secret.md"), "TOP SECRET API KEY");
    await fs.mkdir(cwd, { recursive: true });

    const linkPath = path.join(cwd, "docs.md");
    try {
      await fs.symlink(path.join(root, "secret.md"), linkPath);
    } catch {
      // Symlink creation can require elevated privileges on Windows without
      // developer mode enabled -- skip rather than fail the suite for an
      // environment limitation unrelated to the code under test.
      return;
    }

    await write(path.join(cwd, "STAK.md"), "Before\n@docs.md\nAfter");

    const loaded = await loadMemory(cwd, opts(root));

    expect(loaded.files[0]?.content).not.toContain("TOP SECRET");
    expect(loaded.files[0]?.content).toContain("import blocked");
    expect(loaded.warnings.join(" ")).toMatch(/symlink|outside/i);
  });
});

describe("Windows case-sensitivity in the ancestor-walk boundary", () => {
  // Simulated with path.win32 and an explicit platform argument so this is
  // meaningful cross-platform in CI, not just when actually running on
  // Windows — Node's `path` module never normalizes drive-letter case, but
  // Windows paths are case-insensitive, so os.homedir()'s "C:\Users\chaya"
  // and a lowercase-drive cwd under "c:\users\chaya" refer to the same
  // directory and must be treated as the same ancestor-walk boundary.
  test("treats a lowercase-drive-letter path as equal to a normally-cased one on win32", () => {
    const homeDir = path.win32.resolve("C:\\Users\\chaya");
    const lowercaseHome = path.win32.resolve("c:\\users\\chaya");

    expect(samePath(lowercaseHome, homeDir, "win32")).toBe(true);
  });

  test("does not fold case on non-win32 platforms", () => {
    const homeDir = path.posix.resolve("/Users/chaya");
    const lowercaseHome = path.posix.resolve("/users/chaya");

    expect(samePath(lowercaseHome, homeDir, "linux")).toBe(false);
  });
});

describe("byte cap", () => {
  test("truncates at a line boundary, never mid-line, and warns", async () => {
    const cwd = path.join(root, "project");
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i} of reasonable length here`);
    await write(path.join(cwd, "STAK.md"), lines.join("\n"));

    const loaded = await loadMemory(cwd, {
      homeDir: path.join(root, "home"),
      globalFile: path.join(root, "no-global.md"),
      maxBytes: 500,
    });

    const file = loaded.files[0];
    expect(file?.truncated).toBe(true);
    expect(Buffer.byteLength(file?.content ?? "", "utf8")).toBeLessThanOrEqual(500);
    // Never mid-line: the content is empty, or ends with a newline, or its
    // last line matches one of the original whole lines exactly.
    const content = file?.content ?? "";
    if (content !== "") {
      const trailingLine = content.endsWith("\n") ? "" : (content.split("\n").pop() ?? "");
      if (trailingLine !== "") {
        expect(lines).toContain(trailingLine);
      }
    }
    expect(loaded.warnings.join(" ")).toContain("truncated");
  });
});

describe("whitespace-only files", () => {
  test("a whitespace-only file is dropped entirely, without a warning", async () => {
    const cwd = path.join(root, "project");
    await write(path.join(cwd, "STAK.md"), "   \n\t\n   ");

    const loaded = await loadMemory(cwd, {
      homeDir: path.join(root, "home"),
      globalFile: path.join(root, "no-global.md"),
    });

    expect(loaded.files).toEqual([]);
    expect(loaded.warnings).toEqual([]);
  });
});
