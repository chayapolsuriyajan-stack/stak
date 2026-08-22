import type { McpServerConfig, McpSource, NamedMcpServer } from "./types.js";

/** Matches `${VAR}` and `${VAR:-default}`. */
const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Expands `${VAR}` / `${VAR:-default}` references in `value` against `env`,
 * so config files can reference secrets and machine-specific paths without
 * hardcoding them. Takes `env` as a parameter (rather than reading
 * `process.env` itself) purely so this stays testable without mutating the
 * real environment.
 *
 * A missing var with no default expands to "" and is reported in `missing`
 * rather than throwing — one bad reference in a server's env block should
 * not prevent every other server from loading.
 */
export function expandEnvRefs(
  value: string,
  env: Record<string, string | undefined>,
): { value: string; missing: string[] } {
  const missing: string[] = [];

  const expanded = value.replace(ENV_REF_PATTERN, (_match, name: string, fallback?: string) => {
    const fromEnv = env[name];
    if (fromEnv !== undefined) return fromEnv;
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return "";
  });

  return { value: expanded, missing };
}

/**
 * Parses the `mcpServers` object out of a config file's raw JSON. Matches
 * the skip-and-warn pattern used by skills/commands loading (see
 * src/skills/loader.ts): a malformed entry is dropped with a warning rather
 * than failing the whole file, since one bad server should not take down
 * every other one a user has configured.
 */
export function parseMcpServers(
  raw: unknown,
  source: McpSource,
  env: Record<string, string | undefined>,
): { servers: NamedMcpServer[]; warnings: string[] } {
  const servers: NamedMcpServer[] = [];
  const warnings: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { servers, warnings };
  }

  const mcpServers = (raw as Record<string, unknown>).mcpServers;
  if (mcpServers === undefined) {
    return { servers, warnings };
  }

  if (typeof mcpServers !== "object" || mcpServers === null) {
    warnings.push(`Skipped mcpServers: expected an object, got ${typeof mcpServers}.`);
    return { servers, warnings };
  }

  for (const [name, entry] of Object.entries(mcpServers as Record<string, unknown>)) {
    const config = parseServerConfig(name, entry, env, warnings, source);
    if (config) {
      servers.push({ name, source, config });
    }
  }

  return { servers, warnings };
}

function parseServerConfig(
  name: string,
  entry: unknown,
  env: Record<string, string | undefined>,
  warnings: string[],
  source: McpSource,
): McpServerConfig | undefined {
  if (typeof entry !== "object" || entry === null) {
    warnings.push(`Skipped MCP server "${name}" (${source}): expected an object.`);
    return undefined;
  }

  const raw = entry as Record<string, unknown>;
  const type = raw.type;

  if (type === "http" || type === "sse") {
    if (typeof raw.url !== "string" || raw.url === "") {
      warnings.push(
        `Skipped MCP server "${name}" (${source}): "${type}" entries require a string "url".`,
      );
      return undefined;
    }
    return {
      type,
      url: expandString(raw.url, name, "url", env, warnings, source),
      ...(raw.headers !== undefined
        ? { headers: expandStringRecord(raw.headers, name, "headers", env, warnings, source) }
        : {}),
    };
  }

  if (type !== undefined && type !== "stdio") {
    warnings.push(`Skipped MCP server "${name}" (${source}): unknown type "${String(type)}".`);
    return undefined;
  }

  if (typeof raw.command !== "string" || raw.command === "") {
    warnings.push(
      `Skipped MCP server "${name}" (${source}): stdio entries require a string "command".`,
    );
    return undefined;
  }

  return {
    type: "stdio",
    command: expandString(raw.command, name, "command", env, warnings, source),
    ...(raw.args !== undefined
      ? { args: expandStringArray(raw.args, name, env, warnings, source) }
      : {}),
    ...(raw.env !== undefined
      ? { env: expandStringRecord(raw.env, name, "env", env, warnings, source) }
      : {}),
    ...(typeof raw.cwd === "string"
      ? { cwd: expandString(raw.cwd, name, "cwd", env, warnings, source) }
      : {}),
  };
}

/**
 * Expands `${VAR}` / `${VAR:-default}` refs in a single string field and
 * warns (with the server name, field path, and config source) for each var
 * that had no value and no default — otherwise a typo'd reference silently
 * becomes "" with no signal until an opaque failure at connect time.
 */
function expandString(
  value: string,
  serverName: string,
  field: string,
  env: Record<string, string | undefined>,
  warnings: string[],
  source: McpSource,
): string {
  const { value: expanded, missing } = expandEnvRefs(value, env);
  for (const name of missing) {
    warnings.push(
      `MCP server "${serverName}" (${source}): "\${${name}}" in "${field}" is not set.`,
    );
  }
  return expanded;
}

function expandStringRecord(
  value: unknown,
  serverName: string,
  field: string,
  env: Record<string, string | undefined>,
  warnings: string[],
  source: McpSource,
): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    warnings.push(`Ignored "${field}" for MCP server "${serverName}" (${source}): expected an object.`);
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") {
      warnings.push(
        `Ignored "${field}.${key}" for MCP server "${serverName}" (${source}): expected a string.`,
      );
      continue;
    }
    result[key] = expandString(raw, serverName, `${field}.${key}`, env, warnings, source);
  }
  return result;
}

function expandStringArray(
  value: unknown,
  serverName: string,
  env: Record<string, string | undefined>,
  warnings: string[],
  source: McpSource,
): string[] {
  if (!Array.isArray(value)) {
    warnings.push(`Ignored "args" for MCP server "${serverName}" (${source}): expected an array.`);
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item, index) => expandString(item, serverName, `args[${index}]`, env, warnings, source));
}

/**
 * Combines global and project server lists, with a project-sourced server
 * of the same name replacing the global one — the same "project shadows
 * global" convention skills and commands already follow.
 */
export function mergeMcpServers(
  global: NamedMcpServer[],
  project: NamedMcpServer[],
): NamedMcpServer[] {
  const byName = new Map<string, NamedMcpServer>();
  for (const server of global) byName.set(server.name, server);
  for (const server of project) byName.set(server.name, server);
  return [...byName.values()];
}

/**
 * The MCP SDK spawns stdio servers with `shell: false`, so a bare `npx` or
 * `npm` command fails with ENOENT on Windows — those commands only resolve
 * through PATH when a shell does the lookup, and Windows requires the
 * `.cmd` shim to invoke them directly. Identity everywhere else, and for
 * any command other than these two.
 */
export function normalizeStdioCommand(command: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return command;
  if (command === "npx") return "npx.cmd";
  if (command === "npm") return "npm.cmd";
  return command;
}
