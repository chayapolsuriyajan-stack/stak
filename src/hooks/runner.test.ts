import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { HookEntry } from "./config.js";
import { hookEnv, HookRunner } from "./runner.js";

function entry(partial: Partial<HookEntry>): HookEntry {
  return { name: "test-hook", run: "node -e \"process.exit(0)\"", ...partial };
}

const invocation = { tool: "edit", args: { file_path: "a.ts" }, cwd: process.cwd() };

describe("hookEnv", () => {
  test("exposes the invocation as environment variables", () => {
    const env = hookEnv(invocation, "beforeTool");
    expect(env["STAK_HOOK_PHASE"]).toBe("beforeTool");
    expect(env["STAK_TOOL_NAME"]).toBe("edit");
    expect(JSON.parse(env["STAK_TOOL_ARGS"] ?? "null")).toEqual({ file_path: "a.ts" });
    expect(env["STAK_PROJECT_DIR"]).toBe(process.cwd());
  });

  test("inherits the parent environment so hooks can still find their tools", () => {
    expect(hookEnv(invocation, "afterTool")["PATH"]).toBe(process.env["PATH"]);
  });

  test("carries shell metacharacters as inert data, never as syntax", () => {
    // The value below would be catastrophic if it were spliced into the
    // command string; as an env var the shell expands it to one value.
    const nasty = { file_path: '"; echo PWNED > pwned.txt; #' };
    const env = hookEnv({ ...invocation, args: nasty }, "beforeTool");
    expect(JSON.parse(env["STAK_TOOL_ARGS"] ?? "null")).toEqual(nasty);
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

  // Regression: hook.run used to have model-chosen tool args spliced into it
  // before being handed to a `shell: true` spawn, so a path like the one
  // below turned an innocuous audit hook into arbitrary code execution.
  test("a malicious tool argument cannot inject a command into the hook", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stak-hook-inject-"));
    const marker = path.join(dir, "PWNED.txt").replace(/\\/g, "/");
    const runner = new HookRunner({
      beforeTool: [entry({ run: "node -e \"process.exit(0)\" $FILE_PATH" })],
      afterTool: [],
    });

    const outcome = await runner.run("beforeTool", {
      tool: "edit",
      cwd: dir,
      args: { file_path: `x.ts"; node -e "require('fs').writeFileSync('${marker}','x')" ; #` },
    });

    expect(outcome.blocked).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
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

  // Replaces an older test that asserted "$FILE_PATH" was substituted into
  // the command string before spawning. That substitution was the injection
  // vector; args now travel as environment variables, which the shell
  // expands to a single value and never re-parses as syntax.
  test("tool args reach the hook as environment variables", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stak-hook-"));
    const outFile = path.join(dir, "seen.txt").replace(/\\/g, "/");
    const runner = new HookRunner({
      beforeTool: [
        entry({
          run: `node -e "const a=JSON.parse(process.env.STAK_TOOL_ARGS);require('node:fs').writeFileSync('${outFile}',process.env.STAK_TOOL_NAME+':'+a.file_path)"`,
        }),
      ],
      afterTool: [],
    });
    try {
      await runner.run("beforeTool", invocation);
      expect(fs.readFileSync(outFile, "utf8")).toBe("edit:a.ts");
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
