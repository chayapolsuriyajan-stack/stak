import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RiskTier } from "../tools/types.js";
import { MODE_CYCLE, PermissionManager } from "./manager.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "stak-perms-"));
}

function request(
  tier: RiskTier,
  toolName = "bash",
): { toolName: string; riskTier: RiskTier; args: unknown } {
  return { toolName, riskTier: tier, args: {} };
}

describe("PermissionManager modes", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = tmpDir();
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("MODE_CYCLE is exactly plan/build/auto", () => {
    expect(MODE_CYCLE).toEqual(["plan", "build", "auto"]);
  });

  test("read-only tools never prompt in any mode", async () => {
    for (const mode of MODE_CYCLE) {
      const manager = new PermissionManager(mode, cwd);
      expect(await manager.check(request("read-only"))).toBe("approved");
    }
  });

  test("plan denies edit and bash outright without prompting", async () => {
    const manager = new PermissionManager("plan", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("denied");
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
    expect(prompter).not.toHaveBeenCalled();
  });

  test("build runs edits silently, still asks for bash", async () => {
    const manager = new PermissionManager("build", cwd);
    const prompter = vi.fn(async () => "approved" as const);
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();
    expect(await manager.check(request("bash", "bash"))).toBe("approved");
    expect(prompter).toHaveBeenCalledTimes(1);
  });

  test("build denies bash when no prompter is registered", async () => {
    const manager = new PermissionManager("build", cwd);
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
  });

  test("auto approves everything without prompting", async () => {
    const manager = new PermissionManager("auto", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
    expect(await manager.check(request("bash", "bash"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();
  });

  test("prompter denial wins over mode approval", async () => {
    const manager = new PermissionManager("build", cwd);
    manager.setPrompter(async () => "denied");
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
  });

  test("cycleMode walks plan → build → auto → plan and persists", async () => {
    const manager = new PermissionManager("plan", cwd);
    expect(await manager.cycleMode()).toBe("build");
    expect(await manager.cycleMode()).toBe("auto");
    expect(await manager.cycleMode()).toBe("plan");
  });

  test("denialReason explains plan mode deferral", () => {
    const manager = new PermissionManager("plan", cwd);
    expect(manager.denialReason("edit")).toContain("plan mode");
  });

  test("denialReason explains user decline outside plan", () => {
    const manager = new PermissionManager("build", cwd);
    expect(manager.denialReason("bash")).toContain("declined");
  });
});
