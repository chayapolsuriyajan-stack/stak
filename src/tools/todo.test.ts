import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PermissionManager } from "../permissions/manager.js";
import {
  formatTodos,
  readTodos,
  todoFilePath,
  todoWriteTool,
  writeTodos,
} from "./todo.js";
import { ToolRegistry } from "./registry.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-todo-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

describe("todo file round-trip", () => {
  test("writeTodos persists and readTodos loads the same list", async () => {
    const todos = [
      { content: "wire HookRunner", status: "in_progress" as const },
      { content: "webfetch tool", status: "pending" as const },
      { content: "modes refactor", status: "completed" as const },
    ];

    await writeTodos(cwd, todos);

    expect(await readTodos(cwd)).toEqual(todos);
    expect(await fs.readFile(todoFilePath(cwd), "utf8")).toContain("wire HookRunner");
  });

  test("readTodos on a missing file returns empty", async () => {
    expect(await readTodos(cwd)).toEqual([]);
  });

  test("a corrupted todo file reads as empty instead of crashing", async () => {
    await fs.mkdir(path.join(cwd, ".stak"), { recursive: true });
    await fs.writeFile(todoFilePath(cwd), "{ not json");

    expect(await readTodos(cwd)).toEqual([]);
  });
});

describe("todoWriteTool", () => {
  test("full-list replacement semantics", async () => {
    await writeTodos(cwd, [
      { content: "old task", status: "pending" },
      { content: "another old", status: "completed" },
    ]);

    const result = await todoWriteTool.execute(
      { todos: [{ content: "new plan", status: "in_progress" }] },
      { cwd },
    );

    expect(result.isError ?? false).toBe(false);
    expect(await readTodos(cwd)).toEqual([
      { content: "new plan", status: "in_progress" },
    ]);
  });

  test("empty list clears and says so", async () => {
    await writeTodos(cwd, [{ content: "task", status: "pending" }]);

    const result = await todoWriteTool.execute({ todos: [] }, { cwd });

    expect(result.isError ?? false).toBe(false);
    expect(result.output).toContain("cleared");
    expect(await readTodos(cwd)).toEqual([]);
  });

  test("output renders the checklist with glyphs", async () => {
    const result = await todoWriteTool.execute(
      {
        todos: [
          { content: "done thing", status: "completed" },
          { content: "current thing", status: "in_progress" },
          { content: "later thing", status: "pending" },
        ],
      },
      { cwd },
    );

    expect(result.output).toContain("☑ done thing");
    expect(result.output).toContain("◐ current thing");
    expect(result.output).toContain("☐ later thing");
  });

  test("rejects an unknown status via schema", () => {
    const parsed = todoWriteTool.schema.safeParse({
      todos: [{ content: "x", status: "yesterday" }],
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects more than 50 items", () => {
    const todos = Array.from({ length: 51 }, (_, i) => ({
      content: `task ${i}`,
      status: "pending" as const,
    }));
    const parsed = todoWriteTool.schema.safeParse({ todos });
    expect(parsed.success).toBe(false);
  });
});

describe("formatTodos summary line", () => {
  test("reports completion count", () => {
    const formatted = formatTodos([
      { content: "a", status: "completed" },
      { content: "b", status: "completed" },
      { content: "c", status: "in_progress" },
      { content: "d", status: "pending" },
    ]);
    expect(formatted).toContain("2/4 done");
  });

  test("empty list renders nothing but the cleared note is upstream", () => {
    expect(formatTodos([])).toBe("");
  });
});

test("is registered among the built-ins as read-only risk", () => {
  const registry = new ToolRegistry({
    cwd,
    permissions: new PermissionManager("plan", cwd),
  });

  // Plan mode approves only read-only tools — if todo_write runs here, its
  // tier is genuinely read-only.
  const result = registry.execute({
    name: "todo_write",
    input: { todos: [{ content: "plan step", status: "pending" }] },
  });
  return expect(result.then((r) => r.isError)).resolves.toBe(false);
});
