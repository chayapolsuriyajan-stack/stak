import fs from "node:fs/promises";
import { mergeMcpServers, parseMcpServers } from "../mcp/config.js";
import { MODE_CYCLE } from "../permissions/manager.js";
import type { ProviderName } from "../providers/types.js";
import { globalConfigFile, projectSettingsFile } from "./paths.js";
import type {
  GlobalConfig,
  PermissionMode,
  ProjectSettings,
  ResolvedConfig,
} from "./types.js";

// Ollama's default is deliberately a widely-pulled, small model rather than
// anything project-specific — there is no universal "right" local model, and
// a name that only exists on the machine that happened to develop this would
// fail confusingly for anyone else. cli.ts separately warns at startup if
// the resolved model (this default, or whatever the user configured) isn't
// actually present locally, which catches both a fresh install and a typo.
const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  ollama: "llama3.2",
};

const SECRET_KEYS = ["anthropicApiKey", "openaiApiKey", "apiKey", "token"];

export interface LoadOptions {
  cwd?: string;
  /** CLI flags, which outrank every file and environment variable. */
  provider?: string;
  model?: string;
}

/**
 * Resolves configuration from, in increasing order of precedence: the global
 * config file, environment variables, project settings, then CLI flags.
 */
export async function loadConfig(options: LoadOptions = {}): Promise<ResolvedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];

  const global = await readJson<GlobalConfig>(globalConfigFile());
  const project = await readJson<ProjectSettings>(projectSettingsFile(cwd));

  if (project) {
    const leaked = SECRET_KEYS.filter((key) => key in project);
    if (leaked.length > 0) {
      warnings.push(
        `Ignoring ${leaked.join(", ")} in .stak/settings.json — credentials belong in ~/.stak/config.json.`,
      );
    }
  }

  const env = process.env;

  const globalMcp = parseMcpServers(global, "global", env);
  const projectMcp = parseMcpServers(project, "project", env);
  warnings.push(...globalMcp.warnings, ...projectMcp.warnings);
  const mcpServers = mergeMcpServers(globalMcp.servers, projectMcp.servers);

  const envModel = env["STAK_MODEL"];
  const envProvider = env["STAK_PROVIDER"];

  const provider = coerceProvider(
    options.provider ?? project?.defaultProvider ?? envProvider ?? global?.defaultProvider,
    warnings,
  );

  const model =
    options.model ?? project?.defaultModel ?? envModel ?? global?.defaultModel ??
    DEFAULT_MODELS[provider];

  return {
    provider,
    model,
    permissionMode: coerceMode(project?.permissionMode, warnings),
    // Environment variables override the global file for secrets, so a shell
    // export can stand in without editing config.
    anthropicApiKey: env["ANTHROPIC_API_KEY"] ?? global?.anthropicApiKey,
    openaiApiKey: env["OPENAI_API_KEY"] ?? global?.openaiApiKey,
    ollamaHost: env["OLLAMA_HOST"] ?? global?.ollamaHost ?? "http://localhost:11434",
    mcpServers,
    autoCompact: project?.autoCompact ?? global?.autoCompact ?? true,
    autoCompactThreshold: coerceThreshold(
      project?.autoCompactThreshold ?? global?.autoCompactThreshold,
      warnings,
    ),
    warnings,
  };
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    // Missing or malformed config is not fatal — defaults carry the session.
    return undefined;
  }
}

function coerceProvider(value: string | undefined, warnings: string[]): ProviderName {
  if (value === undefined) return "ollama";
  if (value === "anthropic" || value === "openai" || value === "ollama") return value;
  warnings.push(`Unknown provider "${value}", falling back to ollama.`);
  return "ollama";
}

function coerceMode(
  value: string | undefined,
  warnings: string[],
): PermissionMode {
  if (value === undefined) return "ask";
  // Derived from MODE_CYCLE rather than a hand-written literal union, so a
  // future mode added there can't silently fail to round-trip through
  // persisted project settings the way "plan" briefly did.
  if ((MODE_CYCLE as string[]).includes(value)) return value as PermissionMode;
  warnings.push(`Unknown permission mode "${value}", falling back to ask.`);
  return "ask";
}

function coerceThreshold(value: number | undefined, warnings: string[]): number {
  if (value === undefined) return 0.85;
  if (value > 0 && value < 1) return value;
  warnings.push(
    `Invalid autoCompactThreshold ${value} (must be between 0 and 1), falling back to 0.85.`,
  );
  return 0.85;
}
