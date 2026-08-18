/**
 * Scratch harness for exercising the agent loop without the TUI.
 * Usage: tsx src/dev-cli.ts "your prompt"
 */
import { runTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";
import type { Message } from "./agent/types.js";
import type { Provider } from "./providers/types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OllamaProvider } from "./providers/ollama.js";

const prompt = process.argv.slice(2).join(" ");
if (prompt === "") {
  console.error('Usage: tsx src/dev-cli.ts "your prompt"');
  process.exit(1);
}

const providerName = process.env["STAK_PROVIDER"] ?? "ollama";
let provider: Provider;
let defaultModel: string;

if (providerName === "anthropic") {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  provider = new AnthropicProvider({ apiKey });
  defaultModel = "claude-sonnet-4-5";
} else {
  provider = new OllamaProvider({ host: process.env["OLLAMA_HOST"] });
  defaultModel = "qwen3.8-iq4xs";
}

const history: Message[] = [];
const ctx = {
  provider,
  model: process.env["STAK_MODEL"] ?? defaultModel,
  systemPrompt: buildSystemPrompt({ cwd: process.cwd() }),
  history,
};

for await (const event of runTurn(ctx, prompt)) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text);
      break;
    case "tool-call-start":
      process.stdout.write(`\n[tool] ${event.name} ${JSON.stringify(event.input)}\n`);
      break;
    case "tool-call-result":
      process.stdout.write(`[tool result] ${event.output}\n`);
      break;
    case "turn-complete":
      process.stdout.write("\n");
      break;
    case "error":
      process.stderr.write(`\nError: ${event.error.message}\n`);
      process.exitCode = 1;
      break;
  }
}
