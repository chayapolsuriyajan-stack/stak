import { describe, expect, test } from "vitest";
import type { ResolvedConfig } from "../config/types.js";
import { createProvider } from "./registry.js";

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    provider: "ollama",
    model: "test-model",
    permissionMode: "build",
    ollamaHost: "http://localhost:11434",
    mcpServers: [],
    hooks: { beforeTool: [], afterTool: [] },
    autoCompact: true,
    autoCompactThreshold: 0.85,
    warnings: [],
    ...overrides,
  };
}

describe("provider selection", () => {
  test("builds the Ollama provider without any credentials", () => {
    expect(createProvider(config()).name).toBe("ollama");
  });

  test("builds the Anthropic provider when a key is present", () => {
    const provider = createProvider(
      config({ provider: "anthropic", anthropicApiKey: "sk-test" }),
    );

    expect(provider.name).toBe("anthropic");
  });

  test("builds the OpenAI provider when a key is present", () => {
    const provider = createProvider(
      config({ provider: "openai", openaiApiKey: "sk-test" }),
    );

    expect(provider.name).toBe("openai");
  });

  test("explains which key is missing rather than failing obscurely", () => {
    expect(() => createProvider(config({ provider: "anthropic" }))).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => createProvider(config({ provider: "openai" }))).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  test("a missing key for one provider does not block another", () => {
    // Only Ollama is selected, so absent Anthropic and OpenAI keys are fine.
    expect(() => createProvider(config())).not.toThrow();
  });
});
