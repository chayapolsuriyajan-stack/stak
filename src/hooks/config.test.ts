import { describe, expect, test } from "vitest";
import { parseHooks } from "./config.js";

describe("parseHooks", () => {
  test("returns empty hooks and no warnings for missing config", () => {
    const parsed = parseHooks(undefined, "global");
    expect(parsed.hooks.beforeTool).toEqual([]);
    expect(parsed.hooks.afterTool).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  test("parses valid beforeTool and afterTool entries", () => {
    const parsed = parseHooks(
      {
        hooks: {
          beforeTool: [{ name: "guard", match: "bash", run: "node check.js" }],
          afterTool: [
            { name: "fmt", run: "prettier --write $FILE", timeout: 5000 },
          ],
        },
      },
      "global",
    );
    expect(parsed.hooks.beforeTool).toHaveLength(1);
    expect(parsed.hooks.beforeTool[0]).toMatchObject({
      name: "guard",
      match: "bash",
    });
    expect(parsed.hooks.afterTool[0]?.timeout).toBe(5000);
    expect(parsed.warnings).toEqual([]);
  });

  test("warns and skips entries without name or run", () => {
    const parsed = parseHooks(
      {
        hooks: {
          beforeTool: [{ run: "x.js" }, { name: "a" }, { name: "ok", run: "y.js" }],
        },
      },
      "project",
    );
    expect(parsed.hooks.beforeTool).toHaveLength(1);
    expect(parsed.hooks.beforeTool[0]?.name).toBe("ok");
    expect(parsed.warnings).toHaveLength(2);
  });

  test("warns on an invalid match regex", () => {
    const parsed = parseHooks(
      { hooks: { beforeTool: [{ name: "bad", match: "([", run: "x.js" }] } },
      "global",
    );
    expect(parsed.hooks.beforeTool).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(1);
  });

  test("warns on a non-positive timeout", () => {
    const parsed = parseHooks(
      { hooks: { afterTool: [{ name: "t", run: "x.js", timeout: 0 }] } },
      "global",
    );
    expect(parsed.hooks.afterTool).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(1);
  });

  test("warns when hooks is not an array per phase", () => {
    const parsed = parseHooks({ hooks: { beforeTool: "nope" } }, "global");
    expect(parsed.hooks.beforeTool).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
  });
});

// mergeHooks is gone along with project-sourced hooks — see the SECURITY
// note in config/load.ts. Its replacement behavior (project hooks refused
// with a warning) is covered in config/load.test.ts, where the refusal
// actually happens.
