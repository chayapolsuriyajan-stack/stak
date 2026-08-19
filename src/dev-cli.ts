/**
 * Scratch harness for exercising the agent loop without the TUI.
 * Usage: tsx src/dev-cli.ts "your prompt"
 */
import { runTurn } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";
import type { Message } from "./agent/types.js";
import { PermissionManager } from "./permissions/manager.js";
import { findLatestSession, loadSession } from "./sessions/resume.js";
import { SessionStore } from "./sessions/store.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OllamaProvider } from "./providers/ollama.js";
import type { Provider } from "./providers/types.js";
import { loadSkills } from "./skills/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { createSkillTool } from "./tools/skillTool.js";
import type { AnyTool } from "./tools/types.js";

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

const cwd = process.cwd();
// The harness has no UI to prompt with, so it runs unattended.
const permissions = new PermissionManager("auto-bypass", cwd);
const { skills } = await loadSkills(cwd);
const tools = new ToolRegistry({
  cwd,
  permissions,
  extra: [createSkillTool(skills) as unknown as AnyTool],
});

const shouldResume = process.env["STAK_CONTINUE"] === "1";
const previous = shouldResume ? await findLatestSession(cwd) : undefined;
const resumed = previous ? await loadSession(previous) : undefined;

const model = process.env["STAK_MODEL"] ?? resumed?.model ?? defaultModel;
const history: Message[] = resumed?.history ?? [];
const sessionMeta = { provider: provider.name, model, cwd };
const store = resumed
  ? SessionStore.resuming(sessionMeta, resumed)
  : new SessionStore(sessionMeta);

if (resumed) {
  process.stdout.write(`[resumed ${resumed.history.length} messages]\n`);
}

const ctx = {
  provider,
  model,
  systemPrompt: buildSystemPrompt({ cwd, skills }),
  history,
  tools: tools.definitions(),
  executeTool: (call: { id: string; name: string; input: unknown }) =>
    tools.execute(call),
  onMessage: (message: Message) => store.append(message),
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
      process.stdout.write(
        `[result${event.isError ? " error" : ""}] ${event.output.split("\n").slice(0, 5).join("\n")}\n`,
      );
      break;
    case "usage": {
      const tokPerSec =
        event.elapsedMs >= 100 ? event.outputTokens / (event.elapsedMs / 1000) : 0;
      process.stdout.write(
        `[usage] in=${event.inputTokens} out=${event.outputTokens} ${tokPerSec.toFixed(1)} tok/s\n`,
      );
      break;
    }
    case "turn-complete":
      process.stdout.write("\n");
      break;
    case "interrupted":
      process.stdout.write("\n[interrupted]\n");
      break;
    case "error":
      process.stderr.write(`\nError: ${event.error.message}\n`);
      process.exitCode = 1;
      break;
  }
}

await store.flush();
