import type { ProviderName } from "../providers/types.js";

export type PermissionMode = "ask" | "accept-edits" | "auto-bypass";

/** Shape of ~/.stak/config.json — the only file allowed to hold secrets. */
export interface GlobalConfig {
  defaultProvider?: ProviderName;
  defaultModel?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
}

/** Shape of .stak/settings.json — per project, never secrets. */
export interface ProjectSettings {
  defaultProvider?: ProviderName;
  defaultModel?: string;
  permissionMode?: PermissionMode;
}

/** Fully merged runtime configuration. */
export interface ResolvedConfig {
  provider: ProviderName;
  model: string;
  permissionMode: PermissionMode;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  ollamaHost: string;
  /** Non-fatal problems worth surfacing once the UI is up. */
  warnings: string[];
}
