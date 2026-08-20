/**
 * Turns a raw tool call into something closer to how Claude Code renders
 * tool activity — `read(src/cli.ts)` rather than a JSON dump of the args —
 * falling back to truncated JSON for tools this doesn't specifically know.
 *
 * Deliberately just the call, not the result: the existing result rendering
 * (up to a few lines of actual output) is more useful in a terminal tool
 * than a terse "3 lines" gist would be — you can see what actually happened
 * without asking again.
 */
export function summarizeToolCall(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case "read":
    case "write":
    case "edit":
      return typeof args["path"] === "string" ? args["path"] : rawFallback(args);
    case "bash":
      return typeof args["command"] === "string" ? args["command"] : rawFallback(args);
    case "grep":
      return typeof args["pattern"] === "string" ? `"${args["pattern"]}"` : rawFallback(args);
    case "glob":
      return typeof args["pattern"] === "string" ? args["pattern"] : rawFallback(args);
    case "Skill":
      return typeof args["name"] === "string" ? args["name"] : rawFallback(args);
    default:
      return rawFallback(args);
  }
}

function rawFallback(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}
