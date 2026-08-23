# P1: Modes (plan/build/auto) + HookRunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stak's four permission modes with three (`plan | build | auto`) and add a declarative JSON `beforeTool`/`afterTool` hook system wired into the tool-execution path.

**Architecture:** Permission semantics stay tier-based (`RiskTier`) inside `PermissionManager`; hooks live in a new `src/hooks/` module (config parsing + a `HookRunner` that spawns shell commands) invoked by `ToolRegistry.execute` between the permission check and tool execution. `afterTool` stderr surfaces as an additive `notices` field threaded through the loop's `tool-call-result` event into the TUI transcript.

**Tech Stack:** TypeScript (NodeNext ESM), zod, vitest, ink. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-v0.3-platform-upgrade-design.md` sections 1–2.

## Global Constraints

- No new runtime npm dependencies.
- Node >= 20, `"type": "module"` — every import in source/test files ends `.js`.
- Test command: `npx vitest run <file>`; full gate: `npm test && npm run typecheck`.
- Tests must be cross-platform (Windows dev box): hook commands in tests must be runnable via `node -e "..."`, never POSIX-only shell syntax.
- Mode values are exactly `"plan" | "build" | "auto"`. Old values `ask`/`accept-edits` map to `build`; `auto-bypass` maps to `auto`.
- Commit style: lowercase imperative, no prefix convention observed (`Add headless/print mode`), so use e.g. `Replace permission modes with plan/build/auto`.

---

### Task 1: Mode type, cycle, labels, manager semantics

**Files:**
- Modify: `src/config/types.ts:10`
- Modify: `src/permissions/types.ts` (no change needed — re-exports)
- Modify: `src/permissions/manager.ts`
- Modify: `src/permissions/manager.test.ts`

**Interfaces:**
- Produces: `type PermissionMode = "plan" | "build" | "auto"`; `MODE_CYCLE: PermissionMode[]` = `["plan", "build", "auto"]`; `MODE_LABELS: Record<PermissionMode, string>`; `PermissionManager.check(request): Promise<"approved" | "denied">` unchanged signature.

- [ ] **Step 1: Rewrite the failing tests**

Replace the body of `src/permissions/manager.test.ts` with:

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MODE_CYCLE, PermissionManager } from "./manager.js";
import type { RiskTier } from "../tools/types.js";

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "stak-perms-"));
}

function request(tier: RiskTier, toolName = "bash"): {
  toolName: string;
  riskTier: RiskTier;
  args: unknown;
} {
  return { toolName, riskTier: tier, args: {} };
}

describe("PermissionManager modes", () => {
  let cwd: string;
  beforeEach(() => { cwd = tmpDir(); });
  afterEach(() => { try { require("node:fs").rmSync(cwd, { recursive: true, force: true }); } catch {} });

  test("MODE_CYCLE is exactly plan/build/auto", () => {
    expect(MODE_CYCLE).toEqual(["plan", "build", "auto"]);
  });

  test("read-only tools never prompt in any mode", async () => {
    for (const mode of MODE_CYCLE) {
      const manager = new PermissionManager(mode, cwd);
      expect(await manager.check(request("read-only"))).toBe("approved");
    }
  });

  test("plan denies edit and bash outright without prompting", async () => {
    const manager = new PermissionManager("plan", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("denied");
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
    expect(prompter).not.toHaveBeenCalled();
  });

  test("build runs edits silently, still asks for bash", async () => {
    const manager = new PermissionManager("build", cwd);
    const prompter = vi.fn(async () => "approved" as const);
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();
    expect(await manager.check(request("bash", "bash"))).toBe("approved");
    expect(prompter).toHaveBeenCalledTimes(1);
  });

  test("build denies bash when no prompter is registered", async () => {
    const manager = new PermissionManager("build", cwd);
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
  });

  test("auto approves everything without prompting", async () => {
    const manager = new PermissionManager("auto", cwd);
    const prompter = vi.fn();
    manager.setPrompter(prompter);
    expect(await manager.check(request("edit", "edit"))).toBe("approved");
    expect(await manager.check(request("bash", "bash"))).toBe("approved");
    expect(prompter).not.toHaveBeenCalled();
  });

  test("prompter denial wins over mode approval", async () => {
    const manager = new PermissionManager("build", cwd);
    manager.setPrompter(async () => "denied");
    expect(await manager.check(request("bash", "bash"))).toBe("denied");
  });

  test("cycleMode walks plan → build → auto → plan", async () => {
    const manager = new PermissionManager("plan", cwd);
    expect(await manager.cycleMode()).toBe("build");
    expect(await manager.cycleMode()).toBe("auto");
    expect(await manager.cycleMode()).toBe("plan");
  });

  test("denialReason explains plan mode deferral", () => {
    const manager = new PermissionManager("plan", cwd);
    expect(manager.denialReason("edit")).toContain("plan mode");
  });

  test("denialReason explains user decline outside plan", () => {
    const manager = new PermissionManager("build", cwd);
    expect(manager.denialReason("bash")).toContain("declined");
  });
});
```

Note: replace the `afterEach`'s `require` with a top-of-file `import { rmSync } from "node:fs";` and call `rmSync(cwd, { recursive: true, force: true })` — ESM has no `require`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/permissions/manager.test.ts`
Expected: FAIL — `"build"` not assignable to `PermissionMode` / MODE_CYCLE mismatch.

- [ ] **Step 3: Implement**

In `src/config/types.ts:10` replace:

```ts
export type PermissionMode = "plan" | "ask" | "accept-edits" | "auto-bypass";
```

with:

```ts
export type PermissionMode = "plan" | "build" | "auto";
```

In `src/permissions/manager.ts` replace `MODE_CYCLE`, `MODE_LABELS`, and `requiresApproval` (lines 16–23 and 79–95):

```ts
export const MODE_CYCLE: PermissionMode[] = ["plan", "build", "auto"];

export const MODE_LABELS: Record<PermissionMode, string> = {
  plan: "research freely — no edits or commands until you switch out",
  build: "edits run automatically, commands ask first",
  auto: "nothing asks",
};
```

```ts
  private requiresApproval(tier: RiskTier): boolean {
    if (tier === "read-only") return false;

    switch (this.mode) {
      case "auto":
        return false;
      case "build":
        // Commands stay gated even here: an edit leaves a diff you can read
        // and revert, an arbitrary shell command does not.
        return tier === "bash";
      case "plan":
        // check() short-circuits plan mode before this is ever reached.
        return true;
    }
  }
```

The `check()` method body is unchanged — it already encodes "plan denies without prompting, read-only always approved, otherwise consult requiresApproval then prompter".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/permissions/manager.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts src/permissions/manager.ts src/permissions/manager.test.ts
git commit -m "Replace permission modes with plan/build/auto"
```

---

### Task 2: Old-mode migration in config loading

**Files:**
- Modify: `src/config/load.ts:108-119` (`coerceMode`)
- Modify: `src/config/load.test.ts`

**Interfaces:**
- Consumes: `PermissionMode` from Task 1.
- Produces: `coerceMode(value: string | undefined, warnings: string[]): PermissionMode` mapping `ask|accept-edits → build`, `auto-bypass → auto` with one warning each; unknown values warn and fall back to `"build"` (the new sensible default).

- [ ] **Step 1: Add failing tests**

Append to the imports and describe block in `src/config/load.test.ts` (match existing helpers already present there — reuse whatever temp-dir helper the file defines; if it writes settings files, follow that pattern):

```ts
describe("permission mode migration", () => {
  function coerce(value: string | undefined, warnings: string[]) {
    return loadConfigForTest({ permissionMode: value, warnings });
  }

  test("ask migrates to build with a warning", () => {
    const warnings: string[] = [];
    expect(coerce("ask", warnings)).toBe("build");
    expect(warnings.join("\n")).toContain('"ask"');
    expect(warnings.join("\n")).toContain("build");
  });

  test("accept-edits migrates to build", () => {
    const warnings: string[] = [];
    expect(coerce("accept-edits", warnings)).toBe("build");
    expect(warnings.length).toBe(1);
  });

  test("auto-bypass migrates to auto", () => {
    const warnings: string[] = [];
    expect(coerce("auto-bypass", warnings)).toBe("auto");
    expect(warnings.join("\n")).toContain("auto");
  });

  test("new values pass through untouched", () => {
    const warnings: string[] = [];
    expect(coerce("plan", warnings)).toBe("plan");
    expect(coerce("build", warnings)).toBe("build");
    expect(coerce("auto", warnings)).toBe("auto");
    expect(warnings.length).toBe(0);
  });

  test("undefined falls back to build with no warning", () => {
    const warnings: string[] = [];
    expect(coerce(undefined, warnings)).toBe("build");
    expect(warnings.length).toBe(0);
  });

  test("unknown values fall back to build with a warning", () => {
    const warnings: string[] = [];
    expect(coerce("yolo", warnings)).toBe("build");
    expect(warnings.length).toBe(1);
  });
});
```

If `loadConfigForTest` does not exist, export `coerceMode` from `load.ts` for direct testing instead and call `coerceMode(value, warnings)` — prefer this simpler route; delete the wrapper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/load.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/config/load.ts` replace `coerceMode`:

```ts
const MODE_MIGRATIONS: Record<string, PermissionMode> = {
  ask: "build",
  "accept-edits": "build",
  "auto-bypass": "auto",
};

function coerceMode(
  value: string | undefined,
  warnings: string[],
): PermissionMode {
  if (value === undefined) return "build";
  const migrated = MODE_MIGRATIONS[value];
  if (migrated !== undefined) {
    warnings.push(
      `Permission mode "${value}" was removed — using "${migrated}". Update .stak/settings.json to "${migrated}".`,
    );
    return migrated;
  }
  if ((MODE_CYCLE as string[]).includes(value)) return value as PermissionMode;
  warnings.push(`Unknown permission mode "${value}", falling back to build.`);
  return "build";
}
```

Keep the `MODE_CYCLE` import; drop the old comment block above the function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/load.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/load.ts src/config/load.test.ts
git commit -m "Migrate removed permission modes on config load"
```

---

### Task 3: Validate `--permission-mode` in headless options

**Files:**
- Modify: `src/headless/options.ts`
- Modify: `src/headless/options.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PERMISSION_MODES: readonly ["plan", "build", "auto"]`; `resolveInvocation` returns `{ mode: "error", message }` for values outside the trio, with legacy-name hints.

- [ ] **Step 1: Add failing tests**

Append to `src/headless/options.test.ts`:

```ts
describe("--permission-mode validation", () => {
  const base = { print: true, positional: ["hi"], resumePicker: false };

  test("accepts plan/build/auto", () => {
    for (const permissionMode of ["plan", "build", "auto"]) {
      const result = resolveInvocation({ ...base, permissionMode });
      expect(result).toMatchObject({ mode: "print", permissionMode });
    }
  });

  test("rejects auto-bypass with a hint toward auto", () => {
    const result = resolveInvocation({ ...base, permissionMode: "auto-bypass" });
    expect(result.mode).toBe("error");
    if (result.mode === "error") {
      expect(result.message).toContain("auto-bypass");
      expect(result.message).toContain("auto");
    }
  });

  test("rejects accept-edits with a hint toward build", () => {
    const result = resolveInvocation({ ...base, permissionMode: "accept-edits" });
    expect(result.mode).toBe("error");
    if (result.mode === "error") expect(result.message).toContain("build");
  });

  test("rejects fully unknown values listing valid ones", () => {
    const result = resolveInvocation({ ...base, permissionMode: "yolo" });
    expect(result.mode).toBe("error");
    if (result.mode === "error") {
      expect(result.message).toContain("plan, build, auto");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/headless/options.test.ts`
Expected: FAIL (values currently pass through unvalidated).

- [ ] **Step 3: Implement**

In `src/headless/options.ts` add near `OUTPUT_FORMATS`:

```ts
export const PERMISSION_MODES = ["plan", "build", "auto"] as const;

/** Removed v0.2 mode names → what to tell the user to use instead. */
const LEGACY_PERMISSION_MODES: Record<string, string> = {
  ask: "build",
  "accept-edits": "build",
  "auto-bypass": "auto",
};
```

Inside `resolveInvocation`, immediately after the `--output-format` validation block (before the stdin handling), insert:

```ts
  if (raw.permissionMode !== undefined) {
    const legacy = LEGACY_PERMISSION_MODES[raw.permissionMode];
    if (legacy !== undefined) {
      return {
        mode: "error",
        message: `Permission mode "${raw.permissionMode}" was removed — use "${legacy}".`,
      };
    }
    if (!(PERMISSION_MODES as readonly string[]).includes(raw.permissionMode)) {
      return {
        mode: "error",
        message: `Unknown --permission-mode "${raw.permissionMode}". Valid modes: ${PERMISSION_MODES.join(", ")}.`,
      };
    }
  }
```

Then in `src/cli.ts:145-148` the cast `invocation.permissionMode as PermissionMode` is now safe — leave as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/headless/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/headless/options.ts src/headless/options.test.ts
git commit -m "Validate --permission-mode against plan/build/auto"
```

---

### Task 4: Mode-aware system prompt + wiring

**Files:**
- Modify: `src/agent/systemPrompt.ts`
- Modify: `src/agent/systemPrompt.test.ts`
- Modify: `src/cli.ts:192-200,305`
- Modify: `src/dev-cli.ts:76`
- Modify: `src/tui/App.tsx:38,113,297`

**Interfaces:**
- Consumes: `PermissionMode`.
- Produces: `SystemPromptOptions.permissionMode?: PermissionMode` replacing `planMode?: boolean`; `systemPromptFor(mode: PermissionMode): string` signature used by `cli.ts` and `App.tsx`.

- [ ] **Step 1: Rewrite the failing tests**

Update `src/agent/systemPrompt.test.ts`: replace every `planMode:` occurrence with `permissionMode:` and add:

```ts
test("build mode describes its gating", () => {
  const prompt = buildSystemPrompt({ cwd: "/p", permissionMode: "build" });
  expect(prompt).toContain("# Permissions");
  expect(prompt).toContain("run automatically");
  expect(prompt).toContain("ask");
});

test("auto mode says nothing asks", () => {
  const prompt = buildSystemPrompt({ cwd: "/p", permissionMode: "auto" });
  expect(prompt).toContain("# Permissions");
  expect(prompt.toLowerCase()).toContain("without approval");
});

test("no permissions section without a mode", () => {
  expect(buildSystemPrompt({ cwd: "/p" })).not.toContain("# Permissions");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agent/systemPrompt.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/agent/systemPrompt.ts` change the option and section:

```ts
import type { PermissionMode } from "../config/types.js";

export interface SystemPromptOptions {
  cwd: string;
  skills?: { name: string; description: string }[];
  /** Current permission mode — plan steers research behavior; build/auto
   * get one honest line about their gating so the model predicts prompts. */
  permissionMode?: PermissionMode;
  memory?: string;
}
```

Replace the `if (options.planMode)` block with:

```ts
  if (options.permissionMode === "plan") {
    sections.push(
      "",
      "# Plan mode is active",
      "The write, edit, and bash tools are disabled — calling them will fail. Use read, grep, glob, and Skill freely to research the task.",
      "Once you understand what's needed, present a clear, concrete plan for what you would do and stop. Do not attempt the change yet.",
      "The user reviews the plan and switches out of plan mode themselves when they want you to proceed — do not tell them to do this, and do not retry blocked tools waiting for that to happen.",
    );
  } else if (options.permissionMode === "build") {
    sections.push(
      "",
      "# Permissions",
      "File edits run automatically. Shell commands require the user's approval, so batch meaningful work between them.",
    );
  } else if (options.permissionMode === "auto") {
    sections.push(
      "",
      "# Permissions",
      "All tools run without approval prompts.",
    );
  }
```

In `src/cli.ts`: change `systemPromptFor` to take the mode —

```ts
const systemPromptFor = (mode: PermissionMode) =>
  buildSystemPrompt({
    cwd,
    skills,
    permissionMode: mode,
    memory: formatMemory(memory.files),
  });
```

and line 200 becomes `systemPrompt: systemPromptFor(permissions.getMode()),`. At line ~305 keep passing `systemPromptFor` unchanged (signature updated at definition). Import `PermissionMode` type if not already imported (it is, for line 145).

In `src/dev-cli.ts:76` change `planMode: permissionMode === "plan"` to `permissionMode: permissionMode as PermissionMode` (add the type import).

In `src/tui/App.tsx`: prop type line 38 becomes

```ts
systemPromptFor?: (mode: PermissionMode) => string;
```

line 113 becomes `ctx.systemPrompt = systemPromptFor?.(next as PermissionMode) ?? ctx.systemPrompt;`, line 297 becomes `ctx.systemPrompt = systemPromptFor?.(mode as PermissionMode) ?? ctx.systemPrompt;`. Import the type.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. (`commands.test.ts` may still reference `"auto-bypass"` — fix in Task 7; if typecheck fails only there, note it and continue.)

- [ ] **Step 5: Commit**

```bash
git add src/agent/systemPrompt.ts src/agent/systemPrompt.test.ts src/cli.ts src/dev-cli.ts src/tui/App.tsx
git commit -m "Make the system prompt mode-aware"
```

---

### Task 5: Hooks config shape, parsing, merging

**Files:**
- Create: `src/hooks/config.ts`
- Create: `src/hooks/config.test.ts`
- Modify: `src/mcp/types.ts` (none — keep separate; do NOT touch mcp)
- Modify: `src/config/types.ts` (GlobalConfig, ProjectSettings, ResolvedConfig)
- Modify: `src/config/load.ts`

**Interfaces:**
- Produces:
```ts
// src/hooks/config.ts
export interface HookEntry {
  name: string;
  /** Regex source tested against the tool name; absent = match all. */
  match?: string;
  run: string;
  timeout?: number;
}
export interface HooksConfig {
  beforeTool?: HookEntry[];
  afterTool?: HookEntry[];
}
export interface ParsedHooks {
  hooks: Required<Pick<HooksConfig, "beforeTool" | "afterTool">>;
  warnings: string[];
}
export function parseHooks(source: object | undefined, label: string): ParsedHooks
export function mergeHooks(global: ParsedHooks["hooks"], project: ParsedHooks["hooks"]): ParsedHooks["hooks"]
```
Merge rule: concatenation of phases, where a project entry whose `name` equals a global entry's `name` (within the same phase) replaces it, preserving position order (global first, project after).
- `ResolvedConfig.hooks: ParsedHooks["hooks"]`.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/config.test.ts`:

```ts
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
          afterTool: [{ name: "fmt", run: "prettier --write $FILE", timeout: 5000 }],
        },
      },
      "global",
    );
    expect(parsed.hooks.beforeTool).toHaveLength(1);
    expect(parsed.hooks.beforeTool[0]).toMatchObject({ name: "guard", match: "bash" });
    expect(parsed.hooks.afterTool[0]?.timeout).toBe(5000);
    expect(parsed.warnings).toEqual([]);
  });

  test("warns and skips entries without name or run", () => {
    const parsed = parseHooks(
      { hooks: { beforeTool: [{ run: "x.js" }, { name: "a" }, { name: "ok", run: "y.js" }] } },
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
      { beforeTool: [{ name: "a", run: "global-a.js" }, { name: "b", run: "b.js" }], afterTool: [] },
      { beforeTool: [{ name: "a", run: "project-a.js" }], afterTool: [] },
    );
    expect(merged.beforeTool.map((h) => h.name)).toEqual(["b", "a"]);
    expect(merged.beforeTool[1]?.run).toBe("project-a.js");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hooks/config.ts`**

```ts
/**
 * Declarative JSON hooks: configuration shape, per-source parsing, and
 * global/project merging. Parsing mirrors parseMcpServers — never throws,
 * collects warnings instead.
 */
export interface HookEntry {
  name: string;
  match?: string;
  run: string;
  timeout?: number;
}

export interface HooksConfig {
  beforeTool?: HookEntry[];
  afterTool?: HookEntry[];
}

export type PhaseHooks = { beforeTool: HookEntry[]; afterTool: HookEntry[] };

export interface ParsedHooks {
  hooks: PhaseHooks;
  warnings: string[];
}

const PHASES = ["beforeTool", "afterTool"] as const;
const DEFAULT_TIMEOUT_MS = 10_000;

export function parseHooks(source: object | undefined, label: string): ParsedHooks {
  const hooks: PhaseHooks = { beforeTool: [], afterTool: [] };
  const warnings: string[] = [];
  const raw = (source as { hooks?: unknown } | undefined)?.hooks;
  if (raw === undefined) return { hooks, warnings };

  if (typeof raw !== "object" || raw === null) {
    warnings.push(`Ignoring "hooks" in ${label} config — expected an object.`);
    return { hooks, warnings };
  }

  for (const phase of PHASES) {
    const entries = (raw as Record<string, unknown>)[phase];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) {
      warnings.push(`hooks.${phase} in ${label} config must be an array — ignored.`);
      continue;
    }
    for (const entry of entries as Record<string, unknown>[]) {
      const name = typeof entry?.name === "string" ? entry.name : undefined;
      const run = typeof entry?.run === "string" && entry.run.trim() !== "" ? entry.run : undefined;
      if (name === undefined || run === undefined) {
        warnings.push(`Skipping a hooks.${phase} entry in ${label} config — "name" and "run" are required.`);
        continue;
      }
      const match = typeof entry.match === "string" ? entry.match : undefined;
      if (match !== undefined) {
        try {
          new RegExp(match);
        } catch {
          warnings.push(`Skipping hook "${name}" in ${label} config — invalid regex: ${match}`);
          continue;
        }
      }
      const timeout =
        typeof entry.timeout === "number" && Number.isFinite(entry.timeout) && entry.timeout > 0
          ? entry.timeout
          : DEFAULT_TIMEOUT_MS;
      if (
        entry.timeout !== undefined &&
        !(typeof entry.timeout === "number" && entry.timeout > 0)
      ) {
        warnings.push(`Ignoring non-positive timeout for hook "${name}" in ${label} config — using ${DEFAULT_TIMEOUT_MS}ms.`);
      }
      hooks[phase].push({ name, ...(match !== undefined ? { match } : {}), run, timeout });
    }
  }

  return { hooks, warnings };
}

export function mergeHooks(global: PhaseHooks, project: PhaseHooks): PhaseHooks {
  return {
    beforeTool: mergePhase(global.beforeTool, project.beforeTool),
    afterTool: mergePhase(global.afterTool, project.afterTool),
  };
}

function mergePhase(global: HookEntry[], project: HookEntry[]): HookEntry[] {
  const merged = [...global];
  for (const entry of project) {
    const index = merged.findIndex((existing) => existing.name === entry.name);
    if (index === -1) merged.push(entry);
    else merged[index] = entry;
  }
  return merged;
}
```

Wire into config types: in `src/config/types.ts` add `hooks?: HooksConfig;` to `GlobalConfig` and `ProjectSettings` (importing `type { HooksConfig } from "../hooks/config.js"`), and `hooks: PhaseHooks;` to `ResolvedConfig` (import `type { PhaseHooks }`). In `src/config/load.ts`, alongside the MCP parsing block:

```ts
const globalHooks = parseHooks(global, "global");
const projectHooks = parseHooks(project, "project");
warnings.push(...globalHooks.warnings, ...projectHooks.warnings);
```

and add to the returned object: `hooks: mergeHooks(globalHooks.hooks, projectHooks.hooks),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/config.test.ts src/config/load.test.ts && npm run typecheck`
Expected: PASS. If `load.test.ts` asserts the full resolved-config shape, add `hooks` where it constructs expectations.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/config.ts src/hooks/config.test.ts src/config/types.ts src/config/load.ts
git commit -m "Add declarative hook configuration parsing"
```

---

### Task 6: HookRunner

**Files:**
- Create: `src/hooks/runner.ts`
- Create: `src/hooks/runner.test.ts`

**Interfaces:**
- Consumes: `HookEntry`, `PhaseHooks` from Task 5.
- Produces:
```ts
export interface HookInvocation {
  tool: string;
  args: unknown;
  cwd: string;
}
export interface HookOutcome {
  blocked: boolean;
  reasons: string[];
  notices: string[];
}
export class HookRunner {
  constructor(hooks: PhaseHooks)
  run(phase: "beforeTool" | "afterTool", invocation: HookInvocation): Promise<HookOutcome>
}
```
Semantics: matched hooks run sequentially with `shell: true`, JSON payload `{ tool, args, cwd, phase }` on stdin, `$name` tokens in the command replaced by string-valued top-level args (unknown tokens untouched). Nonzero exit on beforeTool → blocked with stderr as reason; on afterTool → notice. Timeout kills the process: beforeTool → blocked with reason; afterTool → notice. Empty hook set returns immediately.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/runner.test.ts`:

```ts
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { HookEntry } from "./config.js";
import { HookRunner } from "./runner.js";

function entry(partial: Partial<HookEntry>): HookEntry {
  return { name: "test-hook", run: "node -e \"process.exit(0)\"", ...partial };
}

const invocation = { tool: "edit", args: { file_path: "a.ts" }, cwd: process.cwd() };

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
    expect((await runner.run("beforeTool", invocation)).blocked).toBe(false);
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
    let seen = "";
    const script = "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{require('fs').writeFileSync(process.env.STAK_TEST_OUT,d)})";
    const runner = new HookRunner({
      beforeTool: [
        entry({
          run: script,
          // env passthrough is part of the contract under test below
        }),
      ],
      afterTool: [],
    });
    // Use a temp file via the OS rather than env mutation of the runner:
    const out = path.join(process.env.STAK_TEMP ?? ".", "hook-payload.json");
    void out;
    const outcome = await runner.run("beforeTool", {
      ...invocation,
    });
    void seen;
    void outcome;
    // Payload delivery is covered by the cwd-pinned variant below.
  });

  test("$arg tokens expand from string args", async () => {
    const runner = new HookRunner({
      afterTool: [
        entry({ run: "node -e \"process.stdout.write(process.argv[1])\" \"$FILE\"", }),
      ],
    });
    const outcome = await runner.run("afterTool", invocation);
    // Expansion is verified by observing the command actually received the
    // expanded value — asserted indirectly through stdout captured in notices
    // is unreliable cross-shell, so this variant checks the runner's own
    // expansion function instead.
    expect(outcome.notices).toEqual(expect.any(Array));
  });

  test("timeout kills the hook and reports", async () => {
    const runner = new HookRunner({
      beforeTool: [entry({ run: "node -e \"setInterval(()=>{},1000)\"", timeout: 200 })],
      afterTool: [],
    });
    const outcome = await runner.run("beforeTool", invocation);
    expect(outcome.blocked).toBe(true);
    expect(outcome.reasons.join(" ")).toContain("timed out");
  });

  test("afterTool failure produces a notice, not a block", async () => {
    const runner = new HookRunner({
      beforeTool: [],
      afterTool: [entry({ run: "node -e \"console.error('formatter exploded'); process.exit(3)\"" })],
    });
    const outcome = await runner.run("afterTool", invocation);
    expect(outcome.blocked).toBe(false);
    expect(outcome.notices.join(" ")).toContain("formatter exploded");
  });
});
```

Two of these sketches are placeholders — replace them with the concrete versions below before running (the skill forbids vague tests):

Payload-delivery test (replaces "receives the JSON payload on stdin"):

```ts
test("receives the JSON payload on stdin", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
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
  await runner.run("beforeTool", invocation);
  const payload = JSON.parse(fs.readFileSync(outFile, "utf8"));
  expect(payload).toMatchObject({ tool: "edit", phase: "beforeTool", args: { file_path: "a.ts" } });
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Expansion test (replaces "$arg tokens expand"):

```ts
test("$arg tokens expand from string args", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stak-hook-"));
  const outFile = path.join(dir, "seen.txt").replace(/\\/g, "/");
  const runner = new HookRunner({
    beforeTool: [
      entry({
        run: `node -e "require('node:fs').writeFileSync('${outFile}',process.argv[1])" "$FILE"`,
      }),
    ],
    afterTool: [],
  });
  await runner.run("beforeTool", { tool: "edit", args: { file_path: "a.ts" }, cwd: process.cwd() });
  expect(fs.readFileSync(outFile, "utf8")).toBe("a.ts");
  fs.rmSync(dir, { recursive: true, force: true });
});
```

And extend `HookRunner`'s public surface for direct verification: export

```ts
export function expandArgTokens(command: string, args: unknown): string
```

plus one unit test:

```ts
test("expandArgTokens substitutes known string args and leaves others", () => {
  expect(expandArgTokens("lint $FILE --fix $MISSING", { file_path: "x.ts" })).toBe(
    "lint x.ts --fix $MISSING",
  );
});
```

with `expandArgTokens` mapping `$file_path` AND camelCase alias `$filePath`/shorthand `$FILE` — simplest rule: substitute `$key` for each key in `args` whose value is a string, plus uppercase shorthand `$KEY`. Unknown `$TOKEN`s remain literal.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hooks/runner.ts`**

```ts
import { spawn } from "node:child_process";
import type { HookEntry, PhaseHooks } from "./config.js";

export interface HookInvocation {
  tool: string;
  args: unknown;
  cwd: string;
}

export interface HookOutcome {
  blocked: boolean;
  reasons: string[];
  notices: string[];
}

/** Replaces $token with the string value of args[token] (exact key or its
 * uppercase form); unknown tokens stay literal so real env vars survive
 * until the shell expands them. */
export function expandArgTokens(command: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return command;
  let expanded = command;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    for (const token of [`$${key}`, `$${key.toUpperCase()}`]) {
      expanded = expanded.split(token).join(value);
    }
  }
  return expanded;
}

export class HookRunner {
  private readonly hooks: PhaseHooks;

  constructor(hooks: PhaseHooks) {
    this.hooks = hooks;
  }

  async run(phase: "beforeTool" | "afterTool", invocation: HookInvocation): Promise<HookOutcome> {
    const outcome: HookOutcome = { blocked: false, reasons: [], notices: [] };
    const entries = this.hooks[phase];
    if (entries.length === 0) return outcome;

    const payload = JSON.stringify({ ...invocation, phase });
    for (const hook of entries) {
      if (hook.match !== undefined && !new RegExp(hook.match).test(invocation.tool)) {
        continue;
      }
      const result = await this.spawnOne(hook, payload, invocation.cwd);
      if (result.ok) continue;

      const detail = `${result.stderr.trim()} `.trim();
      if (phase === "beforeTool") {
        outcome.blocked = true;
        outcome.reasons.push(
          detail !== ""
            ? `blocked by hook "${hook.name}": ${detail}`
            : `blocked by hook "${hook.name}" (exit ${result.code}).`,
        );
      } else {
        outcome.notices.push(
          detail !== ""
            ? `hook "${hook.name}" failed: ${detail}`
            : `hook "${hook.name}" failed with exit ${result.code}.`,
        );
      }
    }
    return outcome;
  }

  private spawnOne(
    hook: HookEntry,
    payload: string,
    cwd: string,
  ): Promise<{ ok: boolean; code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(expandArgTokens(hook.run, payloadArgs(payload)), {
        shell: true,
        cwd,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve({ ok: false, code: null, stderr: `${stderr}\nhook timed out after ${hook.timeout}ms` });
      }, hook.timeout);

      child.stdout?.on("data", () => {});
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: null, stderr: `${stderr}\n${error.message}` });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stderr });
      });

      child.stdin?.end(payload);
    });
  }
}

function payloadArgs(payload: string): unknown {
  try {
    return (JSON.parse(payload) as { args?: unknown }).args;
  } catch {
    return undefined;
  }
}
```

Note on `stdio`: stdout is piped-but-drained so chatty hooks can't deadlock on a full pipe buffer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/runner.ts src/hooks/runner.test.ts
git commit -m "Add HookRunner executing beforeTool/afterTool commands"
```

---

### Task 7: Wire hooks into ToolRegistry + surface notices

**Files:**
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`
- Modify: `src/agent/types.ts` (AgentEvent tool-call-result)
- Modify: `src/agent/loop.ts` (thread notices)
- Modify: `src/cli.ts` (construct HookRunner, pass to registry)

**Interfaces:**
- Consumes: `HookRunner.run(phase, { tool, args, cwd })` from Task 6; `ResolvedConfig.hooks` from Task 5.
- Produces: `execute()` return gains `notices: string[]`; loop event `{ type: "tool-call-result", ..., notices?: string[] }`; `ToolRegistryOptions.hooks?: HookRunner`.
- Veto output format: `Blocked by hook: <reason>` returned as an error tool result (model-visible), matching denial conventions.

- [ ] **Step 1: Add failing registry tests**

In `src/tools/registry.test.ts` add (reusing the file's existing fake-tool helpers):

```ts
test("beforeTool veto blocks execution and reports the hook reason", async () => {
  const hooks = {
    run: vi.fn(async () => ({ blocked: true, reasons: ['blocked by hook "guard": no writes'], notices: [] })),
  };
  const registry = makeRegistryWithHooks(hooks); // helper: registry constructed with { hooks }
  const result = await registry.execute({ name: "write", input: validWriteInput() });
  expect(result.isError).toBe(true);
  expect(result.output).toContain("guard");
  expect(result.output).toContain("no writes");
});

test("approved calls run beforeTool then the tool then afterTool in order", async () => {
  const order: string[] = [];
  const hooks = {
    run: vi.fn(async (_phase: string) => { order.push(_phase); return { blocked: false, reasons: [], notices: [] }; }),
  };
  const registry = makeRegistryWithHooks(hooks, { onExecute: () => order.push("tool") });
  await registry.execute({ name: "read", input: validReadInput() });
  expect(order).toEqual(["beforeTool", "tool", "afterTool"]);
});

test("afterTool notices ride along on a successful result", async () => {
  const hooks = {
    run: vi.fn(async (phase: string) =>
      phase === "afterTool"
        ? { blocked: false, reasons: [], notices: ['hook "fmt" failed: exploded'] }
        : { blocked: false, reasons: [], notices: [] },
    ),
  };
  const registry = makeRegistryWithHooks(hooks);
  const result = await registry.execute({ name: "read", input: validReadInput() });
  expect(result.notices).toEqual(['hook "fmt" failed: exploded']);
});

test("plan-denied calls never invoke hooks", async () => {
  const hooks = { run: vi.fn() };
  const registry = makeRegistryWithHooks(hooks, { mode: "plan" });
  await registry.execute({ name: "write", input: validWriteInput() });
  expect(hooks.run).not.toHaveBeenCalled();
});
```

Implement `makeRegistryWithHooks` next to the file's existing construction helper, delegating to it with `{ ...options, hooks }` where `hooks` is cast `as unknown as HookRunner`. Reuse whatever `validWriteInput`/`validReadInput` fixtures exist; if none exist inline minimal schema-valid args copied from the existing tests in that file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/registry.test.ts`
Expected: FAIL — no `hooks` option, no `notices` on results.

- [ ] **Step 3: Implement**

`src/tools/registry.ts`:

```ts
import type { HookRunner } from "../hooks/runner.js";

export interface ToolRegistryOptions {
  cwd: string;
  permissions: PermissionManager;
  hooks?: HookRunner;
  extra?: AnyTool[];
}
```

field `private readonly hooks?: HookRunner;` assigned in the constructor. In `execute()`:

```ts
    if (decision === "denied") {
      return { output: this.permissions.denialReason(tool.name), isError: true, notices: [] };
    }

    if (this.hooks) {
      const before = await this.hooks.run("beforeTool", {
        tool: tool.name,
        args: parsed.data,
        cwd: this.cwd,
      });
      if (before.blocked) {
        return {
          output: [`Blocked before running ${tool.name}.`, ...before.reasons].join(" "),
          isError: true,
          notices: [],
        };
      }
    }

    try {
      const result = await tool.execute(parsed.data as never, { cwd: this.cwd, signal });
      const notices = this.hooks
        ? (await this.hooks.run("afterTool", { tool: tool.name, args: parsed.data, cwd: this.cwd })).notices
        : [];
      return { output: result.output, isError: result.isError ?? false, notices };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
        notices: [],
      };
    }
```

Update the declared return type to `Promise<ToolResult & { isError: boolean; notices: string[] }>`, and add `notices: []` to the two early returns (missing-tool, invalid-args).

`src/agent/types.ts` — extend the event:

```ts
  | {
      type: "tool-call-result";
      id: string;
      name: string;
      output: string;
      isError: boolean;
      /** afterTool hook messages — display-only, never model-visible. */
      notices?: string[];
    }
```

`src/agent/loop.ts` — in the tool-result yield spread `...(result.notices?.length ? { notices: result.notices } : {})`. The `resultBlocks` push stays notices-free (model never sees them).

`src/cli.ts` — after `new PermissionManager(...)`:

```ts
const hookRunner = new HookRunner(config.hooks);
```

pass `hooks: hookRunner` into `new ToolRegistry({...})`, import `HookRunner` from `./hooks/runner.js`.

TUI surfacing: in `src/tui/hooks/useAgentSession.ts` `tool-call-result` handler, after updating the target message also append one dim notice item per entry:

```ts
for (const notice of event.notices ?? []) {
  current.push({ kind: "notice", text: notice });
}
```

inside the same `setMessages` updater after the tool-item update (guard: only push when `event.notices?.length`). This is a display concern; headless render ignores the field for now (P4 revisits formatting).

- [ ] **Step 4: Run tests + typecheck, fix stragglers**

Run: `npm test && npm run typecheck`
Expected: PASS. Fix `commands.test.ts:184` (`"auto-bypass"` → `"auto"`) and `App.test.tsx:85` (`"ask"` → `"build"`) now — both were deferred earlier. `dev-cli.ts` may need `hooks` omitted (optional).

- [ ] **Step 5: Full-suite green, commit**

Run: `npm test && npm run typecheck`
Expected: all suites PASS, zero type errors.

```bash
git add -A
git commit -m "Run beforeTool/afterTool hooks around gated tool executions"
```

---

### Task 8: `/hooks` command

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/commands/types.ts` (CommandContext gains `listHooks`)
- Modify: `src/commands/commands.test.ts`
- Modify: `src/tui/App.tsx` (provide `listHooks`)
- Modify: `src/cli.ts` (pass hook data through)

**Interfaces:**
- Produces: `CommandContext.listHooks(): { phase: string; name: string; match?: string; run: string; source: "global" | "project" }[]`.

- [ ] **Step 1: Failing test**

In `src/commands/commands.test.ts` add:

```ts
test("/hooks lists entries from both sources", () => {
  const ctx = baseCtx({
    listHooks: () => [
      { phase: "beforeTool", name: "guard", match: "bash", run: "node g.js", source: "project" },
      { phase: "afterTool", name: "fmt", run: "prettier --write $FILE", source: "global" },
    ],
  });
  const result = dispatchCommand(ctx, "/hooks");
  expect(result.kind).toBe("notice");
  if (result.kind === "notice") {
    expect(result.text).toContain("guard");
    expect(result.text).toContain("bash");
    expect(result.text).toContain("project");
    expect(result.text).toContain("global");
  }
});

test("/hooks says none configured when empty", () => {
  const ctx = baseCtx({ listHooks: () => [] });
  const result = dispatchCommand(ctx, "/hooks");
  expect(result.kind).toBe("notice");
  if (result.kind === "notice") expect(result.text).toContain("No hooks configured");
});
```

Reuse the file's existing ctx factory naming (`baseCtx`/`dispatchCommand` stand in for whatever helpers exist there).

To support source attribution, change Task 5's merge to track provenance: `mergeHooks` returns entries as-is but `ResolvedConfig` additionally carries `hookSources: Record<string, "global" | "project">` keyed by hook name (project wins). Update `src/config/load.ts` accordingly and `listHooks` derives `source` from that record.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/commands/commands.test.ts`
Expected: FAIL — no /hooks builtin.

- [ ] **Step 3: Implement**

`src/commands/builtins.ts` — insert after the `mcp` command:

```ts
  {
    name: "hooks",
    description: "show configured beforeTool/afterTool hooks",
    source: "builtin",
    run(ctx) {
      const hooks = ctx.listHooks();

      if (hooks.length === 0) {
        return {
          kind: "notice",
          text: "No hooks configured. Add them under `hooks` in ~/.stak/config.json or .stak/settings.json.",
        };
      }

      const lines = hooks.map((hook) => {
        const match = hook.match ? ` match=${hook.match}` : "";
        return `  ${hook.phase.padEnd(11)}${hook.name}${match} (${hook.source}): ${hook.run}`;
      });

      return { kind: "notice", text: ["Hooks:", ...lines].join("\n") };
    },
  },
```

Extend `CommandContext` in `src/commands/types.ts` with `listHooks: () => { phase: string; name: string; match?: string; run: string; source: string }[];` — provide it in `App.tsx`'s ctx assembly and anywhere else the context literal is built (`commands.test.ts` factories gain a `listHooks: () => []` default).

`src/hooks/config.ts` — extend `ParsedHooks` with `sources: Record<string, "global" | "project">`; populate in `load.ts` (`global` set first, `project` overwrites). Thread `config.hookSources` into `cli.ts`'s ctx provider.

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add /hooks command listing configured hooks"
```

---

## Self-Review Notes

- Spec coverage: modes table → Tasks 1–3; migration → Task 2; system prompt → Task 4; hooks config/order/veto/timeouts/$-expansion → Tasks 5–6; permission-first ordering + notices → Task 7; `/hooks` → Task 8. Headless `build` bash-deny falls out of Task 1's no-prompter rule (covered by its own test).
- Type consistency: `PhaseHooks` used by Tasks 5→6→7; `notices: string[]` consistent across registry/event/TUI; `hookSources` introduced in Task 8 step 1 retroactively required from Task 5's merge — implemented in Task 8 step 3.
- Known follow-ups deliberately deferred: README/docs (P5), renderer cards (P4).
