import fs from "node:fs/promises";
import path from "node:path";
import { globalCommandsDir, projectCommandsDir } from "../config/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { Command } from "./types.js";

const ARGUMENT_PLACEHOLDER = "$ARGUMENTS";

interface CommandFrontmatter {
  description?: string;
  "argument-hint"?: string;
}

export interface LoadedCommands {
  commands: Command[];
  /** Why a file was rejected, so a command never fails to load in silence. */
  warnings: string[];
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
): Promise<LoadedCommands> {
  const byName = new Map<string, Command>();
  const warnings: string[] = [];

  for (const dir of dirs) {
    const loaded = await loadFrom(dir);
    warnings.push(...loaded.warnings);
    for (const command of loaded.commands) {
      byName.set(command.name, command);
    }
  }

  return { commands: [...byName.values()], warnings };
}

async function loadFrom(dir: string): Promise<LoadedCommands> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { commands: [], warnings: [] };
  }

  const commands: Command[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = path.join(dir, entry);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed.ok) {
      warnings.push(`Skipped ${filePath}: ${parsed.reason}`);
      continue;
    }

    const frontmatter = parsed.value.data as CommandFrontmatter;
    const name = entry.slice(0, -".md".length);
    const body = parsed.value.body;

    if (body === "") {
      warnings.push(`Skipped ${filePath}: the body is empty.`);
      continue;
    }

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

  return { commands, warnings };
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
