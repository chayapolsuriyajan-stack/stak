import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CommandRegistry, isCommand, parse } from "./dispatch.js";
import { loadMarkdownCommands } from "./loader.js";
import type { CommandContext } from "./types.js";
import type { CompactResult } from "../agent/compact.js";
import type { McpServerStatus } from "../mcp/types.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-cmd-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function context(overrides: Partial<CommandContext> = {}) {
  return {
    clear: vi.fn(),
    getPermissionMode: () => "ask",
    setPermissionMode: vi.fn(async (mode: string) => mode),
    setModel: vi.fn(),
    getModel: () => "test-model",
    describeModel: () => "ollama test-model",
    listModels: vi.fn(async () => undefined),
    listMcpServers: (): McpServerStatus[] => [],
    compact: vi.fn(
      async (): Promise<CompactResult> => ({
        summary: "test summary",
        messagesBefore: 10,
        messagesAfter: 4,
        estimatedTokensBefore: 1000,
        estimatedTokensAfter: 100,
      }),
    ),
    ...overrides,
  };
}

async function writeCommand(dir: string, name: string, contents: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.md`), contents);
}

describe("parsing", () => {
  test("splits a command from its arguments", () => {
    expect(parse("/model gpt-4o")).toEqual({ name: "model", args: "gpt-4o" });
    expect(parse("/help")).toEqual({ name: "help", args: "" });
    expect(parse("/review a b c")).toEqual({ name: "review", args: "a b c" });
  });

  test("recognises command input", () => {
    expect(isCommand("/help")).toBe(true);
    expect(isCommand("  /help")).toBe(true);
    expect(isCommand("what is /help")).toBe(false);
  });
});

describe("builtins", () => {
  test("/help lists the registered commands", async () => {
    const registry = await CommandRegistry.load(cwd);
    const outcome = await registry.run("/help", context());

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("/help");
    expect(outcome.text).toContain("/model");
    expect(outcome.text).toContain("/permissions");
  });

  test("/clear empties the session", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/clear", ctx);

    expect(outcome.kind).toBe("handled");
    expect(ctx.clear).toHaveBeenCalled();
  });

  test("/model without arguments reports the current model", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/model", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("ollama test-model");
    expect(ctx.setModel).not.toHaveBeenCalled();
  });

  test("/model with an argument switches the model", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    await registry.run("/model llama3", ctx);

    expect(ctx.setModel).toHaveBeenCalledWith("llama3");
  });

  test("/model confirms the change with a before/after pair", async () => {
    const registry = await CommandRegistry.load(cwd);
    let current = "test-model";
    const ctx = context({
      describeModel: () => `ollama ${current}`,
      setModel: (next: string) => {
        current = next;
      },
    });

    const outcome = await registry.run("/model llama3", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toBe("Model changed: ollama test-model → ollama llama3");
  });

  test("/model without arguments lists known models with the current one marked", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context({
      listModels: async () => ["llama3", "test-model", "qwen3"],
    });

    const outcome = await registry.run("/model", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("❯ test-model");
    expect(outcome.text).toContain("  llama3");
    expect(outcome.text).toContain("  qwen3");
  });

  test("a rejecting listModels propagates through run, by design", async () => {
    // The command layer does not swallow this itself — the caller (the TUI's
    // command dispatch) is responsible for catching it, since only the caller
    // can turn a rejection into a graceful error notice instead of a crash.
    // This test exists so that responsibility stays visible if this command
    // is ever refactored.
    const registry = await CommandRegistry.load(cwd);
    const ctx = context({
      listModels: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await expect(registry.run("/model", ctx)).rejects.toThrow("network down");
  });

  test("/model explains when the provider cannot list its models", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context({ listModels: async () => undefined });

    const outcome = await registry.run("/model", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("can't list its models");
  });

  test("/permissions rejects an unknown mode", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/permissions reckless", ctx);

    expect(outcome.kind).toBe("error");
    expect(ctx.setPermissionMode).not.toHaveBeenCalled();
  });

  test("/permissions applies a valid mode", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/permissions auto-bypass", ctx);

    expect(outcome.kind).toBe("notice");
    expect(ctx.setPermissionMode).toHaveBeenCalledWith("auto-bypass");
  });

  test("/mcp reports when no servers are configured", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/mcp", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("No MCP servers configured");
  });

  test("/mcp formats connected and failed servers", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context({
      listMcpServers: (): McpServerStatus[] => [
        { name: "filesystem", source: "project", state: "connected", toolCount: 4 },
        {
          name: "github",
          source: "global",
          state: "failed",
          toolCount: 0,
          error: "connection refused",
        },
      ],
    });

    const outcome = await registry.run("/mcp", ctx);

    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toContain("filesystem (project): connected, 4 tools");
    expect(outcome.text).toContain("github (global): failed — connection refused");
  });

  test("/compact with no argument compacts without a focus", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    const outcome = await registry.run("/compact", ctx);

    expect(ctx.compact).toHaveBeenCalledWith(undefined);
    expect(outcome.kind).toBe("notice");
    if (outcome.kind !== "notice") return;
    expect(outcome.text).toMatch(/\d/);
  });

  test("/compact with an argument passes it through as the focus", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context();

    await registry.run("/compact focus on the auth bug", ctx);

    expect(ctx.compact).toHaveBeenCalledWith("focus on the auth bug");
  });

  test("/compact reports a failure as an error instead of throwing", async () => {
    const registry = await CommandRegistry.load(cwd);
    const ctx = context({
      compact: vi.fn(async () => {
        throw new Error("nothing to compact yet");
      }),
    });

    const outcome = await registry.run("/compact", ctx);

    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.text).toContain("nothing to compact yet");
  });

  test("/exit asks the app to quit", async () => {
    const registry = await CommandRegistry.load(cwd);

    expect((await registry.run("/exit", context())).kind).toBe("exit");
  });

  test("an unknown command is reported, not run", async () => {
    const registry = await CommandRegistry.load(cwd);

    const outcome = await registry.run("/nonsense", context());

    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.text).toContain("Unknown command");
  });
});

describe("markdown commands", () => {
  test("substitutes $ARGUMENTS into the body", async () => {
    await writeCommand(
      path.join(cwd, ".stak", "commands"),
      "review",
      "---\ndescription: review code\n---\nReview this file: $ARGUMENTS",
    );

    const registry = await CommandRegistry.load(cwd);
    const outcome = await registry.run("/review src/app.ts", context());

    expect(outcome.kind).toBe("prompt");
    if (outcome.kind !== "prompt") return;
    expect(outcome.text).toBe("Review this file: src/app.ts");
  });

  test("appends arguments when the body has no placeholder", async () => {
    await writeCommand(
      path.join(cwd, ".stak", "commands"),
      "explain",
      "---\ndescription: explain something\n---\nExplain the following.",
    );

    const registry = await CommandRegistry.load(cwd);
    const outcome = await registry.run("/explain the parser", context());

    expect(outcome.kind).toBe("prompt");
    if (outcome.kind !== "prompt") return;
    expect(outcome.text).toContain("Explain the following.");
    expect(outcome.text).toContain("the parser");
  });

  test("reads the description from frontmatter", async () => {
    await writeCommand(
      path.join(cwd, ".stak", "commands"),
      "audit",
      "---\ndescription: audit dependencies\n---\nAudit them.",
    );

    const registry = await CommandRegistry.load(cwd);

    expect(registry.list()).toContainEqual({
      name: "audit",
      description: "audit dependencies",
    });
  });

  test("a builtin cannot be shadowed by a markdown file", async () => {
    await writeCommand(
      path.join(cwd, ".stak", "commands"),
      "exit",
      "---\ndescription: not the real exit\n---\nHijacked.",
    );

    const registry = await CommandRegistry.load(cwd);

    expect((await registry.run("/exit", context())).kind).toBe("exit");
  });

  test("ignores non-markdown files", async () => {
    const dir = path.join(cwd, ".stak", "commands");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "notes.txt"), "not a command");

    expect((await loadMarkdownCommands(cwd)).commands).toEqual([]);
  });

  test("a missing commands directory is not an error", async () => {
    expect((await loadMarkdownCommands(cwd)).commands).toEqual([]);
  });

  test("a project command shadows a global one of the same name", async () => {
    const global = path.join(cwd, "global-commands");
    const project = path.join(cwd, ".stak", "commands");
    await writeCommand(global, "review", "---\ndescription: global\n---\nGlobal body.");
    await writeCommand(project, "review", "---\ndescription: project\n---\nProject body.");

    const { commands: loaded } = await loadMarkdownCommands(cwd, [global, project]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.description).toBe("project");
  });

  test("malformed frontmatter is skipped rather than crashing the load", async () => {
    await writeCommand(
      path.join(cwd, ".stak", "commands"),
      "broken",
      "---\ndescription: [unclosed\nother: value\n---\nBody.",
    );

    const loaded = await loadMarkdownCommands(cwd);

    expect(loaded.commands).toEqual([]);
    expect(loaded.warnings.join(" ")).toContain("broken");
  });

  test("one bad command does not prevent the others loading", async () => {
    const dir = path.join(cwd, ".stak", "commands");
    await writeCommand(dir, "broken", "---\ndescription: [unclosed\nother: value\n---\nBody.");
    await writeCommand(dir, "good", "---\ndescription: fine\n---\nUseful body.");

    const loaded = await loadMarkdownCommands(cwd, [dir]);

    expect(loaded.commands.map((c) => c.name)).toEqual(["good"]);
    expect(loaded.warnings).toHaveLength(1);
  });

  test("two files with identical bad frontmatter are both skipped", async () => {
    // gray-matter's content cache returns empty data on a repeat parse of the
    // same malformed input instead of throwing, so without the cache disabled
    // the second file would load silently.
    const dir = path.join(cwd, ".stak", "commands");
    const bad = "---\ndescription: [unclosed\nother: value\n---\nBody.";
    await writeCommand(dir, "broken-one", bad);
    await writeCommand(dir, "broken-two", bad);

    const loaded = await loadMarkdownCommands(cwd, [dir]);

    expect(loaded.commands).toEqual([]);
    expect(loaded.warnings).toHaveLength(2);
  });

  test("a global command is available when the project has none", async () => {
    const global = path.join(cwd, "global-commands");
    await writeCommand(global, "audit", "---\ndescription: global audit\n---\nAudit.");

    const { commands: loaded } = await loadMarkdownCommands(cwd, [
      global,
      path.join(cwd, ".stak", "commands"),
    ]);

    expect(loaded.map((c) => c.name)).toEqual(["audit"]);
  });
});
