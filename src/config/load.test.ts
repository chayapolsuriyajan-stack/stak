import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MODE_CYCLE } from "../permissions/manager.js";
import { loadConfig } from "./load.js";

let cwd: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-config-"));
  for (const key of ["STAK_MODEL", "STAK_PROVIDER", "OLLAMA_HOST", "ANTHROPIC_API_KEY"]) {
    delete process.env[key];
  }
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

async function writeProjectSettings(contents: object) {
  await fs.mkdir(path.join(cwd, ".stak"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".stak", "settings.json"),
    JSON.stringify(contents),
  );
}

describe("defaults", () => {
  test("falls back to Ollama on localhost", async () => {
    const config = await loadConfig({ cwd });

    expect(config.provider).toBe("ollama");
    expect(config.ollamaHost).toBe("http://localhost:11434");
    expect(config.permissionMode).toBe("ask");
  });
});

describe("precedence", () => {
  test("a CLI flag beats project settings", async () => {
    await writeProjectSettings({ defaultModel: "from-project" });

    const config = await loadConfig({ cwd, model: "from-flag" });

    expect(config.model).toBe("from-flag");
  });

  test("project settings beat the environment", async () => {
    process.env["STAK_MODEL"] = "from-env";
    await writeProjectSettings({ defaultModel: "from-project" });

    expect((await loadConfig({ cwd })).model).toBe("from-project");
  });

  test("the environment supplies the model when no project sets one", async () => {
    process.env["STAK_MODEL"] = "from-env";

    expect((await loadConfig({ cwd })).model).toBe("from-env");
  });

  test("an environment variable supplies credentials", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-from-env";

    expect((await loadConfig({ cwd })).anthropicApiKey).toBe("sk-from-env");
  });
});

describe("guardrails", () => {
  test("warns about and ignores credentials in project settings", async () => {
    await writeProjectSettings({ anthropicApiKey: "sk-leaked" });

    const config = await loadConfig({ cwd });

    expect(config.warnings.join(" ")).toContain("anthropicApiKey");
    expect(config.anthropicApiKey).toBeUndefined();
  });

  test("falls back and warns on an unknown provider", async () => {
    const config = await loadConfig({ cwd, provider: "notreal" });

    expect(config.provider).toBe("ollama");
    expect(config.warnings.join(" ")).toContain("notreal");
  });

  test("falls back and warns on an unknown permission mode", async () => {
    await writeProjectSettings({ permissionMode: "reckless" });

    const config = await loadConfig({ cwd });

    expect(config.permissionMode).toBe("ask");
    expect(config.warnings.join(" ")).toContain("reckless");
  });

  test("malformed project settings do not prevent startup", async () => {
    await fs.mkdir(path.join(cwd, ".stak"), { recursive: true });
    await fs.writeFile(path.join(cwd, ".stak", "settings.json"), "{ not json");

    const config = await loadConfig({ cwd });

    expect(config.provider).toBe("ollama");
  });

  test("reads the permission mode from project settings", async () => {
    await writeProjectSettings({ permissionMode: "accept-edits" });

    expect((await loadConfig({ cwd })).permissionMode).toBe("accept-edits");
  });

  // Regression: PermissionManager persisted "plan" (added to MODE_CYCLE) before
  // this validator was updated to accept it, so entering plan mode and
  // relaunching silently dropped back to "ask" with a spurious warning. Every
  // mode in MODE_CYCLE must round-trip, not just the ones a hand-written list
  // happens to remember.
  test.each(MODE_CYCLE)("permission mode %s round-trips through project settings", async (mode) => {
    await writeProjectSettings({ permissionMode: mode });

    const config = await loadConfig({ cwd });

    expect(config.permissionMode).toBe(mode);
    expect(config.warnings).toEqual([]);
  });
});
