import { describe, expect, test } from "vitest";
import { mergeHooks, parseHooks } from "./config.js";

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

describe("mergeHooks", () => {
  test("concatenates phases with globals first", () => {
    const merged = mergeHooks(
      { beforeTool: [{ name: "g", run: "g.js" }], afterTool: [] },
      { beforeTool: [{ name: "p", run: "p.js" }], afterTool: [] },
    );
    expect(merged.beforeTool.map((h) => h.name)).toEqual(["g", "p"]);
  });

  test("a project entry replaces a global of the same name in place-order", () => {
    const merged = mergeHooks(
      {
        beforeTool: [
          { name: "a", run: "global-a.js" },
          { name: "b", run: "b.js" },
        ],
        afterTool: [],
      },
      { beforeTool: [{ name: "a", run: "project-a.js" }], afterTool: [] },
    );
    expect(merged.beforeTool.map((h) => h.name)).toEqual(["b", "a"]);
    expect(merged.beforeTool[1]?.run).toBe("project-a.js");
  });
});
