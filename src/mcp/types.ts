/**
 * Shared MCP types, consumed by config parsing, the tool adapter, and the
 * client. Kept in their own file (rather than alongside client.ts) because
 * config.ts and toolAdapter.ts — both pure and unit-testable without the
 * MCP SDK — need them too, and must not import client.ts's I/O.
 */

export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpSource = "global" | "project";

export interface NamedMcpServer {
  name: string;
  source: McpSource;
  config: McpServerConfig;
}

export interface McpServerStatus {
  name: string;
  source: McpSource;
  state: "connected" | "failed";
  toolCount: number;
  error?: string;
}
