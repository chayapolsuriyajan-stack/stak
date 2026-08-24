import type { z } from "zod";
import type { ImageData } from "../agent/types.js";

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
  /** Images for the model to see alongside the text — e.g. read on an image
   * or video file. Pixels ride outside `output` so providers that need a
   * different wire shape can translate them; adapters flatten as required. */
  images?: ImageData[];
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  /**
   * Used for local runtime validation of parsed args before execute() runs.
   * Always required, even for MCP-sourced tools, where it is deliberately a
   * permissive passthrough since the real validation happens server-side.
   */
  schema: z.ZodType<TArgs>;
  /**
   * A provider-facing JSON Schema supplied directly by the tool, preferred
   * over deriving one from `schema` in definitions(). Lets tools sourced
   * elsewhere (e.g. MCP servers) expose their own schema verbatim instead of
   * losing information to a zod round-trip.
   */
  jsonSchema?: Record<string, unknown>;
  riskTier: RiskTier;
  execute(args: TArgs, ctx: ToolExecContext): Promise<ToolResult>;
}

/** Narrows the generic away so tools of different arg types can share a list. */
export type AnyTool = Tool<never>;
