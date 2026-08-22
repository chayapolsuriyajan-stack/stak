import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { globalMemoryFile } from "../config/paths.js";
import { resolveWithinRoot } from "../tools/pathSafety.js";
import type { LoadedMemory, MemoryFile, MemorySource } from "./types.js";

export const MEMORY_FILENAME = "STAK.md";
export const MAX_MEMORY_BYTES = 32768;
export const MAX_IMPORT_DEPTH = 3;

export interface LoadMemoryOptions {
  /** Overrides globalMemoryFile() — for tests. */
  globalFile?: string;
  /** Overrides os.homedir() — for tests; also the ancestor-walk stop boundary. */
  homeDir?: string;
  /** Overrides MAX_MEMORY_BYTES. */
  maxBytes?: number;
  /** Overrides MAX_IMPORT_DEPTH. */
  maxDepth?: number;
}

const FENCE_PATTERN = /^```\S*$/;
const IMPORT_LINE_PATTERN = /^@(\S+)$/;

/**
 * Case-insensitive path comparison on win32 (where drive letters and paths
 * are not case-sensitive but Node's `path` module does not normalize their
 * case), case-sensitive everywhere else. Used for the ancestor walk's
 * homeDir/root stop-condition checks — without this, a lowercase-drive-letter
 * cwd (e.g. from `path.resolve` on Windows) walks straight past a
 * capitalized `os.homedir()` boundary instead of stopping at it.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Discovers STAK.md (a CLAUDE.md-equivalent) at the global config dir, every
 * ancestor directory of `cwd` up to (but not including) the home directory
 * or filesystem root, and `cwd` itself — in that ascending-precedence order.
 * Resolves `@path` imports within each file, then applies a byte cap to the
 * fully-resolved content. Missing top-level files are skipped silently;
 * malformed imports leave inline markers and warnings rather than throwing.
 */
export async function loadMemory(
  cwd: string = process.cwd(),
  opts: LoadMemoryOptions = {},
): Promise<LoadedMemory> {
  const warnings: string[] = [];
  const files: MemoryFile[] = [];

  const maxBytes = opts.maxBytes ?? MAX_MEMORY_BYTES;
  const maxDepth = opts.maxDepth ?? MAX_IMPORT_DEPTH;
  const homeDir = path.resolve(opts.homeDir ?? os.homedir());
  const resolvedCwd = path.resolve(cwd);

  const globalFilePath = opts.globalFile ?? globalMemoryFile();
  const globalEntry = await loadFile(globalFilePath, "global", homeDir, maxDepth, maxBytes, warnings);
  if (globalEntry) files.push(globalEntry);

  for (const dir of collectAncestorDirs(resolvedCwd, homeDir)) {
    const filePath = path.join(dir, MEMORY_FILENAME);
    const entry = await loadFile(filePath, "ancestor", homeDir, maxDepth, maxBytes, warnings);
    if (entry) files.push(entry);
  }

  const projectFilePath = path.join(resolvedCwd, MEMORY_FILENAME);
  const projectEntry = await loadFile(projectFilePath, "project", homeDir, maxDepth, maxBytes, warnings);
  if (projectEntry) files.push(projectEntry);

  return { files, warnings };
}

/**
 * Ancestor directories of `cwd`, outermost first, excluding `cwd` itself and
 * stopping before (not including) `homeDir` or the filesystem root —
 * whichever boundary is reached first.
 */
function collectAncestorDirs(cwd: string, homeDir: string): string[] {
  const dirs: string[] = [];
  let current = path.dirname(cwd);

  while (!samePath(current, homeDir) && !samePath(current, path.parse(current).root)) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs.reverse();
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadFile(
  filePath: string,
  source: MemorySource,
  homeDir: string,
  maxDepth: number,
  maxBytes: number,
  warnings: string[],
): Promise<MemoryFile | undefined> {
  const raw = await readFileIfExists(filePath);
  if (raw === undefined) return undefined;

  const resolvedPath = path.resolve(filePath);
  // `~`-expansion is only ever safe for the global memory file: it lives in
  // the user's own home directory (~/.stak/STAK.md) by design, so an import
  // reaching further into that same home directory isn't a boundary
  // violation. A project- or ancestor-sourced file has no such exemption —
  // letting it use `~` would let a committed, shared STAK.md read (and thus
  // exfiltrate) anything the OS user's home directory contains, including
  // ~/.stak/config.json where API keys live. See resolveImportPath.
  const allowHome = source === "global";
  const resolved = await resolveImports(
    raw,
    resolvedPath,
    homeDir,
    allowHome,
    maxDepth,
    0,
    new Set([resolvedPath]),
    warnings,
  );

  if (resolved.trim() === "") return undefined;

  const { content, truncated } = truncateToBytes(resolved, maxBytes);
  if (truncated) {
    warnings.push(`Memory file "${filePath}" exceeds ${maxBytes} bytes and was truncated.`);
  }

  return {
    path: filePath,
    source,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
    truncated,
  };
}

/**
 * Replaces `@path`-only lines with the imported file's (recursively
 * resolved) content. Import lines inside fenced code blocks are left
 * untouched. Cycles, missing files, depth overruns, and imports blocked by
 * `resolveImportPath`'s confinement check all leave an inline marker plus a
 * warning rather than throwing, recursing forever, or silently reading the
 * file anyway.
 */
async function resolveImports(
  content: string,
  containingFilePath: string,
  homeDir: string,
  allowHome: boolean,
  maxDepth: number,
  currentDepth: number,
  visited: Set<string>,
  warnings: string[],
): Promise<string> {
  const lines = content.split("\n");
  const outLines: string[] = [];
  let insideFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (FENCE_PATTERN.test(trimmed)) {
      insideFence = !insideFence;
      outLines.push(line);
      continue;
    }

    if (insideFence) {
      outLines.push(line);
      continue;
    }

    const match = IMPORT_LINE_PATTERN.exec(trimmed);
    if (!match) {
      outLines.push(line);
      continue;
    }

    const rawImportPath = match[1] as string;
    const resolution = await resolveImportPath(rawImportPath, containingFilePath, homeDir, allowHome);
    if (!resolution.ok) {
      outLines.push(`<!-- import blocked: ${rawImportPath} -->`);
      warnings.push(`Memory import "${rawImportPath}" was blocked: ${resolution.reason}`);
      continue;
    }

    const importPath = resolution.path;

    if (currentDepth + 1 > maxDepth) {
      outLines.push(`<!-- import depth exceeded: ${importPath} -->`);
      warnings.push(`Memory import "${importPath}" exceeds max depth of ${maxDepth} and was skipped.`);
      continue;
    }

    if (visited.has(importPath)) {
      outLines.push(`<!-- import cycle skipped: ${importPath} -->`);
      warnings.push(`Memory import cycle detected: "${importPath}" was skipped.`);
      continue;
    }

    const importedRaw = await readFileIfExists(importPath);
    if (importedRaw === undefined) {
      outLines.push(`<!-- import not found: ${importPath} -->`);
      warnings.push(`Memory import "${importPath}" was not found and was skipped.`);
      continue;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(importPath);
    const importedContent = await resolveImports(
      importedRaw,
      importPath,
      homeDir,
      allowHome,
      maxDepth,
      currentDepth + 1,
      nextVisited,
      warnings,
    );
    outLines.push(importedContent);
  }

  return outLines.join("\n");
}

type ImportResolution = { ok: true; path: string } | { ok: false; reason: string };

/**
 * SECURITY: this is the sole gate between an `@path` import line and the
 * filesystem. STAK.md is, by design, a normal project file meant to be
 * committed and shared — so an unconfined import here would let a
 * malicious/compromised repo's STAK.md read (and get sent straight to the
 * configured model provider as system-prompt context) anything the OS user
 * can read, e.g. `@../../../.ssh/id_rsa` or `@~/.stak/config.json`.
 *
 * Three rules:
 *   1. A non-`~` import is confined to the *importing file's own directory*
 *      (not the project root as a whole) — for a project-sourced file this
 *      is the same thing, but for an ancestor-sourced file it correctly
 *      confines to that ancestor's own subtree (which the project root is
 *      NOT a superset of — cwd can be arbitrarily deep under an ancestor's
 *      STAK.md), and for the global file it confines to `~/.stak`, matching
 *      where that file actually lives.
 *   2. `~` is only ever expanded when `allowHome` is true, i.e. when the
 *      *importing* file is itself the global memory file. A project- or
 *      ancestor-sourced file cannot use `~` at all — rejected outright, not
 *      silently treated as a literal path. When allowed, the result is
 *      confined to `homeDir` instead of rule 1's per-file root.
 *   3. Path-string confinement alone doesn't stop a symlink whose *target*
 *      escapes the allowed directory (a hostile repo can commit a symlink
 *      that textually resolves inside the project but points at
 *      ~/.stak/config.json) — so after the string-level check passes, the
 *      path is resolved through `fs.realpath` and re-confined against the
 *      same root. A path that doesn't exist yet (realpath fails) is passed
 *      through unresolved; `readFileIfExists` reports it as "not found"
 *      downstream, which is the correct outcome for a nonexistent import.
 */
async function resolveImportPath(
  rawPath: string,
  containingFilePath: string,
  homeDir: string,
  allowHome: boolean,
): Promise<ImportResolution> {
  if (rawPath.startsWith("~")) {
    if (!allowHome) {
      return {
        ok: false,
        reason: `"${rawPath}" uses "~", which is only allowed when importing from the global memory file.`,
      };
    }

    const expanded = path.join(homeDir, rawPath.slice(1));
    const confined = resolveWithinRoot(homeDir, expanded);
    if (!confined.ok) return { ok: false, reason: confined.reason };
    return verifyNoSymlinkEscape(confined.path, homeDir);
  }

  const importRoot = path.dirname(containingFilePath);
  const expanded = path.resolve(importRoot, rawPath);
  const confined = resolveWithinRoot(importRoot, expanded);
  if (!confined.ok) return { ok: false, reason: confined.reason };
  return verifyNoSymlinkEscape(confined.path, importRoot);
}

/** Re-confines a path that already passed string-level confinement against
 * its *real* (symlink-resolved) location, so a symlink can't be used to
 * point an otherwise-legitimate-looking import somewhere outside `root`. */
async function verifyNoSymlinkEscape(resolvedPath: string, root: string): Promise<ImportResolution> {
  let realTarget: string;
  try {
    realTarget = await fs.realpath(resolvedPath);
  } catch {
    // Doesn't exist (yet) — nothing to escape via; readFileIfExists reports
    // this as a missing import, which is the right outcome.
    return { ok: true, path: resolvedPath };
  }

  const realRoot = await fs.realpath(root).catch(() => root);
  const confined = resolveWithinRoot(realRoot, realTarget);
  if (!confined.ok) {
    return { ok: false, reason: `resolves through a symlink to a location outside the allowed directory` };
  }
  return { ok: true, path: resolvedPath };
}

/** Truncates at the last complete line boundary at or before `maxBytes`. */
function truncateToBytes(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buf = Buffer.from(content, "utf8");
  if (buf.length <= maxBytes) {
    return { content, truncated: false };
  }

  const slice = buf.subarray(0, maxBytes);
  const lastNewline = slice.lastIndexOf(0x0a);
  const cutoff = lastNewline === -1 ? maxBytes : lastNewline + 1;

  return { content: buf.subarray(0, cutoff).toString("utf8"), truncated: true };
}
