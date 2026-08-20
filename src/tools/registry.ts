import { zodToJsonSchema } from "zod-to-json-schema";
import type { PermissionManager } from "../permissions/manager.js";
import type { ToolDefinition } from "../providers/types.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import type { AnyTool, ToolResult } from "./types.js";
import { writeTool } from "./write.js";

export interface ToolRegistryOptions {
  cwd: string;
  permissions: PermissionManager;
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

  constructor(options: ToolRegistryOptions) {
    this.cwd = options.cwd;
    this.permissions = options.permissions;

    const builtins = [
      readTool,
      writeTool,
      editTool,
      bashTool,
      grepTool,
      globTool,
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
      jsonSchema: zodToJsonSchema(tool.schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }) as Record<string, unknown>,
    }));
  }

  async execute(call: {
    name: string;
    input: unknown;
  }): Promise<ToolResult & { isError: boolean }> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        output: `No such tool: ${call.name}. Available: ${[...this.tools.keys()].join(", ")}`,
        isError: true,
      };
    }

    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return {
        output: `Invalid arguments for ${tool.name}: ${formatIssues(parsed.error.issues)}`,
        isError: true,
      };
    }

    const decision = await this.permissions.check({
      toolName: tool.name,
      riskTier: tool.riskTier,
      args: parsed.data,
    });

    if (decision === "denied") {
      return { output: this.permissions.denialReason(tool.name), isError: true };
    }

    try {
      const result = await tool.execute(parsed.data as never, { cwd: this.cwd });
      return { output: result.output, isError: result.isError ?? false };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
