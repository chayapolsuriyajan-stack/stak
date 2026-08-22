import { z } from "zod";
import type { AnyTool, ToolResult } from "../tools/types.js";

/** Anthropic/OpenAI both cap tool names at 64 characters. */
const MAX_TOOL_NAME_LENGTH = 64;

/**
 * Namespaces an MCP tool under its server so identically-named tools from
 * different servers cannot collide, and sanitizes the result to the
 * character set and length providers accept.
 */
export function mcpToolName(server: string, tool: string): string {
  const raw = `mcp__${server}__${tool}`;
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.slice(0, MAX_TOOL_NAME_LENGTH);
}

interface McpContentBlock {
  type: "text" | "image" | "resource";
  text?: string;
  mimeType?: string;
  data?: string;
  resource?: { uri: string; [key: string]: unknown };
}

interface McpCallToolResult {
  content?: McpContentBlock[];
  isError?: boolean;
}

/**
 * Renders an MCP CallToolResult into this codebase's flat ToolResult shape.
 * Text blocks are joined as-is; images and resources are rendered as short
 * placeholders since ToolResult is text-only.
 */
export function formatMcpResult(result: McpCallToolResult): ToolResult {
  const parts = (result.content ?? []).map((block) => {
    if (block.type === "text") {
      return block.text ?? "";
    }
    if (block.type === "image") {
      const kb = Math.round(((block.data?.length ?? 0) * 3) / 4 / 1024);
      return `[image ${block.mimeType ?? "unknown"}, ${kb} KB]`;
    }
    // "resource"
    return `[resource ${block.resource?.uri ?? "unknown"}]`;
  });

  const output = parts.join("\n");

  return {
    output: output === "" ? "(no output)" : output,
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
  };
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface CreateMcpToolOptions {
  serverName: string;
  tool: McpToolDescriptor;
  call: (args: unknown) => Promise<unknown>;
}

/**
 * Wraps a remote MCP tool as a local Tool. `schema` is a permissive
 * passthrough — the remote server enforces its own schema via `inputSchema`
 * (surfaced to providers through `jsonSchema`), so re-validating locally
 * would only reject inputs the server itself would have accepted.
 *
 * riskTier is always "bash": an MCP tool's actual side effects are opaque to
 * this process, so it gets the same always-prompt / plan-mode-refused
 * gating as arbitrary shell commands rather than being trusted as
 * read-only or safe.
 */
export function createMcpTool({ serverName, tool, call }: CreateMcpToolOptions): AnyTool {
  return {
    name: mcpToolName(serverName, tool.name),
    description: `(${serverName} MCP) ${tool.description ?? ""}`,
    jsonSchema: tool.inputSchema ?? { type: "object" },
    schema: z.object({}).passthrough(),
    riskTier: "bash",
    async execute(args: unknown) {
      try {
        const result = await call(args);
        return formatMcpResult(result as McpCallToolResult);
      } catch (error) {
        return {
          output: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    },
  } as unknown as AnyTool;
}
