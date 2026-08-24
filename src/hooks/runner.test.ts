import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { HookEntry } from "./config.js";
import { expandArgTokens, HookRunner } from "./runner.js";

function entry(partial: Partial<HookEntry>): HookEntry {
  return { name: "test-hook", run: "node -e \"process.exit(0)\"", ...partial };
}

const invocation = { tool: "edit", args: { file_path: "a.ts" }, cwd: process.cwd() };

describe("expandArgTokens", () => {
  test("substitutes known string args and leaves others", () => {
    expect(
      expandArgTokens("lint $FILE_PATH --fix $MISSING", { file_path: "x.ts" }),
    ).toBe("lint x.ts --fix $MISSING");
  });

  test("leaves non-string args untouched", () => {
    expect(expandArgTokens("count is $COUNT", { count: 3 })).toBe("count is $COUNT");
  });
});

describe("HookRunner", () => {
  test("empty hook set resolves clean without spawning", async () => {
    const runner = new HookRunner({ beforeTool: [], afterTool: [] });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome).toEqual({ blocked: false, reasons: [], notices: [] });
  });

  test("non-matching regex skips the hook", async () => {
    const runner = new HookRunner({
      beforeTool: [entry({ name: "skip", match: "^bash$" })],
      afterTool: [],
    });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome.blocked).toBe(false);
  });

  test("zero exit does not block", async () => {
    const runner = new HookRunner({
      beforeTool: [entry({ run: "node -e \"process.exit(0)\"" })],
      afterTool: [],
    });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome.blocked).toBe(false);
    expect(outcome.reasons).toEqual([]);
  });

  test("nonzero exit blocks with stderr as the reason", async () => {
    const runner = new HookRunner({
      beforeTool: [
        entry({ run: "node -e \"console.error('no force pushes'); process.exit(1)\"" }),
      ],
      afterTool: [],
    });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome.blocked).toBe(true);
    expect(outcome.reasons.join(" ")).toContain("no force pushes");
  });

  test("receives the JSON payload on stdin", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stak-hook-"));
    const outFile = path.join(dir, "payload.json").replace(/\\/g, "/");
    const runner = new HookRunner({
      beforeTool: [
        entry({
          run: `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>require('node:fs').writeFileSync('${outFile}',d))"`,
        }),
      ],
      afterTool: [],
    });
    try {
      await runner.run("beforeTool", invocation);
      const payload = JSON.parse(fs.readFileSync(outFile, "utf8")) as Record<
        string,
        unknown
      >;
      expect(payload).toMatchObject({
        tool: "edit",
        phase: "beforeTool",
        args: { file_path: "a.ts" },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("$arg tokens expand into the spawned command", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stak-hook-"));
    const outFile = path.join(dir, "seen.txt").replace(/\\/g, "/");
    const runner = new HookRunner({
      beforeTool: [
        entry({
          run: `node -e "require('node:fs').writeFileSync('${outFile}',process.argv[1])" "$FILE_PATH"`,
        }),
      ],
      afterTool: [],
    });
    try {
      await runner.run("beforeTool", invocation);
      expect(fs.readFileSync(outFile, "utf8")).toBe("a.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("timeout kills the hook and reports", async () => {
    const runner = new HookRunner({
      beforeTool: [
        entry({ run: "node -e \"setInterval(()=>{},1000)\"", timeout: 200 }),
      ],
      afterTool: [],
    });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome.blocked).toBe(true);
    expect(outcome.reasons.join(" ")).toContain("timed out");
  }, 10_000);

  test("afterTool failure produces a notice, not a block", async () => {
    const runner = new HookRunner({
      beforeTool: [],
      afterTool: [
        entry({ run: "node -e \"console.error('formatter exploded'); process.exit(3)\"" }),
      ],
    });
    const outcome = await runner.run("afterTool", invocation);
    expect(outcome.blocked).toBe(false);
    expect(outcome.notices.join(" ")).toContain("formatter exploded");
  });
});
