import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { globalCommandsDir, projectCommandsDir } from "../config/paths.js";
import type { Command } from "./types.js";

const ARGUMENT_PLACEHOLDER = "$ARGUMENTS";

interface CommandFrontmatter {
  description?: string;
  "argument-hint"?: string;
}

/**
 * Loads markdown commands from the global directory first, then the project's,
 * so a project file of the same name shadows the user's version.
 *
 * `dirs` exists so tests can supply their own locations instead of reaching
 * into the real home directory.
 */
export async function loadMarkdownCommands(
  cwd: string = process.cwd(),
  dirs: string[] = [globalCommandsDir(), projectCommandsDir(cwd)],
): Promise<Command[]> {
  const byName = new Map<string, Command>();

  for (const dir of dirs) {
    for (const command of await loadFrom(dir)) {
      byName.set(command.name, command);
    }
  }

  return [...byName.values()];
}

async function loadFrom(dir: string): Promise<Command[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const commands: Command[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, entry), "utf8");
    } catch {
      continue;
    }

    const parsed = matter(raw);
    const frontmatter = parsed.data as CommandFrontmatter;
    const name = entry.slice(0, -".md".length);
    const body = parsed.content.trim();

    commands.push({
      name,
      description: frontmatter.description ?? `run the ${name} command`,
      ...(frontmatter["argument-hint"]
        ? { argumentHint: frontmatter["argument-hint"] }
        : {}),
      source: "markdown",
      run(ctx) {
        return { kind: "prompt", text: expand(body, ctx.args) };
      },
    });
  }

  return commands;
}

/**
 * A body with no placeholder still needs the user's arguments, so append them
 * rather than dropping what they typed.
 */
function expand(body: string, args: string): string {
  if (body.includes(ARGUMENT_PLACEHOLDER)) {
    return body.split(ARGUMENT_PLACEHOLDER).join(args);
  }
  return args === "" ? body : `${body}\n\n${args}`;
}
