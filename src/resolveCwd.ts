import path from "node:path";

export interface ResolveCwdOptions {
  /** The -C/--cwd flag, if given. Outranks the environment variable. */
  flag?: string;
  /** STAK_CWD, if set. Used only when no flag is given. */
  env?: string;
  /** Where the process actually launched, used as the fallback and as the
   * base a relative flag/env value resolves against. */
  processCwd: string;
}

/**
 * Resolves the directory stak should treat as its project root. Plain
 * `process.cwd()` unless overridden: `-C/--cwd` wins outright, `STAK_CWD`
 * is the fallback for a persistent default (set once in a shell profile so
 * `stak` with no flag always lands on a chosen project), and a relative
 * value in either resolves against where the process actually launched
 * rather than being left ambiguous.
 */
export function resolveCwd(options: ResolveCwdOptions): string {
  const chosen = options.flag ?? options.env;
  return chosen ? path.resolve(options.processCwd, chosen) : options.processCwd;
}
