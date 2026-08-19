import path from "node:path";

export type SafeResolution =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Resolves `candidate` against `root` and rejects anything that lands outside
 * it — `../../etc/passwd` or an absolute path elsewhere on disk. Applies to
 * the file tools (read/write/edit/grep/glob); `bash` is deliberately excluded
 * since its command string can `cd` anywhere regardless, so confining only
 * its `cwd` argument would be a false sense of safety rather than a real one.
 */
export function resolveWithinRoot(root: string, candidate: string): SafeResolution {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);

  // path.relative crossing drives on Windows (e.g. C:\ vs D:\) also comes
  // back as an absolute-looking path, which isAbsolute catches alongside the
  // ordinary "../" escape case.
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

  if (escapes) {
    return {
      ok: false,
      reason: `"${candidate}" resolves outside the project directory (${resolvedRoot}) and is not allowed. Use the bash tool if you genuinely need a path elsewhere.`,
    };
  }

  return { ok: true, path: resolved };
}

export type SafePattern = { ok: true } | { ok: false; reason: string };

/**
 * Confining a glob call's `cwd` is not enough on its own: fast-glob (like
 * most glob implementations) honors `..` path segments and absolute paths
 * *inside the pattern itself*, both of which search outside `cwd` regardless
 * of what it was confined to. Patterns must be rejected outright rather than
 * resolved, since a glob can expand to many paths at once.
 */
export function assertSafeGlobPattern(pattern: string): SafePattern {
  // Checked under both conventions regardless of host OS: a Windows drive
  // path (C:/Users/...) is just as much an escape on a Linux host as a
  // POSIX-absolute path is meant to be rejected on Windows.
  if (path.win32.isAbsolute(pattern) || path.posix.isAbsolute(pattern)) {
    return {
      ok: false,
      reason: `"${pattern}" is an absolute pattern, which searches outside the project regardless of cwd. Use a relative pattern.`,
    };
  }

  const segments = pattern.split(/[/\\]/);
  if (segments.includes("..")) {
    return {
      ok: false,
      reason: `"${pattern}" contains "..", which searches outside the project directory and is not allowed.`,
    };
  }

  return { ok: true };
}
