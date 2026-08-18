import fs from "node:fs/promises";
import type { ProviderName } from "../providers/types.js";
import { globalConfigFile, projectSettingsFile } from "./paths.js";
import type {
  GlobalConfig,
  PermissionMode,
  ProjectSettings,
  ResolvedConfig,
} from "./types.js";

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  ollama: "qwen3.8-iq4xs",
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
  if (value === "ask" || value === "accept-edits" || value === "auto-bypass") {
    return value;
  }
  warnings.push(`Unknown permission mode "${value}", falling back to ask.`);
  return "ask";
}
