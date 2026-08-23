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
    expect(config.permissionMode).toBe("build");
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

    expect(config.permissionMode).toBe("build");
    expect(config.warnings.join(" ")).toContain("reckless");
  });

  test("malformed project settings do not prevent startup", async () => {
    await fs.mkdir(path.join(cwd, ".stak"), { recursive: true });
    await fs.writeFile(path.join(cwd, ".stak", "settings.json"), "{ not json");

    const config = await loadConfig({ cwd });

    expect(config.provider).toBe("ollama");
  });

  // v0.3 removed ask/accept-edits/auto-bypass; persisted settings using them
  // must migrate instead of being rejected as unknown.
  describe("removed-mode migration", () => {
    test.each([
      ["ask", "build"],
      ["accept-edits", "build"],
      ["auto-bypass", "auto"],
    ])("permission mode %s migrates to %s with a warning", async (from, to) => {
      await writeProjectSettings({ permissionMode: from });

      const config = await loadConfig({ cwd });

      expect(config.permissionMode).toBe(to);
      expect(config.warnings.join(" ")).toContain(from);
      expect(config.warnings.join(" ")).toContain(to);
    });

    test("an unset permission mode falls back to build with no warning", async () => {
      const config = await loadConfig({ cwd });

      expect(config.permissionMode).toBe("build");
      expect(
        config.warnings.filter((warning) => warning.includes("mode")),
      ).toEqual([]);
    });
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

describe("autoCompact", () => {
  test("defaults to true and 0.85 when unset", async () => {
    const config = await loadConfig({ cwd });

    expect(config.autoCompact).toBe(true);
    expect(config.autoCompactThreshold).toBe(0.85);
    expect(config.warnings).toEqual([]);
  });

  test("project settings override global defaults", async () => {
    await writeProjectSettings({ autoCompact: false, autoCompactThreshold: 0.7 });

    const config = await loadConfig({ cwd });

    expect(config.autoCompact).toBe(false);
    expect(config.autoCompactThreshold).toBe(0.7);
  });

  test.each([1.5, 0, -0.1])(
    "an out-of-range threshold %s warns and falls back to 0.85",
    async (threshold) => {
      await writeProjectSettings({ autoCompactThreshold: threshold });

      const config = await loadConfig({ cwd });

      expect(config.autoCompactThreshold).toBe(0.85);
      expect(config.warnings.join(" ")).toContain("autoCompactThreshold");
    },
  );

  test("a valid custom threshold is used as-is with no warning", async () => {
    await writeProjectSettings({ autoCompactThreshold: 0.7 });

    const config = await loadConfig({ cwd });

    expect(config.autoCompactThreshold).toBe(0.7);
    expect(config.warnings).toEqual([]);
  });
});

// Global config (~/.stak/config.json) is resolved via os.homedir() with no
// cwd-relative override in src/config/paths.ts, so — unlike project
// settings — it cannot be pointed at a temp directory without touching the
// real user's home directory. Global-sourced mcpServers merging is covered
// instead by parseMcpServers/mergeMcpServers unit tests in
// src/mcp/config.test.ts; the tests below stick to what loadConfig can
// safely exercise through project settings alone.
describe("mcpServers", () => {
  test("is an empty array when no mcpServers key is present", async () => {
    const config = await loadConfig({ cwd });

    expect(config.mcpServers).toEqual([]);
  });

  test("parses project-only mcpServers into ResolvedConfig.mcpServers", async () => {
    await writeProjectSettings({
      mcpServers: {
        docs: { command: "docs-server" },
      },
    });

    const config = await loadConfig({ cwd });

    expect(config.mcpServers).toEqual([
      { name: "docs", source: "project", config: { type: "stdio", command: "docs-server" } },
    ]);
    expect(config.warnings).toEqual([]);
  });

  test("a malformed project mcpServers entry produces a warning but does not crash loadConfig", async () => {
    await writeProjectSettings({
      mcpServers: {
        broken: { type: "http" },
      },
    });

    const config = await loadConfig({ cwd });

    expect(config.mcpServers).toEqual([]);
    expect(config.warnings.join(" ")).toContain("broken");
  });

  test("mcpServers is not flagged by the secret-leak warning", async () => {
    // Set so this test only exercises the secret-leak check, not the
    // separate (and separately tested, in src/mcp/config.test.ts)
    // missing-env-var warning that a genuinely unset ref would now produce.
    process.env["SOME_TOKEN"] = "set-for-this-test";
    await writeProjectSettings({
      mcpServers: {
        docs: { command: "docs-server", env: { TOKEN: "${SOME_TOKEN}" } },
      },
    });

    const config = await loadConfig({ cwd });

    expect(config.warnings).toEqual([]);
  });
});
