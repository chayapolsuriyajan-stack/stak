import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveCwd } from "./resolveCwd.js";

const processCwd = path.resolve("/launch/dir");

describe("resolveCwd", () => {
  test("defaults to the process cwd when nothing is set", () => {
    expect(resolveCwd({ processCwd })).toBe(processCwd);
  });

  test("STAK_CWD overrides the process cwd", () => {
    expect(resolveCwd({ env: "/projects/foo", processCwd })).toBe(path.resolve("/projects/foo"));
  });

  test("-C/--cwd outranks STAK_CWD", () => {
    expect(
      resolveCwd({ flag: "/projects/bar", env: "/projects/foo", processCwd }),
    ).toBe(path.resolve("/projects/bar"));
  });

  test("a relative flag resolves against the process cwd, not itself", () => {
    expect(resolveCwd({ flag: "../sibling", processCwd })).toBe(
      path.resolve(processCwd, "../sibling"),
    );
  });

  test("a relative STAK_CWD resolves against the process cwd", () => {
    expect(resolveCwd({ env: "./project", processCwd })).toBe(
      path.resolve(processCwd, "./project"),
    );
  });
});
