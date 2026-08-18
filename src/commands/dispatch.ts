import { builtinCommands } from "./builtins.js";
import { loadMarkdownCommands } from "./loader.js";
import type { Command, CommandContext, CommandOutcome } from "./types.js";

export class CommandRegistry {
  private commands = new Map<string, Command>();
  readonly warnings: string[];

  constructor(commands: Command[], warnings: string[] = []) {
    for (const command of commands) {
      this.commands.set(command.name, command);
    }
    this.warnings = warnings;
  }

  /** Built-ins are registered last so a markdown file cannot shadow /exit. */
  static async load(cwd: string = process.cwd()): Promise<CommandRegistry> {
    const markdown = await loadMarkdownCommands(cwd);
    return new CommandRegistry(
      [...markdown.commands, ...builtinCommands],
      markdown.warnings,
    );
  }

  list(): { name: string; description: string }[] {
    return [...this.commands.values()]
      .map((command) => ({
        name: command.argumentHint
          ? `${command.name} ${command.argumentHint}`
          : command.name,
        description: command.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  async run(
    input: string,
    context: Omit<CommandContext, "args" | "listCommands">,
  ): Promise<CommandOutcome> {
    const { name, args } = parse(input);
    const command = this.commands.get(name);

    if (!command) {
      return {
        kind: "error",
        text: `Unknown command /${name}. Try /help.`,
      };
    }

    return command.run({
      ...context,
      args,
      listCommands: () => this.list(),
    });
  }
}

/** Splits "/model gpt-4o" into its name and the rest of the line. */
export function parse(input: string): { name: string; args: string } {
  const withoutSlash = input.trim().replace(/^\//, "");
  const firstSpace = withoutSlash.indexOf(" ");

  if (firstSpace === -1) {
    return { name: withoutSlash, args: "" };
  }

  return {
    name: withoutSlash.slice(0, firstSpace),
    args: withoutSlash.slice(firstSpace + 1).trim(),
  };
}

export function isCommand(input: string): boolean {
  return input.trimStart().startsWith("/");
}
