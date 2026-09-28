import { describe, expect, test } from "vitest";
import { checkModelAvailable, describeMissingModel } from "./preflight.js";
import type { Provider } from "./types.js";

function ollama(listModels: () => Promise<string[]>): Provider {
  return {
    name: "ollama",
    listModels,
    async *streamChat() {},
  };
}

describe("describeMissingModel", () => {
  test("a bare name matches its :latest tag", () => {
    expect(describeMissingModel("llama3.2", ["llama3.2:latest"])).toBeUndefined();
  });

  test("an explicit tag must match exactly", () => {
    expect(describeMissingModel("qwen3:8b", ["qwen3:8b"])).toBeUndefined();
    expect(describeMissingModel("qwen3:8b", ["qwen3:latest"])).toBeDefined();
  });

  test("a missing model says how to pull it and lists what's available", () => {
    const problem = describeMissingModel("llama3.2", ["qwen3.8-q3xl:latest", "mistral:7b"]);
    expect(problem?.message).toContain("ollama pull llama3.2");
    // :latest is noise for the user; other tags are meaningful and kept.
    expect(problem?.message).toContain("qwen3.8-q3xl, mistral:7b");
  });

  test("a fresh install with nothing pulled says so", () => {
    expect(describeMissingModel("llama3.2", [])?.message).toContain("don't have any models");
  });
});

describe("checkModelAvailable", () => {
  test("passes when the model is present", async () => {
    const provider = ollama(async () => ["llama3.2:latest"]);
    expect(await checkModelAvailable(provider, "llama3.2", "http://localhost:11434")).toBeUndefined();
  });

  test("reports an unreachable server instead of throwing", async () => {
    const provider = ollama(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    });
    const problem = await checkModelAvailable(provider, "llama3.2", "http://localhost:11434");
    expect(problem?.message).toContain("Can't reach Ollama at http://localhost:11434");
  });

  test("a hung server times out rather than stalling startup", async () => {
    const provider = ollama(() => new Promise<string[]>(() => {}));
    const started = Date.now();
    const problem = await checkModelAvailable(provider, "llama3.2", "http://10.0.0.9:11434", 50);
    expect(problem?.message).toContain("Can't reach Ollama");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("hosted providers are skipped", async () => {
    const provider: Provider = {
      name: "anthropic",
      listModels: async () => {
        throw new Error("should not be called");
      },
      async *streamChat() {},
    };
    expect(await checkModelAvailable(provider, "claude-sonnet-4-5", "")).toBeUndefined();
  });
});
