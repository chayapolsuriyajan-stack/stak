import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertSafeGlobPattern, resolveWithinRoot } from "./pathSafety.js";

describe("resolveWithinRoot", () => {
  const root = "/project";

  test("accepts a plain relative path", () => {
    const result = resolveWithinRoot(root, "src/app.ts");
    expect(result).toEqual({ ok: true, path: path.resolve(root, "src/app.ts") });
  });

  test("accepts a relative path that stays inside via ..", () => {
    // "src/../lib/app.ts" resolves to "lib/app.ts", still inside root.
    const result = resolveWithinRoot(root, "src/../lib/app.ts");
    expect(result.ok).toBe(true);
  });

  test("rejects a path that climbs above the root", () => {
    const result = resolveWithinRoot(root, "../../etc/passwd");
    expect(result.ok).toBe(false);
  });

  test("rejects an absolute path elsewhere on disk", () => {
    const elsewhere = path.resolve(os.tmpdir(), "definitely-outside");
    const result = resolveWithinRoot(root, elsewhere);
    expect(result.ok).toBe(false);
  });

  test("accepts the root itself", () => {
    expect(resolveWithinRoot(root, ".").ok).toBe(true);
  });

  test("rejects a same-prefix sibling directory", () => {
    // "/project-evil" starts with "/project" as a string but is not inside it.
    const result = resolveWithinRoot(root, "../project-evil/secret.txt");
    expect(result.ok).toBe(false);
  });
});

describe("assertSafeGlobPattern", () => {
  test("accepts an ordinary relative pattern", () => {
    expect(assertSafeGlobPattern("src/**/*.ts").ok).toBe(true);
  });

  test("rejects a pattern containing a .. segment", () => {
    expect(assertSafeGlobPattern("../secrets/**").ok).toBe(false);
    expect(assertSafeGlobPattern("a/../../b").ok).toBe(false);
  });

  test("rejects an absolute pattern", () => {
    expect(assertSafeGlobPattern("/etc/**").ok).toBe(false);
    expect(assertSafeGlobPattern("C:/Users/**").ok).toBe(false);
  });

  test("does not mistake '..' inside a filename for a path segment", () => {
    // A literal filename containing dots should not trip the segment check.
    expect(assertSafeGlobPattern("notes...backup.md").ok).toBe(true);
  });
});
