import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describeFsError } from "./read.js";
import type { Tool } from "./types.js";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const STATUSES = ["pending", "in_progress", "completed"] as const;

const MAX_ITEMS = 50;
const MAX_CONTENT_LENGTH = 500;

const schema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1).max(MAX_CONTENT_LENGTH),
        status: z.enum(STATUSES),
      }),
    )
    .max(MAX_ITEMS)
    .describe(
      'The complete todo list. Replaces whatever was there before — always send the full list, with exactly one item "in_progress" while working.',
    ),
});

export function todoFilePath(cwd: string): string {
  return path.join(cwd, ".stak", "todo.json");
}

export async function readTodos(cwd: string): Promise<TodoItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(todoFilePath(cwd), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is TodoItem =>
        typeof (item as TodoItem)?.content === "string" &&
        (STATUSES as readonly string[]).includes((item as TodoItem)?.status),
    );
  } catch {
    return [];
  }
}

export async function writeTodos(cwd: string, todos: TodoItem[]): Promise<void> {
  const file = todoFilePath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(todos, null, 2)}\n`, "utf8");
}

/** ☑ done · ◐ active · ☐ waiting — one line per item under a count header. */
export function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) return "";
  const glyph = { completed: "☑", in_progress: "◐", pending: "☐" } as const;
  const done = todos.filter((t) => t.status === "completed").length;
  const lines = todos.map((t) => `  ${glyph[t.status]} ${t.content}`);
  return [`${done}/${todos.length} done`, ...lines].join("\n");
}

export const todoWriteTool: Tool<z.infer<typeof schema>> = {
  name: "todo_write",
  description:
    "Maintain a short task list for multi-step work. Send the complete list every time; mark items completed as you go and keep exactly one item in_progress. The list lives outside the project files (.stak/todo.json) and survives the session.",
  // Deliberately read-only tier: this writes stak's own bookkeeping file,
  // never project content, so plan mode may still draft a todo list.
  riskTier: "read-only",
  schema,

  async execute(args, ctx) {
    try {
      await writeTodos(ctx.cwd, args.todos);
    } catch (error) {
      return { output: describeFsError(error, todoFilePath(ctx.cwd)), isError: true };
    }

    if (args.todos.length === 0) {
      return { output: "Todo list cleared." };
    }
    return { output: formatTodos(args.todos) };
  },
};
