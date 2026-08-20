/**
 * Anthropic and OpenAI's model-list endpoints don't report context length —
 * unlike Ollama's `show()`, there is no live source of truth to query. This
 * is a small, honest, prefix-matched table rather than an attempt at
 * completeness: an unrecognized model returns undefined, and the caller is
 * expected to hide the context readout entirely rather than show a guess.
 */
const KNOWN_LIMITS: { prefix: string; contextLength: number }[] = [
  { prefix: "claude-opus-4", contextLength: 200_000 },
  { prefix: "claude-sonnet-4", contextLength: 200_000 },
  { prefix: "claude-haiku-4", contextLength: 200_000 },
  { prefix: "claude-3-7", contextLength: 200_000 },
  { prefix: "claude-3-5", contextLength: 200_000 },
  { prefix: "claude-3", contextLength: 200_000 },
  { prefix: "gpt-4o", contextLength: 128_000 },
  { prefix: "gpt-4-turbo", contextLength: 128_000 },
  { prefix: "gpt-4.1", contextLength: 1_047_576 },
  { prefix: "gpt-4", contextLength: 8_192 },
  { prefix: "o1", contextLength: 200_000 },
  { prefix: "o3", contextLength: 200_000 },
  { prefix: "o4", contextLength: 200_000 },
];

export function lookupContextLength(model: string): number | undefined {
  return KNOWN_LIMITS.find((entry) => model.startsWith(entry.prefix))?.contextLength;
}
