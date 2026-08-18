import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { PermissionManager } from "../permissions/manager.js";
import { ToolRegistry } from "./registry.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-registry-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function registry(mode: "ask" | "accept-edits" | "auto-bypass") {
  const permissions = new PermissionManager(mode, cwd);
  return { registry: new ToolRegistry({ cwd, permissions }), permissions };
}

test("exposes every built-in tool with a JSON schema", () => {
  const definitions = registry("auto-bypass").registry.definitions();
  const names = definitions.map((d) => d.name).sort();

  expect(names).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
  for (const definition of definitions) {
    expect(definition.jsonSchema).toHaveProperty("type", "object");
    expect(definition.description).not.toBe("");
  }
});

test("a denied call leaves the filesystem untouched", async () => {
  const { registry: tools, permissions } = registry("ask");
  permissions.setPrompter(async () => "denied");

  const result = await tools.execute({
    name: "write",
    input: { path: "blocked.txt", content: "should not exist" },
  });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("declined");
  await expect(fs.access(path.join(cwd, "blocked.txt"))).rejects.toThrow();
});

test("an approved call runs", async () => {
  const { registry: tools, permissions } = registry("ask");
  permissions.setPrompter(async () => "approved");

  const result = await tools.execute({
    name: "write",
    input: { path: "allowed.txt", content: "written" },
  });

  expect(result.isError).toBe(false);
  expect(await fs.readFile(path.join(cwd, "allowed.txt"), "utf8")).toBe("written");
});

test("rejects malformed arguments before reaching the tool", async () => {
  const { registry: tools } = registry("auto-bypass");

  const result = await tools.execute({ name: "read", input: { wrong: "shape" } });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("Invalid arguments");
});

test("reports an unknown tool without throwing", async () => {
  const { registry: tools } = registry("auto-bypass");

  const result = await tools.execute({ name: "nonexistent", input: {} });

  expect(result.isError).toBe(true);
  expect(result.output).toContain("No such tool");
});
