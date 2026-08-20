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
import type { Provider } from "./providers/types.js";
import type { SessionSummary } from "./sessions/resume.js";
import { findLatestSession, findSessionById, listSessions, loadSession } from "./sessions/resume.js";
import { SessionStore } from "./sessions/store.js";
import { loadSkills } from "./skills/loader.js";
import { ToolRegistry } from "./tools/registry.js";
import { createSkillTool } from "./tools/skillTool.js";
import type { AnyTool } from "./tools/types.js";
import { toDisplayMessages } from "./tui/history.js";
import { Root } from "./tui/Root.js";
import type { DisplayMessage } from "./tui/types.js";

const VERSION = "0.1.0";

const program = new Command()
  .name("stak")
  .description("A local-first agentic coding CLI")
  .version(VERSION)
  .option("-m, --model <model>", "model to use for this session")
  .option("-p, --provider <provider>", "provider: anthropic, openai, or ollama")
  .option("-c, --continue", "resume the most recent session in this directory")
  .option(
    "-r, --resume [sessionId]",
    "resume a session: pick interactively, or pass a session id to load it directly",
  )
  .parse();

const options = program.opts<{
  model?: string;
  provider?: string;
  continue?: boolean;
  resume?: string | true;
}>();

const config = await loadConfig({
  provider: options.provider,
  model: options.model,
});

let provider: Provider;
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

// --resume with no id shows a picker built after the TUI mounts, since it
// needs to render something interactive; every other startup path resolves
// its session synchronously up front, same as before.
const showPicker = options.resume === true;

let resumed: Awaited<ReturnType<typeof loadSession>>;
if (typeof options.resume === "string") {
  const file = await findSessionById(options.resume, cwd);
  if (!file) {
    console.error(`stak: no session "${options.resume}" in this directory.`);
    process.exit(1);
  }
  resumed = await loadSession(file);
} else if (options.continue) {
  const file = await findLatestSession(cwd);
  resumed = file ? await loadSession(file) : undefined;
  if (!resumed) console.warn("stak: no previous session found in this directory.");
}

const sessions = showPicker ? await listSessions(cwd) : [];

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

const commands = await CommandRegistry.load(cwd);

for (const warning of [...config.warnings, ...skillWarnings, ...commands.warnings]) {
  console.warn(`stak: ${warning}`);
}

async function resumeSession(session: SessionSummary): Promise<DisplayMessage[]> {
  const loaded = await loadSession(session.filePath);
  if (!loaded) return [];

  ctx.history.length = 0;
  ctx.history.push(...loaded.history);
  if (loaded.model) ctx.model = loaded.model;
  store = SessionStore.resuming({ provider: provider.name, model: ctx.model, cwd }, loaded);

  return toDisplayMessages(loaded.history);
}

render(
  React.createElement(Root, {
    mode: showPicker ? "picker" : "direct",
    sessions,
    ctx,
    permissions,
    commands,
    version: VERSION,
    initialMessages: resumed ? toDisplayMessages(resumed.history) : [],
    onResumeSession: resumeSession,
    onNewSession: () => {
      store = new SessionStore({ provider: provider.name, model: ctx.model, cwd });
    },
  }),
);
