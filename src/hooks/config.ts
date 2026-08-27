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

// mergeHooks/mergePhase used to fold project-sourced hooks over global ones.
// Both are gone: config/load.ts no longer reads hooks from a project's
// .stak/settings.json at all, because a committed file that can run shell
// commands is remote code execution on clone-and-run. There is nothing left
// to merge — see the SECURITY note in config/load.ts.
