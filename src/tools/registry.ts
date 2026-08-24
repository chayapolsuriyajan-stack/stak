import { zodToJsonSchema } from "zod-to-json-schema";
import type { HookRunner } from "../hooks/runner.js";
import type { PermissionManager } from "../permissions/manager.js";
import type { ToolDefinition } from "../providers/types.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { todoWriteTool } from "./todo.js";
import type { AnyTool, ToolResult } from "./types.js";
import { writeTool } from "./write.js";

export interface ToolRegistryOptions {
  cwd: string;
  permissions: PermissionManager;
  /** Runs beforeTool/afterTool hook commands around each execution.
   * Absent when no hooks are configured. */
  hooks?: HookRunner;
  /** Extra tools beyond the built-ins, such as the Skill meta-tool. */
  extra?: AnyTool[];
}

/**
 * Owns the tool set for a session: exposes their schemas to providers and runs
 * calls through the permission gate before executing them.
 */
export class ToolRegistry {
  private tools = new Map<string, AnyTool>();
  private readonly cwd: string;
  private readonly permissions: PermissionManager;
  private readonly hooks?: HookRunner;

  constructor(options: ToolRegistryOptions) {
    this.cwd = options.cwd;
    this.permissions = options.permissions;
    this.hooks = options.hooks;

    const builtins = [
      readTool,
      writeTool,
      editTool,
      bashTool,
      grepTool,
      globTool,
      todoWriteTool,
    ] as unknown as AnyTool[];

    for (const tool of [...builtins, ...(options.extra ?? [])]) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * JSON Schema is produced once here so every provider adapter wraps the same
   * definition. Tools sourced elsewhere later, such as MCP, can be registered
   * with their schema directly without adapters changing.
   */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      jsonSchema:
        tool.jsonSchema ??
        (zodToJsonSchema(tool.schema, {
          target: "jsonSchema7",
          $refStrategy: "none",
        }) as Record<string, unknown>),
    }));
  }

  async execute(
    call: {
      name: string;
      input: unknown;
    },
    signal?: AbortSignal,
  ): Promise<ToolResult & { isError: boolean; notices: string[] }> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        output: `No such tool: ${call.name}. Available: ${[...this.tools.keys()].join(", ")}`,
        isError: true,
        notices: [],
      };
    }

    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return {
        output: `Invalid arguments for ${tool.name}: ${formatIssues(parsed.error.issues)}`,
        isError: true,
        notices: [],
      };
    }

    // Permission first: a denied call never reaches hook commands, so plan
    // mode (and a declined prompt) can't be probed through them.
    const decision = await this.permissions.check({
      toolName: tool.name,
      riskTier: tool.riskTier,
      args: parsed.data,
    });

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
      const after = this.hooks
        ? await this.hooks.run("afterTool", {
            tool: tool.name,
            args: parsed.data,
            cwd: this.cwd,
          })
        : { blocked: false, reasons: [], notices: [] as string[] };
      return { output: result.output, isError: result.isError ?? false, notices: after.notices };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
        notices: [],
      };
    }
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
