import type { McpServerConfig, NamedMcpServer } from "../mcp/types.js";
import type { ProviderName } from "../providers/types.js";

/**
 * "plan" is the strictest mode: read-only tools stay available for research,
 * but every edit and command is refused outright, with no prompt — the
 * model is expected to describe what it would do instead. Switching to any
 * other mode is how a proposed plan gets approved to actually run.
 */
export type PermissionMode = "plan" | "build" | "auto";

/** Shape of ~/.stak/config.json — the only file allowed to hold secrets. */
export interface GlobalConfig {
  defaultProvider?: ProviderName;
  defaultModel?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
  mcpServers?: Record<string, McpServerConfig>;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
}

/** Shape of .stak/settings.json — per project, never secrets. */
export interface ProjectSettings {
  defaultProvider?: ProviderName;
  defaultModel?: string;
  permissionMode?: PermissionMode;
  mcpServers?: Record<string, McpServerConfig>;
  autoCompact?: boolean;
  autoCompactThreshold?: number;
}

/** Fully merged runtime configuration. */
export interface ResolvedConfig {
  provider: ProviderName;
  model: string;
  permissionMode: PermissionMode;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost: string;
  mcpServers: NamedMcpServer[];
  autoCompact: boolean;
  autoCompactThreshold: number;
  /** Non-fatal problems worth surfacing once the UI is up. */
  warnings: string[];
}
