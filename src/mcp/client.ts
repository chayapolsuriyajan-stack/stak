import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { normalizeStdioCommand } from "./config.js";
import { createMcpTool } from "./toolAdapter.js";
import type { McpHttpServerConfig, McpServerStatus, NamedMcpServer } from "./types.js";
import type { AnyTool } from "../tools/types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface McpConnection {
  tools: AnyTool[];
  statuses: McpServerStatus[];
  close(): Promise<void>;
}

export interface ConnectMcpServersOptions {
  timeoutMs?: number;
}

/**
 * Connects to every configured MCP server concurrently. Servers are
 * independent: one failing to connect, timing out, or erroring on
 * listTools must never prevent the others from contributing their tools,
 * and must never throw out of this function — it always resolves with
 * whatever succeeded plus a status entry explaining every failure.
 */
export async function connectMcpServers(
  servers: NamedMcpServer[],
  opts?: ConnectMcpServersOptions,
): Promise<McpConnection> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results = await Promise.allSettled(
    servers.map((server) => connectOne(server, timeoutMs)),
  );

  const tools: AnyTool[] = [];
  const statuses: McpServerStatus[] = [];
  const closers: (() => Promise<void>)[] = [];

  results.forEach((result, index) => {
    const server = servers[index]!;
    if (result.status === "fulfilled") {
      tools.push(...result.value.tools);
      statuses.push({
        name: server.name,
        source: server.source,
        state: "connected",
        toolCount: result.value.tools.length,
      });
      closers.push(result.value.close);
    } else {
      statuses.push({
        name: server.name,
        source: server.source,
        state: "failed",
        toolCount: 0,
        error: describeError(result.reason),
      });
    }
  });

  return {
    tools,
    statuses,
    async close() {
      await Promise.all(
        closers.map(async (closer) => {
          try {
            await closer();
          } catch {
            // A hung child process on shutdown must never crash the CLI.
          }
        }),
      );
    },
  };
}

/**
 * Connects one server and lists its tools, then wraps them as local Tools.
 *
 * The whole attempt (connect + listTools) is wrapped in try/catch so that a
 * timeout, a transport failure, or a listTools() error never leaks the
 * client / spawned child process: every Client instance created during this
 * attempt (tracked in `createdClients` — there can be more than one, since
 * the HTTP fallback below builds a fresh Client for its SSE retry) gets
 * closed in the catch block before the original error is rethrown for
 * `connectMcpServers` to report as a failure status. A close failure is
 * swallowed so it can never mask that original error.
 */
async function connectOne(
  server: NamedMcpServer,
  timeoutMs: number,
): Promise<{ tools: AnyTool[]; close: () => Promise<void> }> {
  const createdClients: Client[] = [];

  try {
    // connect() and listTools() are time-boxed together, not separately —
    // a server that connects but never answers tools/list must not be able
    // to hang forever just because only the connect step was timed.
    const { client, listed } = await withTimeout(
      connectAndListTools(server, createdClients),
      timeoutMs,
    );

    const tools = listed.tools.map((tool) =>
      createMcpTool({
        serverName: server.name,
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
        },
        call: (args) => client.callTool({ name: tool.name, arguments: args as Record<string, unknown> }),
      }),
    );

    return {
      tools,
      close: () => client.close(),
    };
  } catch (error) {
    for (const client of createdClients) {
      try {
        await client.close();
      } catch {
        // A close failure on an already-broken client must never prevent
        // reporting the original connection failure below.
      }
    }
    throw error;
  }
}

async function connectAndListTools(
  server: NamedMcpServer,
  createdClients: Client[],
): Promise<{ client: Client; listed: Awaited<ReturnType<Client["listTools"]>> }> {
  const client = await connectTransport(server, createdClients);
  const listed = await client.listTools();
  return { client, listed };
}

/**
 * Builds the right transport for the server's config and connects, returning
 * the Client that ended up connected. HTTP servers try Streamable HTTP (the
 * current spec) first, then fall back to SSE (the older transport many
 * servers still only support) — the standard MCP client fallback pattern.
 *
 * Every Client constructed here is pushed onto `createdClients` immediately
 * (before it's connected), so `connectOne`'s catch block can close it on any
 * failure path, including a timeout that fires mid-connect.
 */
async function connectTransport(server: NamedMcpServer, createdClients: Client[]): Promise<Client> {
  const config = server.config;

  // Narrowing on `type` alone doesn't fully exclude McpHttpServerConfig here
  // because McpStdioServerConfig's `type` is optional rather than a
  // required "stdio" literal — TS can't prove the stdio branch excludes
  // the http shape from a `type` check alone. `"url" in config` is a
  // property present only on McpHttpServerConfig, so it narrows cleanly.
  if ("url" in config) {
    return connectHttp(config, createdClients);
  }

  const client = new Client({ name: "stak", version: "0.1.0" });
  createdClients.push(client);

  const transport = new StdioClientTransport({
    command: normalizeStdioCommand(config.command, process.platform),
    args: config.args,
    env: config.env,
    cwd: config.cwd,
  });
  await client.connect(transport);
  return client;
}

/**
 * Tries Streamable HTTP first, then SSE. This MUST use a fresh Client for
 * the SSE retry rather than reusing the one whose StreamableHTTP attempt
 * failed.
 *
 * Why: in the MCP SDK (see Protocol.connect in
 * @modelcontextprotocol/sdk/dist/esm/shared/protocol.js), a Client sets its
 * internal `_transport` as soon as `connect()` is called — before
 * `transport.start()` is awaited — and only clears it in `_onclose`. If
 * `StreamableHTTPClientTransport.start()` itself throws, `close()`/`_onclose`
 * is never reached, so `_transport` stays set; calling `connect()` again on
 * the SAME Client then throws "Already connected to a transport..."
 * deterministically, breaking the fallback. If instead `initialize()` throws
 * (the more common signal that a server is SSE-only), reusing the client
 * would depend on an unawaited close() racing the SSE connect() — still
 * unsafe. A brand new Client for the SSE attempt sidesteps both cases.
 */
async function connectHttp(config: McpHttpServerConfig, createdClients: Client[]): Promise<Client> {
  const url = new URL(config.url);
  const requestInit = config.headers ? { headers: config.headers } : undefined;

  const httpClient = new Client({ name: "stak", version: "0.1.0" });
  createdClients.push(httpClient);

  try {
    await httpClient.connect(new StreamableHTTPClientTransport(url, { requestInit }));
    return httpClient;
  } catch {
    // Best-effort, awaited close of the failed StreamableHTTP client before
    // starting the SSE attempt. Its failure must not block the fallback.
    try {
      await httpClient.close();
    } catch {
      // ignore — the SSE attempt below still needs to run regardless.
    }

    const sseClient = new Client({ name: "stak", version: "0.1.0" });
    createdClients.push(sseClient);
    await sseClient.connect(new SSEClientTransport(url, { requestInit }));
    return sseClient;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
