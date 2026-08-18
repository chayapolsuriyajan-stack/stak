import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-test-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe("read", () => {
  test("returns line-numbered content", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "one\ntwo\nthree");

    const result = await readTool.execute({ path: "a.txt" }, { cwd });

    expect(result.output).toContain("1\tone");
    expect(result.output).toContain("3\tthree");
  });

  test("reports a missing file as an error", async () => {
    const result = await readTool.execute({ path: "nope.txt" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("No such file");
  });

  test("honours offset and limit", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "1\n2\n3\n4\n5");

    const result = await readTool.execute({ path: "a.txt", offset: 2, limit: 2 }, { cwd });

    expect(result.output).toContain("2\t2");
    expect(result.output).toContain("3\t3");
    expect(result.output).not.toContain("4\t4");
  });
});

describe("write", () => {
  test("creates a file and its parent directories", async () => {
    const result = await writeTool.execute(
      { path: "nested/deep/a.txt", content: "hello" },
      { cwd },
    );

    expect(result.isError).toBeUndefined();
    expect(await fs.readFile(path.join(cwd, "nested/deep/a.txt"), "utf8")).toBe("hello");
  });

  test("distinguishes overwriting from creating", async () => {
    await writeTool.execute({ path: "a.txt", content: "first" }, { cwd });
    const result = await writeTool.execute({ path: "a.txt", content: "second" }, { cwd });

    expect(result.output).toContain("Overwrote");
  });
});

describe("edit", () => {
  test("replaces a unique match", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "hello world");

    const result = await editTool.execute(
      { path: "a.txt", old_string: "world", new_string: "there" },
      { cwd },
    );

    expect(result.isError).toBeUndefined();
    expect(await fs.readFile(path.join(cwd, "a.txt"), "utf8")).toBe("hello there");
  });

  test("refuses an ambiguous match rather than guessing", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "x\nx\n");

    const result = await editTool.execute(
      { path: "a.txt", old_string: "x", new_string: "y" },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("appears 2 times");
    expect(await fs.readFile(path.join(cwd, "a.txt"), "utf8")).toBe("x\nx\n");
  });

  test("replaces every occurrence when asked", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "x\nx\n");

    const result = await editTool.execute(
      { path: "a.txt", old_string: "x", new_string: "y", replace_all: true },
      { cwd },
    );

    expect(result.isError).toBeUndefined();
    expect(await fs.readFile(path.join(cwd, "a.txt"), "utf8")).toBe("y\ny\n");
  });

  test("fails loudly when the target text is absent", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "hello");

    const result = await editTool.execute(
      { path: "a.txt", old_string: "missing", new_string: "x" },
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });
});

describe("bash", () => {
  test("captures output from a successful command", async () => {
    const result = await bashTool.execute({ command: "echo hi" }, { cwd });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("hi");
  });

  test("marks a non-zero exit as an error", async () => {
    const result = await bashTool.execute({ command: "exit 3" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("code 3");
  });
});

describe("glob", () => {
  test("finds files by pattern", async () => {
    await fs.writeFile(path.join(cwd, "a.ts"), "");
    await fs.writeFile(path.join(cwd, "b.js"), "");

    const result = await globTool.execute({ pattern: "*.ts" }, { cwd });

    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("b.js");
  });

  test("reports an empty result plainly", async () => {
    const result = await globTool.execute({ pattern: "*.nothing" }, { cwd });

    expect(result.output).toContain("No files match");
  });
});

describe("grep", () => {
  test("returns file, line, and text for each match", async () => {
    await fs.writeFile(path.join(cwd, "a.txt"), "alpha\nbeta\ngamma");

    const result = await grepTool.execute({ pattern: "beta" }, { cwd });

    expect(result.output).toContain("a.txt:2:beta");
  });

  test("rejects an invalid pattern instead of throwing", async () => {
    const result = await grepTool.execute({ pattern: "[unclosed" }, { cwd });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid regular expression");
  });
});
