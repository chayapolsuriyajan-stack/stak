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
}

export interface Command {
  name: string;
  description: string;
  /** Shown in help after the name, e.g. "<mode>". */
  argumentHint?: string;
  source: "builtin" | "markdown";
  run(ctx: CommandContext): Promise<CommandOutcome> | CommandOutcome;
}
