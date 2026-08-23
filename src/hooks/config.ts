/**
 * Declarative JSON hooks: configuration shape, per-source parsing, and
 * global/project merging. Parsing mirrors parseMcpServers — never throws,
 * collects warnings instead.
 */
export interface HookEntry {
  name: string;
  /** Regex source tested against the tool name; absent = match all. */
  match?: string;
  run: string;
  timeout?: number;
}

export interface HooksConfig {
  beforeTool?: HookEntry[];
  afterTool?: HookEntry[];
}

export type PhaseHooks = { beforeTool: HookEntry[]; afterTool: HookEntry[] };

export interface ParsedHooks {
  hooks: PhaseHooks;
  warnings: string[];
}

const PHASES = ["beforeTool", "afterTool"] as const;
const DEFAULT_TIMEOUT_MS = 10_000;

export function parseHooks(source: object | undefined, label: string): ParsedHooks {
  const hooks: PhaseHooks = { beforeTool: [], afterTool: [] };
  const warnings: string[] = [];
  const raw = (source as { hooks?: unknown } | undefined)?.hooks;
  if (raw === undefined) return { hooks, warnings };

  if (typeof raw !== "object" || raw === null) {
    warnings.push(`Ignoring "hooks" in ${label} config — expected an object.`);
    return { hooks, warnings };
  }

  for (const phase of PHASES) {
    const entries = (raw as Record<string, unknown>)[phase];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      warnings.push(`hooks.${phase} in ${label} config must be an array — ignored.`);
      continue;
    }
    for (const entry of entries as Record<string, unknown>[]) {
      const name = typeof entry?.name === "string" ? entry.name : undefined;
      const run =
        typeof entry?.run === "string" && entry.run.trim() !== ""
          ? entry.run
          : undefined;
      if (name === undefined || run === undefined) {
        warnings.push(
          `Skipping a hooks.${phase} entry in ${label} config — "name" and "run" are required.`,
        );
        continue;
      }
      const match = typeof entry.match === "string" ? entry.match : undefined;
      if (match !== undefined) {
        try {
          new RegExp(match);
        } catch {
          warnings.push(
            `Skipping hook "${name}" in ${label} config — invalid regex: ${match}`,
          );
          continue;
        }
      }
      const timeoutRaw = entry.timeout;
      if (
        timeoutRaw !== undefined &&
        !(typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0)
      ) {
        warnings.push(
          `Skipping hook "${name}" in ${label} config — timeout must be a positive number of ms.`,
        );
        continue;
      }
      const timeout =
        typeof timeoutRaw === "number" ? timeoutRaw : DEFAULT_TIMEOUT_MS;
      hooks[phase].push({ name, ...(match !== undefined ? { match } : {}), run, timeout });
    }
  }

  return { hooks, warnings };
}

export function mergeHooks(global: PhaseHooks, project: PhaseHooks): PhaseHooks {
  return {
    beforeTool: mergePhase(global.beforeTool, project.beforeTool),
    afterTool: mergePhase(global.afterTool, project.afterTool),
  };
}

function mergePhase(global: HookEntry[], project: HookEntry[]): HookEntry[] {
  // A project hook of the same name supersedes the global one entirely, and
  // project overrides run after any remaining globals.
  const overridden = new Set(project.map((entry) => entry.name));
  return [
    ...global.filter((entry) => !overridden.has(entry.name)),
    ...project,
  ];
}
