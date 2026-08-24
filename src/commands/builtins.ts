import { describeCompaction } from "../agent/compact.js";
import { describeMemory } from "../memory/format.js";
import { MODE_CYCLE, MODE_LABELS } from "../permissions/manager.js";
import type { Command } from "./types.js";

export const builtinCommands: Command[] = [
  {
    name: "help",
    description: "show available commands",
    source: "builtin",
    run(ctx) {
      const lines = ctx
        .listCommands()
        .map(({ name, description }) => `  /${name.padEnd(14)}${description}`);

      return {
        kind: "notice",
        text: ["Commands:", ...lines, "", "  shift+tab      cycle permission mode"].join(
          "\n",
        ),
      };
    },
  },

  {
    name: "clear",
    description: "clear the transcript and start a fresh session",
    source: "builtin",
    run(ctx) {
      ctx.clear();
      return { kind: "handled" };
    },
  },

  {
    name: "model",
    description: "show or switch the active model",
    argumentHint: "[model]",
    source: "builtin",
    async run(ctx) {
      const requested = ctx.args.trim();

      if (requested === "") {
        const current = ctx.getModel();
        const available = await ctx.listModels();

        if (!available) {
          return {
            kind: "notice",
            text: `Current model: ${ctx.describeModel()}\nThis provider can't list its models here; run /model <name> to switch.`,
          };
        }

        const lines = available.map(
          (name) => `  ${name === current ? "❯" : " "} ${name}`,
        );
        return {
          kind: "notice",
          text: [`Current model: ${ctx.describeModel()}`, ...lines].join("\n"),
        };
      }

      const before = ctx.describeModel();
      ctx.setModel(requested);
      // Confirming with the before/after pair, not just the new value, is the
      // point: without it a typo-model silently "succeeds" and only the next
      // reply's failure reveals nothing actually changed.
      return { kind: "notice", text: `Model changed: ${before} → ${ctx.describeModel()}` };
    },
  },

  {
    name: "permissions",
    description: "show or set the permission mode",
    // Built from MODE_CYCLE so this can't drift out of sync with the actual
    // valid modes the way the config-loading validator once did.
    argumentHint: `[${MODE_CYCLE.join("|")}]`,
    source: "builtin",
    async run(ctx) {
      const requested = ctx.args.trim();
      if (requested === "") {
        const current = ctx.getPermissionMode();
        const options = MODE_CYCLE.map(
          (mode) => `  ${mode.padEnd(14)}${MODE_LABELS[mode]}`,
        );
        return {
          kind: "notice",
          text: [`Permission mode: ${current}`, ...options].join("\n"),
        };
      }

      if (!MODE_CYCLE.includes(requested as never)) {
        return {
          kind: "error",
          text: `Unknown mode "${requested}". Choose one of: ${MODE_CYCLE.join(", ")}.`,
        };
      }

      const applied = await ctx.setPermissionMode(requested);
      return { kind: "notice", text: `Permission mode: ${applied}` };
    },
  },

  {
    name: "mcp",
    description: "show configured MCP servers",
    source: "builtin",
    run(ctx) {
      const servers = ctx.listMcpServers();

      if (servers.length === 0) {
        return {
          kind: "notice",
          text: "No MCP servers configured. Add them under `mcpServers` in ~/.stak/config.json or .stak/settings.json.",
        };
      }

      const lines = servers.map((server) => {
        const status =
          server.state === "connected"
            ? `connected, ${server.toolCount} tools`
            : `failed — ${server.error ?? "unknown error"}`;
        return `  ${server.name} (${server.source}): ${status}`;
      });

      return {
        kind: "notice",
        text: ["MCP servers:", ...lines].join("\n"),
      };
    },
  },

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

  {
    name: "memory",
    description: "show which project memory files (STAK.md) were loaded",
    source: "builtin",
    async run(ctx) {
      return { kind: "notice", text: describeMemory(await ctx.listMemory()) };
    },
  },

  {
    name: "init",
    description: "ask the model to survey this project and write a STAK.md for it",
    source: "builtin",
    run() {
      return {
        kind: "prompt",
        text: "If a STAK.md file already exists at the project root, read it first and improve/extend it in place rather than replacing its content — never discard existing content the user already added. Otherwise, survey this project: its structure, tech stack, conventions, and any existing docs. Then write a concise STAK.md file at the project root summarizing what a future session should know to work effectively here — architecture notes, conventions, and gotchas.",
      };
    },
  },

  {
    name: "compact",
    description: "summarize the conversation so far to free up context",
    argumentHint: "[focus]",
    source: "builtin",
    async run(ctx) {
      const focus = ctx.args.trim();
      try {
        const result = await ctx.compact(focus === "" ? undefined : focus);
        return { kind: "notice", text: describeCompaction(result) };
      } catch (error) {
        return { kind: "error", text: error instanceof Error ? error.message : String(error) };
      }
    },
  },

  {
    name: "exit",
    description: "exit stak",
    source: "builtin",
    run() {
      return { kind: "exit" };
    },
  },
];
