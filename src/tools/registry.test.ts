import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { HookRunner } from "../hooks/runner.js";
import { PermissionManager } from "../permissions/manager.js";
import { ToolRegistry } from "./registry.js";
import type { AnyTool, ToolExecContext } from "./types.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-registry-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function registry(mode: "plan" | "build" | "auto", extra?: AnyTool[]) {
  const permissions = new PermissionManager(mode, cwd);
  return { registry: new ToolRegistry({ cwd, permissions, extra }), permissions };
}

function hookStub(
  impl: (
    phase: "beforeTool" | "afterTool",
  ) => { blocked: boolean; reasons: string[]; notices: string[] },
): HookRunner {
  return { run: vi.fn(impl) } as unknown as HookRunner;
}

function probeTool(calls: string[]): AnyTool {
  return {
    name: "probe",
    description: "records that it executed",
    schema: z.object({}),
    riskTier: "edit",
    async execute(_args: undefined, _ctx: ToolExecContext) {
      calls.push("tool");
      return { output: "probed" };
    },
  } as unknown as AnyTool;
}

test("beforeTool veto blocks execution and reports the hook reason", async () => {
  const hooks = hookStub((phase) =>
    phase === "beforeTool"
      ? { blocked: true, reasons: ['blocked by hook "guard": no writes'], notices: [] }
      : { blocked: false, reasons: [], notices: [] },
  );
  const calls: string[] = [];
  const tools = new ToolRegistry({
    cwd,
    permissions: new PermissionManager("auto", cwd),
    hooks,
    extra: [probeTool(calls)],
  });

  const result = await tools.execute({ name: "probe", input: {} });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("guard");
  expect(result.output).toContain("no writes");
  expect(calls).toEqual([]);
});

test("approved calls run beforeTool, then the tool, then afterTool in order", async () => {
  const order: string[] = [];
  const hooks = hookStub((phase) => {
    order.push(phase);
    return { blocked: false, reasons: [], notices: [] };
  });
  const tools = new ToolRegistry({
    cwd,
    permissions: new PermissionManager("auto", cwd),
    hooks,
    extra: [probeTool(order)],
  });

  await tools.execute({ name: "probe", input: {} });

  expect(order).toEqual(["beforeTool", "tool", "afterTool"]);
});

test("afterTool notices ride along on a successful result", async () => {
  const hooks = hookStub((phase) =>
    phase === "afterTool"
      ? { blocked: false, reasons: [], notices: ['hook "fmt" failed: exploded'] }
      : { blocked: false, reasons: [], notices: [] },
  );
  const tools = new ToolRegistry({
    cwd,
    permissions: new PermissionManager("auto", cwd),
    hooks,
    extra: [],
  });

  const result = await tools.execute({ name: "read", input: { path: "whatever.txt" } });

  expect(result.notices).toEqual(['hook "fmt" failed: exploded']);
});

test("plan-denied calls never invoke hooks", async () => {
  const hooks = hookStub(() => ({ blocked: false, reasons: [], notices: [] }));
  const runSpy = hooks.run as ReturnType<typeof vi.fn>;
  const tools = new ToolRegistry({
    cwd,
    permissions: new PermissionManager("plan", cwd),
    hooks,
    extra: [],
  });

  const result = await tools.execute({
    name: "write",
    input: { path: "blocked.txt", content: "nope" },
  });

  expect(result.isError).toBe(true);
  expect(runSpy).not.toHaveBeenCalled();
});

test("exposes every built-in tool with a JSON schema", () => {
  const definitions = registry("auto").registry.definitions();
  const names = definitions.map((d) => d.name).sort();

  expect(names).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
  for (const definition of definitions) {
    expect(definition.jsonSchema).toHaveProperty("type", "object");
    expect(definition.description).not.toBe("");
  }
});

test("prefers an explicit jsonSchema over the zod-derived one", () => {
  const fakeTool = {
    name: "fake-mcp-tool",
    description: "a tool with a provider-supplied schema",
    schema: z.object({}).passthrough(),
    jsonSchema: { type: "object", properties: { foo: { type: "string" } } },
    riskTier: "read-only",
    async execute() {
      return { output: "" };
    },
  } as unknown as AnyTool;

  const { registry: tools } = registry("auto", [fakeTool]);

  const definition = tools.definitions().find((d) => d.name === fakeTool.name);

  expect(definition?.jsonSchema).toEqual({
    type: "object",
    properties: { foo: { type: "string" } },
  });
});

test("derives jsonSchema via zodToJsonSchema when jsonSchema is absent", () => {
  const fakeTool = {
    name: "fake-zod-only-tool",
    description: "a tool without a provider-supplied schema",
    schema: z.object({ bar: z.string() }),
    riskTier: "read-only",
    async execute() {
      return { output: "" };
    },
  } as unknown as AnyTool;

  const { registry: tools } = registry("auto", [fakeTool]);

  const definition = tools.definitions().find((d) => d.name === fakeTool.name);

  expect(definition?.jsonSchema).toMatchObject({
    type: "object",
    properties: { bar: { type: "string" } },
    required: ["bar"],
  });
});

test("a denied call leaves the filesystem untouched", async () => {
  const { registry: tools, permissions } = registry("build");
  permissions.setPrompter(async () => "denied");

  // In build mode only bash still prompts, so denial is exercised there.
  const result = await tools.execute({
    name: "bash",
    input: { command: "echo should-not-run > blocked.txt" },
  });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("declined");
  await expect(fs.access(path.join(cwd, "blocked.txt"))).rejects.toThrow();
});

test("an approved call runs", async () => {
  const { registry: tools, permissions } = registry("build");
  permissions.setPrompter(async () => "approved");

  const result = await tools.execute({
    name: "write",
    input: { path: "allowed.txt", content: "written" },
  });

  expect(result.isError).toBe(false);
  expect(await fs.readFile(path.join(cwd, "allowed.txt"), "utf8")).toBe("written");
});

test("rejects malformed arguments before reaching the tool", async () => {
  const { registry: tools } = registry("auto");

  const result = await tools.execute({ name: "read", input: { wrong: "shape" } });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("Invalid arguments");
});

test("reports an unknown tool without throwing", async () => {
  const { registry: tools } = registry("auto");

  const result = await tools.execute({ name: "nonexistent", input: {} });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("No such tool");
});

test("forwards an abort signal through to the tool's execute context", async () => {
  const { registry: tools } = registry("auto");
  const controller = new AbortController();

  // bashTool has real abort-handling code (ctx.signal?.addEventListener) that
  // kills the child process and resolves immediately on abort, instead of
  // waiting out its (much longer) timeout_ms. Run it out of os.tmpdir()
  // rather than the per-test mkdtemp `cwd` above: on Windows, killing a
  // shell:true child kills the shell but can leave the grandchild `node`
  // process (which still holds the directory as its own cwd) running for a
  // few more seconds, and afterEach's rmdir of `cwd` would otherwise race it.
  const promise = tools.execute(
    {
      name: "bash",
      input: {
        command: `node -e "setTimeout(() => {}, 5000)"`,
        timeout_ms: 10_000,
        cwd: os.tmpdir(),
      },
    },
    controller.signal,
  );

  // Give the child process a moment to actually spawn and register its
  // abort listener before firing -- aborting the signal before that
  // listener exists would be a no-op (addEventListener on an
  // already-aborted signal never fires retroactively).
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort();
  const result = await promise;

  expect(result.isError).toBe(true);
  expect(result.output).toContain("interrupted");
}, 10_000);
