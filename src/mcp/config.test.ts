import { describe, expect, test } from "vitest";
import {
  expandEnvRefs,
  mergeMcpServers,
  normalizeStdioCommand,
  parseMcpServers,
} from "./config.js";
import type { NamedMcpServer } from "./types.js";

describe("expandEnvRefs", () => {
  test("expands a present variable", () => {
    const result = expandEnvRefs("${FOO}", { FOO: "bar" });
    expect(result).toEqual({ value: "bar", missing: [] });
  });

  test("falls back to the default when the variable is missing", () => {
    const result = expandEnvRefs("${FOO:-fallback}", {});
    expect(result).toEqual({ value: "fallback", missing: [] });
  });

  test("expands to empty and reports missing when there's no default", () => {
    const result = expandEnvRefs("${FOO}", {});
    expect(result).toEqual({ value: "", missing: ["FOO"] });
  });

  test("leaves a string with no refs untouched", () => {
    const result = expandEnvRefs("plain string", { FOO: "bar" });
    expect(result).toEqual({ value: "plain string", missing: [] });
  });

  test("expands multiple refs within one string", () => {
    const result = expandEnvRefs("${A}/${B:-x}/${C}", { A: "1" });
    expect(result).toEqual({ value: "1/x/", missing: ["C"] });
  });
});

describe("parseMcpServers", () => {
  test("parses a valid stdio entry", () => {
    const { servers, warnings } = parseMcpServers(
      { mcpServers: { fs: { command: "npx", args: ["-y", "server"] } } },
      "global",
      {},
    );

    expect(warnings).toEqual([]);
    expect(servers).toEqual([
      { name: "fs", source: "global", config: { type: "stdio", command: "npx", args: ["-y", "server"] } },
    ]);
  });

  test("parses a valid http entry", () => {
    const { servers, warnings } = parseMcpServers(
      { mcpServers: { remote: { type: "http", url: "https://example.com/mcp" } } },
      "project",
      {},
    );

    expect(warnings).toEqual([]);
    expect(servers).toEqual([
      { name: "remote", source: "project", config: { type: "http", url: "https://example.com/mcp" } },
    ]);
  });

  test("skips a malformed entry and warns", () => {
    const { servers, warnings } = parseMcpServers(
      { mcpServers: { broken: { type: "http" } } },
      "global",
      {},
    );

    expect(servers).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken");
  });

  test("returns no servers when mcpServers is absent", () => {
    const { servers, warnings } = parseMcpServers({}, "global", {});
    expect(servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("returns no servers when mcpServers is empty", () => {
    const { servers, warnings } = parseMcpServers({ mcpServers: {} }, "global", {});
    expect(servers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("expands env refs in stdio env and http headers", () => {
    const { servers } = parseMcpServers(
      {
        mcpServers: {
          fs: { command: "npx", env: { TOKEN: "${TOKEN}" } },
          remote: { type: "http", url: "https://x", headers: { Authorization: "Bearer ${TOKEN}" } },
        },
      },
      "global",
      { TOKEN: "secret" },
    );

    const fs = servers.find((s) => s.name === "fs");
    const remote = servers.find((s) => s.name === "remote");
    expect(fs?.config).toMatchObject({ env: { TOKEN: "secret" } });
    expect(remote?.config).toMatchObject({ headers: { Authorization: "Bearer secret" } });
  });

  test("warns when a referenced env var is missing, without dropping the server", () => {
    const { servers, warnings } = parseMcpServers(
      {
        mcpServers: {
          github: {
            type: "http",
            url: "https://x",
            headers: { Authorization: "Bearer ${GH_MCP_TOKN}" },
          },
        },
      },
      "project",
      {},
    );

    expect(servers).toHaveLength(1);
    expect(warnings).toContain(
      'MCP server "github" (project): "${GH_MCP_TOKN}" in "headers.Authorization" is not set.',
    );
  });

  test("expands env refs in url, command, and cwd", () => {
    const { servers, warnings } = parseMcpServers(
      {
        mcpServers: {
          remote: { type: "http", url: "${MCP_HOST}/mcp" },
          fs: { command: "${BIN}", cwd: "${PROJECT_DIR}" },
        },
      },
      "global",
      { MCP_HOST: "https://example.com", BIN: "npx", PROJECT_DIR: "/repo" },
    );

    expect(warnings).toEqual([]);
    const remote = servers.find((s) => s.name === "remote");
    const fs = servers.find((s) => s.name === "fs");
    expect(remote?.config).toMatchObject({ url: "https://example.com/mcp" });
    expect(fs?.config).toMatchObject({ command: "npx", cwd: "/repo" });
  });
});

describe("mergeMcpServers", () => {
  test("a project server replaces a global one of the same name", () => {
    const global: NamedMcpServer[] = [
      { name: "fs", source: "global", config: { type: "stdio", command: "global-cmd" } },
    ];
    const project: NamedMcpServer[] = [
      { name: "fs", source: "project", config: { type: "stdio", command: "project-cmd" } },
    ];

    const merged = mergeMcpServers(global, project);
    expect(merged).toEqual([
      { name: "fs", source: "project", config: { type: "stdio", command: "project-cmd" } },
    ]);
  });

  test("non-overlapping names from both are kept", () => {
    const global: NamedMcpServer[] = [
      { name: "a", source: "global", config: { type: "stdio", command: "a-cmd" } },
    ];
    const project: NamedMcpServer[] = [
      { name: "b", source: "project", config: { type: "stdio", command: "b-cmd" } },
    ];

    const merged = mergeMcpServers(global, project);
    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });
});

describe("normalizeStdioCommand", () => {
  test("maps npx to npx.cmd on win32", () => {
    expect(normalizeStdioCommand("npx", "win32")).toBe("npx.cmd");
  });

  test("maps npm to npm.cmd on win32", () => {
    expect(normalizeStdioCommand("npm", "win32")).toBe("npm.cmd");
  });

  test("leaves commands unchanged on other platforms", () => {
    expect(normalizeStdioCommand("npx", "linux")).toBe("npx");
    expect(normalizeStdioCommand("npm", "darwin")).toBe("npm");
  });

  test("leaves unrelated commands unchanged everywhere", () => {
    expect(normalizeStdioCommand("node", "win32")).toBe("node");
    expect(normalizeStdioCommand("node", "linux")).toBe("node");
  });
});
