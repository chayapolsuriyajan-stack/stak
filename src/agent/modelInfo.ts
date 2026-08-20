import type { ModelInfo, Provider } from "../providers/types.js";

/**
 * Memoizes modelInfo() per provider+model, keyed on the in-flight promise
 * rather than the resolved value, so concurrent callers (e.g. mount plus a
 * fast /model switch) share one request instead of firing several. Never
 * throws or blocks a turn: a provider without modelInfo(), or one that
 * fails, resolves to {}.
 */
export function createModelInfoCache() {
  const cache = new Map<string, Promise<ModelInfo>>();

  return {
    async get(provider: Provider, model: string): Promise<ModelInfo> {
      const key = `${provider.name}:${model}`;
      let pending = cache.get(key);

      if (!pending) {
        pending = provider.modelInfo?.(model).catch(() => ({})) ?? Promise.resolve({});
        cache.set(key, pending);
      }

      return pending;
    },

    /** Drops a stale entry, e.g. after a /model switch to a name that was
     * never queried before — cheap insurance against a permanently-cached
     * failure for a model that becomes available later. */
    invalidate(provider: Provider, model: string): void {
      cache.delete(`${provider.name}:${model}`);
    },
  };
}

export type ModelInfoCache = ReturnType<typeof createModelInfoCache>;
