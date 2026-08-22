import fs from "node:fs/promises";
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import type { AgentContext } from "./agent/loop.js";
import { createModelInfoCache } from "./agent/modelInfo.js";
import { buildSystemPrompt } from "./agent/systemPrompt.js";
import type { Message } from "./agent/types.js";
import { CommandRegistry } from "./commands/dispatch.js";
import { loadConfig } from "./config/load.js";
import type { PermissionMode } from "./config/types.js";
import { runHeadless } from "./headless/run.js";
import { resolveInvocation } from "./headless/options.js";
import { readPipedStdin } from "./headless/stdin.js";
import { connectMcpServers } from "./mcp/client.js";
import { appendMemory } from "./memory/append.js";
import { formatMemory } from "./memory/format.js";
import { loadMemory } from "./memory/loader.js";
import { MODE_CYCLE, PermissionManager } from "./permissions/manager.js";
import { createProvider } from "./providers/registry.js";
import type { Provider } from "./providers/types.js";
import { resolveCwd } from "./resolveCwd.js";
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
import { readVersion } from "./version.js";

const VERSION = readVersion(import.meta.url);

const program = new Command()
  .name("stak")
  .description("A local-first agentic coding CLI")
  .version(VERSION)
  .option("-m, --model <model>", "model to use for this session")
  .option("-P, --provider <provider>", "provider: anthropic, openai, or ollama")
  .option(
    "-C, --cwd <path>",
    "directory to operate in, defaults to STAK_CWD or the current directory",
  )
  .option("-c, --continue", "resume the most recent session in this directory")
  .option(
    "-r, --resume [sessionId]",
    "resume a session: pick interactively, or pass a session id to load it directly",
  )
  .option("-p, --print", "run one turn non-interactively and exit (headless mode)")
  .option("--output-format <format>", "output format for --print: text (default), json, or stream-json")
  .option(
    "--permission-mode <mode>",
    `permission mode, --print only (default: the project's configured permission mode); one of ${MODE_CYCLE.join(", ")}`,
  )
  .argument("[prompt...]", "prompt for --print mode")
  .parse();

const options = program.opts<{
  model?: string;
  provider?: string;
  cwd?: string;
  continue?: boolean;
  resume?: string | true;
  print?: boolean;
  outputFormat?: string;
  permissionMode?: string;
}>();

const cwd = resolveCwd({
  flag: options.cwd,
  env: process.env["STAK_CWD"],
  processCwd: process.cwd(),
});

try {
  const stat = await fs.stat(cwd);
  if (!stat.isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`stak: "${cwd}" is not a directory.`);
  process.exit(1);
}

if (
  options.permissionMode !== undefined &&
  !MODE_CYCLE.includes(options.permissionMode as PermissionMode)
) {
  console.error(
    `stak: invalid --permission-mode "${options.permissionMode}". Valid modes: ${MODE_CYCLE.join(", ")}.`,
  );
  process.exit(1);
}

// Only read stdin when --print was actually given. Reading it unconditionally
// regresses the default TUI path: in CI/containers/wrapper processes,
// process.stdin.isTTY is often `undefined` or `false` rather than strictly
// `true`, so a bare `stak` with an inherited pipe on stdin that never closes
// would hang forever waiting for EOF before rendering anything. Nothing on
// the TUI path needs the stdin value.
const stdin =
  options.print === true
    ? await readPipedStdin(process.stdin).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      })
    : undefined;

const invocation = resolveInvocation({
  print: options.print,
  outputFormat: options.outputFormat,
  permissionMode: options.permissionMode,
  positional: program.args,
  stdin,
  resumePicker: options.resume === true,
});

if (invocation.mode === "error") {
  console.error(`stak: ${invocation.message}`);
  process.exit(1);
}

const config = await loadConfig({
  cwd,
  provider: options.provider,
  model: options.model,
});

let memory = await loadMemory(cwd);

let provider: Provider;
try {
  provider = createProvider(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// invocation.permissionMode is only ever set on the "print" branch --
// resolveInvocation rejects --permission-mode outright when --print wasn't
// given, so the TUI always runs with the project's configured mode, never a
// one-shot flag silently carried into an interactive session (and later
// persisted to .stak/settings.json by the first Shift+Tab mode-cycle).
const permissionMode: PermissionMode =
  invocation.mode === "print" && invocation.permissionMode !== undefined
    ? (invocation.permissionMode as PermissionMode)
    : config.permissionMode;
const permissions = new PermissionManager(permissionMode, cwd);
const { skills, warnings: skillWarnings } = await loadSkills(cwd);
const mcp = await connectMcpServers(config.mcpServers);
const mcpWarnings = mcp.statuses
  .filter((status) => status.state === "failed")
  .map((status) => `MCP server "${status.name}" failed to connect: ${status.error}`);
const tools = new ToolRegistry({
  cwd,
  permissions,
  extra: [createSkillTool(skills) as unknown as AnyTool, ...mcp.tools],
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

// Rebuilt whenever plan mode is entered or left, so the model's instructions
// stay in sync with what the tools will actually let it do.
const systemPromptFor = (planMode: boolean) =>
  buildSystemPrompt({ cwd, skills, planMode, memory: formatMemory(memory.files) });

const ctx: AgentContext = {
  provider,
  model,
  // The catalog goes in the prompt so the model knows a skill exists before it
  // has any reason to call the tool.
  systemPrompt: systemPromptFor(permissions.getMode() === "plan"),
  history,
  tools: tools.definitions(),
  executeTool: (call, signal) => tools.execute(call, signal),
  onMessage: (message) => store.append(message),
};

const commands = await CommandRegistry.load(cwd);

// Positional args are only ever consumed by print mode; on the TUI path
// they'd otherwise be silently discarded with no indication of what
// happened to them.
const positionalWarnings =
  invocation.mode === "tui" && program.args.length > 0
    ? [`ignoring command-line text (did you mean to pass --print?): ${program.args.join(" ")}`]
    : [];

for (const warning of [
  ...config.warnings,
  ...skillWarnings,
  ...mcpWarnings,
  ...memory.warnings,
  ...commands.warnings,
  ...positionalWarnings,
]) {
  console.warn(`stak: ${warning}`);
}

if (invocation.mode === "print") {
  const controller = new AbortController();

  // Standard double-Ctrl+C UX: the first SIGINT requests a graceful abort:
  // the second one (once graceful shutdown was already requested) hard-exits
  // immediately rather than waiting on a shutdown that might not be coming.
  let abortRequested = false;
  const onSigint = () => {
    if (abortRequested) {
      process.exit(130);
      return;
    }
    abortRequested = true;
    controller.abort();
  };
  process.on("SIGINT", onSigint);

  // A downstream pipe closing early (`stak -p "..." | head -5`) can raise
  // EPIPE on a write to stdout/stderr; without a listener that's an unhandled
  // error that crashes the process before cleanup runs. Scoped to print mode
  // only — the TUI never writes plain text to these streams this way.
  const swallowStreamError = () => {};
  process.stdout.on("error", swallowStreamError);
  process.stderr.on("error", swallowStreamError);

  let exitCode: number;
  try {
    exitCode = await runHeadless(ctx, {
      prompt: invocation.prompt,
      format: invocation.format,
      sessionId: store.sessionId,
      stdout: process.stdout,
      stderr: process.stderr,
      signal: controller.signal,
    });
  } finally {
    // Always runs, even if runHeadless (or a write inside it) throws — e.g.
    // from that same EPIPE — so MCP child processes and queued session
    // writes are never orphaned.
    await mcp.close();
    await store.flush();
    process.off("SIGINT", onSigint);
    process.stdout.off("error", swallowStreamError);
    process.stderr.off("error", swallowStreamError);
  }

  // Not process.exit(exitCode): stdout/stderr writes are async (always for
  // pipes, and for files on Windows), and process.exit doesn't wait for them
  // to flush, so a large `--output-format json` result can be silently
  // truncated. Setting exitCode and returning lets Node flush pending writes
  // and exit on its own once the event loop drains — the SIGINT listener
  // above (now removed) was the only thing that could have kept it alive.
  process.exitCode = exitCode;
} else {
  async function resumeSession(session: SessionSummary): Promise<DisplayMessage[]> {
    const loaded = await loadSession(session.filePath);
    if (!loaded) return [];

    ctx.history.length = 0;
    ctx.history.push(...loaded.history);
    if (loaded.model) ctx.model = loaded.model;
    store = SessionStore.resuming({ provider: provider.name, model: ctx.model, cwd }, loaded);

    return toDisplayMessages(loaded.history);
  }

  const instance = render(
    React.createElement(Root, {
      mode: showPicker ? "picker" : "direct",
      sessions,
      ctx,
      permissions,
      commands,
      version: VERSION,
      cwd,
      initialMessages: resumed ? toDisplayMessages(resumed.history) : [],
      onResumeSession: resumeSession,
      systemPromptFor,
      modelInfoCache: createModelInfoCache(),
      mcpServers: mcp.statuses,
      onNewSession: () => {
        store = new SessionStore({ provider: provider.name, model: ctx.model, cwd });
      },
      autoCompact: config.autoCompact,
      autoCompactThreshold: config.autoCompactThreshold,
      onCompacted: (history) => store.compacted(history),
      // Re-reads from disk on every call rather than returning the stale `let`
      // snapshot — otherwise /memory (and systemPromptFor, called right after)
      // would report pre-/init content immediately after the model just wrote
      // a fresh STAK.md via the write tool, since nothing else observes that
      // write.
      listMemory: async () => {
        memory = await loadMemory(cwd);
        return memory;
      },
      onAppendMemory: async (text: string) => {
        const result = await appendMemory(cwd, text);
        memory = await loadMemory(cwd);
        return result;
      },
    }),
  );

  await instance.waitUntilExit();
  await mcp.close();
}
