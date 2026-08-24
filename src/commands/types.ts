import type { CompactResult } from "../agent/compact.js";
import type { LoadedMemory } from "../memory/types.js";
import type { McpServerStatus } from "../mcp/types.js";

/** One configured hook, as /hooks surfaces it. */
export interface HookSummary {
  phase: "beforeTool" | "afterTool";
  name: string;
  match?: string;
  run: string;
  source: "global" | "project";
}

/** What running a command asks the app to do. */
export type CommandOutcome =
  /** Nothing further; the command already did its work through its effects. */
  | { kind: "handled" }
  /** Show a line in the transcript. */
  | { kind: "notice"; text: string }
  /** Treat this text as if the user had typed it, starting a normal turn. */
  | { kind: "prompt"; text: string }
  | { kind: "error"; text: string }
  | { kind: "exit" };

export interface CommandContext {
  /** Raw text following the command name, empty when none was given. */
  args: string;
  /** Clears the transcript and conversation history. */
  clear: () => void;
  setPermissionMode: (mode: string) => Promise<string>;
  getPermissionMode: () => string;
  setModel: (model: string) => void;
  getModel: () => string;
  describeModel: () => string;
  /** The active provider's known models, or undefined if it cannot list them. */
  listModels: () => Promise<string[] | undefined>;
  listCommands: () => { name: string; description: string }[];
  /** Status of every configured MCP server, global and project. */
  listMcpServers: () => McpServerStatus[];
  /** Every configured beforeTool/afterTool hook, global and project. */
  listHooks: () => HookSummary[];
  /** The project memory files (STAK.md) that were loaded for this session.
   * Async: re-reads from disk on every call so /memory (and anything else
   * that calls it) never reports stale content, e.g. right after /init just
   * wrote a fresh STAK.md. */
  listMemory: () => Promise<LoadedMemory>;
  /** Summarizes the older portion of the conversation to free up context, optionally steered by a focus hint. */
  compact: (focus?: string) => Promise<CompactResult>;
}

export interface Command {
  name: string;
  description: string;
  /** Shown in help after the name, e.g. "<mode>". */
  argumentHint?: string;
  source: "builtin" | "markdown";
  run(ctx: CommandContext): Promise<CommandOutcome> | CommandOutcome;
}
