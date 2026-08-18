import { Command } from "commander";
import { render } from "ink";
import React from "react";
import type { AgentContext } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";
import type { Message } from "./agent/types.js";
import { loadConfig } from "./config/load.js";
import { createProvider } from "./providers/registry.js";
import { App } from "./tui/App.js";

const VERSION = "0.1.0";

const program = new Command()
  .name("stak")
  .description("A local-first agentic coding CLI")
  .version(VERSION)
  .option("-m, --model <model>", "model to use for this session")
  .option("-p, --provider <provider>", "provider: anthropic, openai, or ollama")
  .option("-c, --continue", "resume the most recent session in this directory")
  .parse();

const options = program.opts<{
  model?: string;
  provider?: string;
  continue?: boolean;
}>();

const config = await loadConfig({
  provider: options.provider,
  model: options.model,
});

let provider;
try {
  provider = createProvider(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const history: Message[] = [];
const ctx: AgentContext = {
  provider,
  model: config.model,
  systemPrompt: buildSystemPrompt({ cwd: process.cwd() }),
  history,
};

for (const warning of config.warnings) {
  console.warn(`stak: ${warning}`);
}

render(React.createElement(App, { ctx, version: VERSION }));
