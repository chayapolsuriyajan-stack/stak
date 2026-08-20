import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Message } from "../agent/types.js";
import { assistantText, userText } from "../agent/types.js";
import { toDisplayMessages } from "../tui/history.js";
import { findLatestSession, findSessionById, listSessions, loadSession } from "./resume.js";
import { SessionStore } from "./store.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-session-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function store() {
  return new SessionStore({ provider: "ollama", model: "test-model", cwd });
}

describe("writing", () => {
  test("writes a meta record before the first message", async () => {
    const session = store();
    session.append(userText("hello"));
    await session.flush();

    const lines = (await fs.readFile(session.filePath, "utf8")).trim().split("\n");
    const meta = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(meta["type"]).toBe("meta");
    expect(meta["provider"]).toBe("ollama");
    expect(meta["model"]).toBe("test-model");
  });

  test("appends one line per message", async () => {
    const session = store();
    session.append(userText("one"));
    session.append(assistantText("two"));
    await session.flush();

    const lines = (await fs.readFile(session.filePath, "utf8")).trim().split("\n");

    // A meta record plus the two messages.
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("writes only one meta record across many appends", async () => {
    const session = store();
    session.append(userText("one"));
    session.append(userText("two"));
    session.append(userText("three"));
    await session.flush();

    const lines = (await fs.readFile(session.filePath, "utf8")).trim().split("\n");
    const metas = lines.filter((line) => JSON.parse(line).type === "meta");

    expect(metas).toHaveLength(1);
  });
});

describe("resuming", () => {
  test("round-trips history through a file", async () => {
    const session = store();
    session.append(userText("hello"));
    session.append(assistantText("hi there"));
    await session.flush();

    const loaded = await loadSession(session.filePath);

    expect(loaded?.history).toHaveLength(2);
    expect(loaded?.model).toBe("test-model");
    expect(loaded?.provider).toBe("ollama");
    expect(loaded?.history[0]).toEqual(userText("hello"));
  });

  test("preserves tool blocks so context survives a resume", async () => {
    const session = store();
    const withTool: Message = {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }],
    };
    session.append(withTool);
    await session.flush();

    const loaded = await loadSession(session.filePath);

    expect(loaded?.history[0]?.content[0]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "read",
      input: { path: "a.txt" },
    });
  });

  test("skips a truncated final line rather than failing the load", async () => {
    const session = store();
    session.append(userText("intact"));
    await session.flush();
    await fs.appendFile(session.filePath, '{"type":"message","mess');

    const loaded = await loadSession(session.filePath);

    expect(loaded?.history).toHaveLength(1);
  });

  test("finds the most recently written session", async () => {
    const first = store();
    first.append(userText("older"));
    await first.flush();

    const second = store();
    second.append(userText("newer"));
    await second.flush();
    // mtime granularity can tie on fast filesystems, so make the order explicit.
    const later = new Date(Date.now() + 10_000);
    await fs.utimes(second.filePath, later, later);

    expect(await findLatestSession(cwd)).toBe(second.filePath);
  });

  test("returns nothing when the project has no sessions", async () => {
    expect(await findLatestSession(cwd)).toBeUndefined();
  });

  test("returns nothing for a missing file", async () => {
    expect(await loadSession(path.join(cwd, "nope.jsonl"))).toBeUndefined();
  });

  test("a resumed session keeps appending to the same file", async () => {
    const original = store();
    original.append(userText("first"));
    await original.flush();

    const loaded = await loadSession(original.filePath);
    expect(loaded).toBeDefined();
    if (!loaded) return;

    const continued = SessionStore.resuming(
      { provider: "ollama", model: "test-model", cwd },
      loaded,
    );
    continued.append(userText("second"));
    await continued.flush();

    expect(continued.filePath).toBe(original.filePath);

    // Reloading must yield the whole conversation, not just the newer half.
    const reloaded = await loadSession(original.filePath);
    expect(reloaded?.history).toHaveLength(2);

    const lines = (await fs.readFile(original.filePath, "utf8")).trim().split("\n");
    const metas = lines.filter((line) => JSON.parse(line).type === "meta");
    expect(metas).toHaveLength(1);
  });

  test("resuming twice preserves the earliest turns", async () => {
    const first = store();
    first.append(userText("one"));
    await first.flush();

    let loaded = await loadSession(first.filePath);
    if (!loaded) throw new Error("expected a session");
    const second = SessionStore.resuming(
      { provider: "ollama", model: "test-model", cwd },
      loaded,
    );
    second.append(userText("two"));
    await second.flush();

    loaded = await loadSession(await findLatestSession(cwd) ?? "");
    if (!loaded) throw new Error("expected a session");
    const third = SessionStore.resuming(
      { provider: "ollama", model: "test-model", cwd },
      loaded,
    );
    third.append(userText("three"));
    await third.flush();

    const final = await loadSession(first.filePath);
    expect(final?.history).toHaveLength(3);
  });
});

describe("findSessionById", () => {
  test("resolves an existing session by its id", async () => {
    const session = store();
    session.append(userText("hi"));
    await session.flush();

    const file = await findSessionById(session.sessionId, cwd);

    expect(file).toBe(session.filePath);
  });

  test("returns nothing for an id that does not exist", async () => {
    expect(await findSessionById("nonexistent-id", cwd)).toBeUndefined();
  });
});

describe("listSessions", () => {
  test("summarizes each session without materializing its full history", async () => {
    const first = store();
    first.append(userText("what is a linked list"));
    first.append(assistantText("A linked list is..."));
    await first.flush();

    const summaries = await listSessions(cwd);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      sessionId: first.sessionId,
      provider: "ollama",
      model: "test-model",
      messageCount: 2,
      preview: "what is a linked list",
    });
  });

  test("lists newest first", async () => {
    const older = store();
    older.append(userText("older"));
    await older.flush();

    const newer = store();
    newer.append(userText("newer"));
    await newer.flush();
    const later = new Date(Date.now() + 10_000);
    await fs.utimes(newer.filePath, later, later);

    const summaries = await listSessions(cwd);

    expect(summaries.map((s) => s.preview)).toEqual(["newer", "older"]);
  });

  test("truncates a long preview", async () => {
    const session = store();
    session.append(userText("x".repeat(200)));
    await session.flush();

    const [summary] = await listSessions(cwd);

    expect(summary?.preview.length).toBeLessThanOrEqual(72);
    expect(summary?.preview.endsWith("...")).toBe(true);
  });

  test("skips a session with no messages yet", async () => {
    // A session file that only ever got the meta line, e.g. the process was
    // killed before the first message flushed.
    const dir = path.join(cwd, ".stak", "sessions");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "empty.jsonl"),
      `${JSON.stringify({ type: "meta", sessionId: "empty", provider: "ollama", model: "m", cwd, startedAt: new Date().toISOString() })}\n`,
    );

    expect(await listSessions(cwd)).toEqual([]);
  });

  test("returns an empty list when the project has no sessions", async () => {
    expect(await listSessions(cwd)).toEqual([]);
  });
});

describe("transcript rebuilding", () => {
  test("renders user and assistant turns", () => {
    const display = toDisplayMessages([userText("hi"), assistantText("hello")]);

    expect(display).toEqual([
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "hello" },
    ]);
  });

  test("attaches a tool result to the call it belongs to", () => {
    const display = toDisplayMessages([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "t1", content: "file body" }],
      },
    ]);

    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      kind: "tool",
      name: "read",
      output: "file body",
    });
  });

  test("ignores a result with no matching call", () => {
    const display = toDisplayMessages([
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "missing", content: "orphan" }],
      },
    ]);

    expect(display).toEqual([]);
  });
});
