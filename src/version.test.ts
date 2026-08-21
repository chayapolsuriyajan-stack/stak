import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readVersion } from "./version.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stak-version-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Mirrors the real layout: package.json one directory above the module
 * that's asking for the version (src/cli.ts or dist/cli.js, either way). */
async function makePackageLayout(version: unknown): Promise<string> {
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ version }),
  );
  return pathToFileURL(path.join(dir, "dist", "cli.js")).href;
}

describe("readVersion", () => {
  test("reads the version from package.json one directory up", async () => {
    const metaUrl = await makePackageLayout("1.2.3");

    expect(readVersion(metaUrl)).toBe("1.2.3");
  });

  test("falls back when package.json is missing", () => {
    const metaUrl = pathToFileURL(path.join(dir, "dist", "cli.js")).href;

    expect(readVersion(metaUrl, "fallback")).toBe("fallback");
  });

  test("falls back when package.json is malformed", async () => {
    await fs.mkdir(path.join(dir, "dist"), { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), "{ not json");
    const metaUrl = pathToFileURL(path.join(dir, "dist", "cli.js")).href;

    expect(readVersion(metaUrl, "fallback")).toBe("fallback");
  });

  test("falls back when the version field is missing or not a string", async () => {
    const noVersion = await makePackageLayout(undefined);
    expect(readVersion(noVersion, "fallback")).toBe("fallback");

    // Overwrite with a non-string version to check the type guard too.
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ version: 123 }));
    expect(readVersion(noVersion, "fallback")).toBe("fallback");
  });

  test("has a sensible default fallback when none is given", () => {
    const metaUrl = pathToFileURL(path.join(dir, "dist", "cli.js")).href;

    expect(readVersion(metaUrl)).toBe("0.0.0-unknown");
  });
});
