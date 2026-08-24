# P2: todo + webfetch Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `todo_write` list-tracking tool and a keyless `webfetch` tool, registered alongside the built-ins.

**Architecture:** Both follow the existing `Tool<T>` pattern in `src/tools/` (zod schema + execute). Todo state persists to `.stak/todo.json`; webfetch uses only `node:fetch` plus a built-in HTML reducer. Registration happens in `ToolRegistry`'s builtins array; `/todo` is a builtin command; the system prompt gains one paragraph.

**Tech Stack:** No new dependencies (spec constraint).

## Global Constraints

- No new runtime npm dependencies.
- ESM `.js` import suffixes; vitest; `npm test && npm run typecheck` green per task.
- Cross-platform tests (Windows dev box); no POSIX-only shell in tests.
- riskTier for both tools: `"read-only"` (todo writes stak bookkeeping, not project files; webfetch is network read — both usable in plan mode).

---

### Task 1: todo tool

**Files:**
- Create: `src/tools/todo.ts`, `src/tools/todo.test.ts`
- Modify: `src/tools/registry.ts` (builtins), `src/agent/systemPrompt.ts`, `src/agent/systemPrompt.test.ts`

**Interfaces:**
```ts
// src/tools/todo.ts exports for reuse by /todo command and /clear reset:
export interface TodoItem { content: string; status: "pending" | "in_progress" | "completed" }
export function todoFilePath(cwd: string): string            // <cwd>/.stak/todo.json
export async function readTodos(cwd: string): Promise<TodoItem[]>
export async function writeTodos(cwd: string, todos: TodoItem[]): Promise<void>
export function formatTodos(todos: TodoItem[]): string        // checklist rendering
export const todoWriteTool: Tool<{ todos: TodoItem[] }>
```
Schema: `{ todos: [{ content: string(min 1), status: enum }] }`, max 50 items. Execute does full-list replacement and returns `formatTodos` output. Empty list clears the file's contents (writes `[]`) and reports "Todo list cleared."

- [ ] Write failing tests (round-trip write/read, replacement semantics, empty-array clear, formatTodos glyphs ☑/◐/☐, registry exposes schema) → run FAIL
- [ ] Implement todo.ts + register in registry builtins + one system-prompt paragraph ("Use todo_write for multi-step work…keep exactly one task in_progress") + test updates → run PASS
- [ ] Commit "Add todo_write tool with .stak/todo.json persistence"

### Task 2: /todo command + /clear reset

**Files:**
- Modify: `src/commands/builtins.ts`, `src/tui/App.tsx` (clear path), `src/commands/commands.test.ts`

**Interfaces:**
- CommandContext gains nothing; `/todo` reads via `readTodos(cwd)` — cwd reaches builtins through a new optional App prop `todoDir?: string` defaulting to ctx-provided `projectCwd`. Simplest: add `getProjectCwd: () => string` to CommandContext (App already has `cwd` prop).

- [ ] Failing tests: "/todo shows the current checklist", "/todo on an empty list says none", "/clear resets the todo file"
- [ ] Implement; run PASS
- [ ] Commit "Add /todo command and reset it on /clear"

### Task 3: webfetch tool

**Files:**
- Create: `src/tools/webfetch.ts`, `src/tools/webfetch.test.ts`
- Modify: `src/tools/registry.ts`

**Interfaces:**
```ts
export const WEBFETCH_DEFAULT_MAX_CHARS = 20_000;
export function htmlToText(html: string): string   // exported for direct tests
export const webfetchTool: Tool<{ url: string; maxChars?: number }>
```
Guards: protocol http/https only; content-type must start `text/` (covers text/html); download cap 5 MB; timeout 30s via AbortSignal.timeout; output truncated at maxChars with `\n\n… output truncated at N characters.` footer. Reducer: strip `<script>`/`<style>` blocks and HTML comments first; convert `<br>/<p>/<div>/li/h1-h6` boundaries to newlines; keep anchors as `[text](href)`; strip all remaining tags; decode the five named entities (&amp; &lt; &gt; &quot; &#39;) and numeric `&#NNN;`; collapse runs of blank lines to one blank line and trim.

- [ ] Failing tests using local fixtures served by `node:http` on 127.0.0.1 ephemeral port (html→text reduction cases incl. script/style/comment removal, anchor retention, entity decode; wrong content-type rejected; truncation footer; non-http(s) URL rejected) → run FAIL
- [ ] Implement + register → run PASS
- [ ] Full suite + typecheck green
- [ ] Commit "Add keyless webfetch tool"

## Self-Review Notes

- Spec section 3 fully covered; search explicitly out of scope.
- `formatTodos` glyph contract reused later by P4's todo card renderer.
