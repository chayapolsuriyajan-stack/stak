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
    argumentHint: "[ask|accept-edits|auto-bypass]",
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
    name: "exit",
    description: "exit stak",
    source: "builtin",
    run() {
      return { kind: "exit" };
    },
  },
];
