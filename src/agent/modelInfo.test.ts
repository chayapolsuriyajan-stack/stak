import { describe, expect, test, vi } from "vitest";
import type { Provider } from "../providers/types.js";
import { createModelInfoCache } from "./modelInfo.js";

function fakeProvider(modelInfo: Provider["modelInfo"]): Provider {
  return {
    name: "ollama",
    modelInfo,
    streamChat: async function* () {},
  };
}

describe("createModelInfoCache", () => {
  test("returns the provider's modelInfo result", async () => {
    const cache = createModelInfoCache();
    const provider = fakeProvider(async () => ({ contextLength: 16_384 }));

    expect(await cache.get(provider, "m")).toEqual({ contextLength: 16_384 });
  });

  test("calls the provider only once for repeated requests of the same model", async () => {
    const cache = createModelInfoCache();
    const modelInfo = vi.fn().mockResolvedValue({ contextLength: 8192 });
    const provider = fakeProvider(modelInfo);

    await cache.get(provider, "m");
    await cache.get(provider, "m");
    await cache.get(provider, "m");

    expect(modelInfo).toHaveBeenCalledTimes(1);
  });

  test("shares one in-flight request across concurrent callers", async () => {
    const cache = createModelInfoCache();
    const modelInfo = vi.fn().mockResolvedValue({ contextLength: 8192 });
    const provider = fakeProvider(modelInfo);

    await Promise.all([
      cache.get(provider, "m"),
      cache.get(provider, "m"),
      cache.get(provider, "m"),
    ]);

    expect(modelInfo).toHaveBeenCalledTimes(1);
  });

  test("keys by provider name and model separately", async () => {
    const cache = createModelInfoCache();
    const modelInfo = vi
      .fn()
      .mockResolvedValueOnce({ contextLength: 1 })
      .mockResolvedValueOnce({ contextLength: 2 });
    const provider = fakeProvider(modelInfo);

    expect(await cache.get(provider, "model-a")).toEqual({ contextLength: 1 });
    expect(await cache.get(provider, "model-b")).toEqual({ contextLength: 2 });
    expect(modelInfo).toHaveBeenCalledTimes(2);
  });

  test("resolves to {} when the provider has no modelInfo", async () => {
    const cache = createModelInfoCache();
    const provider = fakeProvider(undefined);

    expect(await cache.get(provider, "m")).toEqual({});
  });

  test("swallows a rejection rather than throwing or blocking a turn", async () => {
    const cache = createModelInfoCache();
    const provider = fakeProvider(async () => {
      throw new Error("network down");
    });

    await expect(cache.get(provider, "m")).resolves.toEqual({});
  });

  test("invalidate lets a later call re-query the provider", async () => {
    const cache = createModelInfoCache();
    const modelInfo = vi.fn().mockResolvedValue({ contextLength: 8192 });
    const provider = fakeProvider(modelInfo);

    await cache.get(provider, "m");
    cache.invalidate(provider, "m");
    await cache.get(provider, "m");

    expect(modelInfo).toHaveBeenCalledTimes(2);
  });
});
