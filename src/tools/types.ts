import type { z } from "zod";

/**
 * How dangerous a tool is, which decides whether the permission mode can
 * auto-approve it. Read-only tools never prompt.
 */
export type RiskTier = "read-only" | "edit" | "bash";

export interface ToolExecContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  riskTier: RiskTier;
  execute(args: TArgs, ctx: ToolExecContext): Promise<ToolResult>;
}

/** Narrows the generic away so tools of different arg types can share a list. */
export type AnyTool = Tool<never>;
