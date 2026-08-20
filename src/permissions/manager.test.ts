import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RiskTier } from "../tools/types.js";
import { PermissionManager } from "./manager.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-perm-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function request(riskTier: RiskTier) {
  return { toolName: "t", riskTier, args: {} };
}

describe("ask mode", () => {
  test("prompts for edits and commands, but never for reads", async () => {
    const manager = new PermissionManager("ask", cwd);
    const prompter = vi.fn().mockResolvedValue("approved" as const);
    manager.setPrompter(prompter);

    expect(await manager.check(request("read-only"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();

    await manager.check(request("edit"));
    await manager.check(request("bash"));
    expect(prompter).toHaveBeenCalledTimes(2);
  });

  test("passes a denial through to the caller", async () => {
    const manager = new PermissionManager("ask", cwd);
    manager.setPrompter(async () => "denied");

    expect(await manager.check(request("bash"))).toBe("denied");
  });
});

describe("accept-edits mode", () => {
  test("auto-approves edits but still gates commands", async () => {
    const manager = new PermissionManager("accept-edits", cwd);
    const prompter = vi.fn().mockResolvedValue("approved" as const);
    manager.setPrompter(prompter);

    expect(await manager.check(request("edit"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();

    await manager.check(request("bash"));
    expect(prompter).toHaveBeenCalledTimes(1);
  });
});

describe("auto-bypass mode", () => {
  test("approves everything without prompting", async () => {
    const manager = new PermissionManager("auto-bypass", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);

    expect(await manager.check(request("edit"))).toBe("approved");
    expect(await manager.check(request("bash"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();
  });
});

test("denies risky calls when no prompter can ask the user", async () => {
  const manager = new PermissionManager("ask", cwd);

  expect(await manager.check(request("bash"))).toBe("denied");
  expect(await manager.check(request("read-only"))).toBe("approved");
});

test("cycles through the modes strictest to most permissive, then wraps", async () => {
  const manager = new PermissionManager("plan", cwd);

  expect(await manager.cycleMode()).toBe("ask");
  expect(await manager.cycleMode()).toBe("accept-edits");
  expect(await manager.cycleMode()).toBe("auto-bypass");
  expect(await manager.cycleMode()).toBe("plan");
});

describe("plan mode", () => {
  test("denies edits and commands without ever prompting", async () => {
    const manager = new PermissionManager("plan", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);

    expect(await manager.check(request("edit"))).toBe("denied");
    expect(await manager.check(request("bash"))).toBe("denied");
    expect(prompter).not.toHaveBeenCalled();
  });

  test("read-only tools still work normally", async () => {
    const manager = new PermissionManager("plan", cwd);

    expect(await manager.check(request("read-only"))).toBe("approved");
  });

  test("denial reason explains plan mode rather than blaming the user", async () => {
    const manager = new PermissionManager("plan", cwd);

    expect(manager.denialReason("write")).toContain("plan mode");
    expect(manager.denialReason("write")).not.toContain("declined");
  });
});

test("a non-plan denial reason reads as the user declining", async () => {
  const manager = new PermissionManager("ask", cwd);

  expect(manager.denialReason("bash")).toContain("declined");
});

test("persists the mode to the project, not the user's home", async () => {
  const manager = new PermissionManager("ask", cwd);
  await manager.setMode("auto-bypass");

  const written = JSON.parse(
    await fs.readFile(path.join(cwd, ".stak", "settings.json"), "utf8"),
  ) as Record<string, unknown>;

  expect(written["permissionMode"]).toBe("auto-bypass");
});

test("preserves unrelated project settings when persisting", async () => {
  await fs.mkdir(path.join(cwd, ".stak"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".stak", "settings.json"),
    JSON.stringify({ defaultModel: "some-model" }),
  );

  const manager = new PermissionManager("ask", cwd);
  await manager.setMode("accept-edits");

  const written = JSON.parse(
    await fs.readFile(path.join(cwd, ".stak", "settings.json"), "utf8"),
  ) as Record<string, unknown>;

  expect(written["defaultModel"]).toBe("some-model");
  expect(written["permissionMode"]).toBe("accept-edits");
});
