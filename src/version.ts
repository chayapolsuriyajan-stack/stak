import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads the version from package.json rather than hardcoding it a second
 * time in source — the two drifted apart once already (fixed the same
 * session this was written). package.json sits one directory above this
 * file's own location in both places it's ever run from: `src/version.ts`
 * under `tsx` in dev, and the bundled `dist/version.js` — actually
 * `dist/cli.js`, tsup inlines this — once installed. `metaUrl` is threaded
 * through as a parameter (rather than read from `import.meta.url` directly
 * inside this function) purely so the resolution logic is testable without
 * needing a real file two directories away from wherever the test runner
 * happens to load this module from.
 */
export function readVersion(metaUrl: string, fallback = "0.0.0-unknown"): string {
  try {
    const packageJsonPath = path.join(
      path.dirname(fileURLToPath(metaUrl)),
      "..",
      "package.json",
    );
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : fallback;
  } catch {
    // A version string is never worth failing startup over.
    return fallback;
  }
}
