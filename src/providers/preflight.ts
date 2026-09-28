import type { Provider } from "./types.js";

/** Long enough for a healthy local server, short enough that a dead or
 * unreachable host (a LAN machine that's switched off) can't stall startup. */
const PREFLIGHT_TIMEOUT_MS = 3000;

export interface PreflightProblem {
  /** One user-facing explanation, including what to do about it. */
  message: string;
}

/**
 * Checks, before the first turn, that the model stak is about to use is
 * actually available — so a fresh install says "run `ollama pull llama3.2`"
 * instead of failing the first prompt with a raw `model 'llama3.2' not found`.
 *
 * Ollama only: it's the default provider, and the one where "the model isn't
 * downloaded" and "the server isn't running" are everyday first-run states.
 * Hosted providers already fail clearly at construction when the API key is
 * missing, and listing their models would cost a network round trip on every
 * launch for little benefit.
 */
export async function checkModelAvailable(
  provider: Provider,
  model: string,
  host: string,
  timeoutMs: number = PREFLIGHT_TIMEOUT_MS,
): Promise<PreflightProblem | undefined> {
  if (provider.name !== "ollama" || !provider.listModels) return undefined;

  let available: string[] | undefined;
  try {
    available = await withTimeout(provider.listModels(), timeoutMs);
  } catch {
    return {
      message:
        `Can't reach Ollama at ${host}. Start it (open the Ollama app, or run ` +
        "`ollama serve`), or point OLLAMA_HOST at the machine that runs it.",
    };
  }

  return describeMissingModel(model, available ?? []);
}

/**
 * Pure half of the check. Ollama reports names with an explicit tag
 * (`llama3.2:latest`) while users usually configure the bare name, so a bare
 * name matches its `:latest` form.
 */
export function describeMissingModel(
  model: string,
  available: string[],
): PreflightProblem | undefined {
  const wanted = model.includes(":") ? [model] : [model, `${model}:latest`];
  if (available.some((name) => wanted.includes(name))) return undefined;

  const have =
    available.length === 0
      ? "You don't have any models yet."
      : `Models you have: ${available.map(stripLatest).join(", ")}.`;

  return {
    message:
      `Model "${model}" isn't downloaded in Ollama. Run \`ollama pull ${model}\`, ` +
      `or switch with --model / "defaultModel" in ~/.stak/config.json. ${have}`,
  };
}

function stripLatest(name: string): string {
  return name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
