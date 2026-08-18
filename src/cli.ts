import { Command } from "commander";
import { render } from "ink";
import React from "react";
import type { AgentContext } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";
import type { Message } from "./agent/types.js";
import { CommandRegistry } from "./commands/dispatch.js";
import { loadConfig } from "./config/load.js";
import { PermissionManager } from "./permissions/manager.js";
import { createProvider } from "./providers/registry.js";
import { findLatestSession, loadSession } from "./sessions/resume.js";
import { SessionStore } from "./sessions/store.js";
import { loadSkills } from "./skills/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { createSkillTool } from "./tools/skillTool.js";
import type { AnyTool } from "./tools/types.js";
import { App } from "./tui/App.js";
import { toDisplayMessages } from "./tui/history.js";

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

const cwd = process.cwd();
const permissions = new PermissionManager(config.permissionMode, cwd);
const { skills, warnings: skillWarnings } = await loadSkills(cwd);
const tools = new ToolRegistry({
  cwd,
  permissions,
  extra: [createSkillTool(skills) as unknown as AnyTool],
});

const resumed = options.continue ? await resumeLatest(cwd) : undefined;
if (options.continue && !resumed) {
  console.warn("stak: no previous session found in this directory.");
}

const history: Message[] = resumed?.history ?? [];
const model = resumed?.model ?? config.model;

const sessionMeta = { provider: provider.name, model, cwd };
let store = resumed
  ? SessionStore.resuming(sessionMeta, resumed)
  : new SessionStore(sessionMeta);

const ctx: AgentContext = {
  provider,
  model,
  // The catalog goes in the prompt so the model knows a skill exists before it
  // has any reason to call the tool.
  systemPrompt: buildSystemPrompt({ cwd, skills }),
  history,
  tools: tools.definitions(),
  executeTool: (call) => tools.execute(call),
  onMessage: (message) => store.append(message),
};

async function resumeLatest(dir: string) {
  const file = await findLatestSession(dir);
  return file ? loadSession(file) : undefined;
}

const commands = await CommandRegistry.load(cwd);

for (const warning of [...config.warnings, ...skillWarnings, ...commands.warnings]) {
  console.warn(`stak: ${warning}`);
}

render(
  React.createElement(App, {
    ctx,
    permissions,
    commands,
    version: VERSION,
    initialMessages: resumed ? toDisplayMessages(resumed.history) : [],
    onNewSession: () => {
      store = new SessionStore({ provider: provider.name, model: ctx.model, cwd });
    },
  }),
);
