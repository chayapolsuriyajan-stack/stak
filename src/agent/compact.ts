import type { Provider } from "../providers/types.js";
import type { ContentBlock, Message } from "./types.js";

/** Exported so callers that want to cheaply pre-check "is there even
 * anything to compact" (e.g. before triggering an auto-compaction attempt)
 * can use the same default splitForCompaction/compactHistory fall back to,
 * without duplicating the magic number. */
export const DEFAULT_KEEP_RECENT = 4;
const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.85;
/** Same rough chars-per-token default as turnStats.ts's DEFAULT_CHARS_PER_TOKEN. */
const CHARS_PER_TOKEN = 4;
/** Tool results get truncated to roughly this many characters when rendered
 * into a summarization transcript — a single huge command output should not
 * dominate the tokens spent asking the model to summarize the conversation. */
const TOOL_RESULT_TRUNCATE_AT = 500;
const TRUNCATED_MARKER = "… (truncated)";

export interface CompactionBoundary {
  older: Message[];
  recent: Message[];
}

/**
 * Splits history into an "older" span to be summarized and a "recent" span
 * to keep verbatim. The naive boundary (`history.length - keepRecent`) can
 * land in the middle of a tool-calling exchange — Anthropic and OpenAI both
 * reject a message list whose first message references a `tool_result` with
 * no matching preceding `tool_use`, so we scan backward from the candidate
 * index toward the start of history for the nearest `user` message that
 * carries no `tool_result` block, which is always a safe place to start a
 * fresh (or compacted) history. Scanning backward (rather than forward past
 * the candidate) guarantees at least `keepRecent` messages are kept verbatim
 * whenever any clean boundary exists at or before the candidate — a typical
 * agentic turn ending in a tool exchange (user "do X" / assistant[tool_use] /
 * user[tool_result] / ... / assistant "done") has every message from the
 * candidate onward entangled in that exchange, so scanning forward would find
 * no clean boundary and fall back to keeping nothing, even though the turn's
 * own opening user message just before it is a perfectly clean boundary.
 */
export function splitForCompaction(
  history: Message[],
  keepRecent: number = DEFAULT_KEEP_RECENT,
): CompactionBoundary {
  if (history.length <= keepRecent) {
    return { older: [], recent: history };
  }

  // i > 0 rather than i >= 0: accepting index 0 as a boundary would return
  // { older: [], recent: history } — the entire history kept "recent" and
  // nothing summarized, which for a single huge opening turn means
  // compactHistory sees older.length === 0 and throws "still short" even
  // though the conversation is enormous and exactly what auto-compaction
  // exists to shrink. Rejecting index 0 falls through to the "compact
  // everything" fallback below instead, which actually reduces context.
  const candidate = history.length - keepRecent;
  for (let i = candidate; i > 0; i--) {
    const message = history[i];
    if (message === undefined) continue;
    if (message.role === "user" && !message.content.some((b) => b.type === "tool_result")) {
      return { older: history.slice(0, i), recent: history.slice(i) };
    }
  }

  // No clean boundary anywhere from the candidate index back to (but not
  // including) the start — every message in history is entangled in a tool
  // exchange, so nothing can safely be kept verbatim.
  return { older: history, recent: [] };
}

/**
 * Renders messages as a plain-text transcript for a summarization prompt.
 * Thinking blocks are skipped entirely — per ThinkingBlock's doc comment in
 * types.ts, reasoning must never round-trip to a provider as if it were
 * prior speech, and this transcript goes back to a provider as ordinary
 * user text via buildSummaryRequest.
 */
export function renderTranscript(messages: Message[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const prefix = message.role === "user" ? "user: " : "assistant: ";
    const parts: string[] = [];

    for (const block of message.content) {
      switch (block.type) {
        case "text":
          parts.push(block.text);
          break;
        case "tool_use":
          parts.push(`[tool: ${block.name}]`);
          break;
        case "tool_result": {
          const truncated =
            block.content.length > TOOL_RESULT_TRUNCATE_AT
              ? block.content.slice(0, TOOL_RESULT_TRUNCATE_AT) + TRUNCATED_MARKER
              : block.content;
          parts.push(`\n[tool result]\n${truncated}`);
          break;
        }
        case "thinking":
          break;
      }
    }

    if (parts.length > 0) {
      lines.push(`${prefix}${parts.join(" ")}`);
    }
  }

  return lines.join("\n");
}

export const COMPACT_INSTRUCTIONS =
  "You are compacting a conversation transcript into a compact summary that " +
  "will replace the earlier part of the conversation as your own memory of " +
  "it. Write prose, not a rigid template. Cover: the task or goal being " +
  "pursued, key decisions made and why, files that were read or changed, " +
  "the current state of the work, and next steps if any were mentioned. Be " +
  "concise but do not drop details that would matter if you had to continue " +
  "the work with no other memory of this conversation.";

/**
 * Builds the request used to summarize `older`. The transcript is packed
 * into a single plain-text user message (rather than replaying the original
 * tool_use/tool_result blocks) so a streamChat call using this as `history`
 * with `tools: []` never needs matching tool_use/tool_result pairs.
 */
export function buildSummaryRequest(
  older: Message[],
  focus?: string,
): { systemPrompt: string; history: Message[] } {
  const systemPrompt =
    COMPACT_INSTRUCTIONS + (focus ? `\n\nFocus especially on: ${focus}` : "");

  return {
    systemPrompt,
    history: [
      {
        role: "user",
        content: [{ type: "text", text: renderTranscript(older) }],
      },
    ],
  };
}

/**
 * Rebuilds a history array with `summary` standing in for everything before
 * `recent`. Framed clearly as a summary, not literal prior dialogue, so the
 * model doesn't mistake it for something it or the user actually said.
 */
export function buildCompactedHistory(summary: string, recent: Message[]): Message[] {
  return [
    {
      role: "user",
      content: [{ type: "text", text: `[Earlier conversation summary]\n\n${summary}` }],
    },
    ...recent,
  ];
}

/** Character-count-based estimate — sums every text/tool_result/tool_use
 * string across all messages' content blocks and divides by the same rough
 * chars-per-token default turnStats.ts uses. */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const message of messages) {
    for (const block of message.content) {
      chars += lengthOf(block);
    }
  }
  return Math.round(chars / CHARS_PER_TOKEN);
}

function lengthOf(block: ContentBlock): number {
  switch (block.type) {
    case "text":
      return block.text.length;
    case "tool_result":
      return block.content.length;
    case "tool_use":
      return JSON.stringify(block.input ?? "").length + block.name.length;
    case "thinking":
      return block.text.length;
  }
}

/**
 * Whether the conversation is close enough to the model's context window
 * that it should be auto-compacted. `contextLength` is often unknowable (see
 * ModelInfo in providers/types.ts), in which case we never trigger — a
 * missing limit should not be treated as "always over".
 */
export function shouldAutoCompact(o: {
  inputTokens: number;
  contextLength?: number;
  threshold?: number;
}): boolean {
  const { inputTokens, contextLength, threshold = DEFAULT_AUTO_COMPACT_THRESHOLD } = o;
  if (contextLength === undefined || contextLength <= 0) return false;
  if (inputTokens === 0) return false;
  return inputTokens / contextLength >= threshold;
}

export interface CompactResult {
  summary: string;
  messagesBefore: number;
  messagesAfter: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Same compact-number style as tui/formatStats.ts's local formatCompact,
 * reimplemented here rather than imported to keep this module's only
 * dependency on the provider surface, not on TUI formatting. */
function formatCompact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function describeCompaction(r: CompactResult): string {
  // messagesAfter is compacted.length, i.e. 1 (summary) + recent.length per
  // buildCompactedHistory — subtract that summary message back out so the
  // "recent messages" figure isn't overcounted by one.
  const recentCount = r.messagesAfter - 1;
  return (
    `Compacted ${r.messagesBefore} messages (~${formatCompact(r.estimatedTokensBefore)}) ` +
    `into a summary plus ${recentCount} recent messages ` +
    `(~${formatCompact(r.estimatedTokensAfter)}).`
  );
}

export interface CompactableContext {
  provider: Provider;
  model: string;
  history: Message[];
}

/**
 * Summarizes the older portion of `ctx.history` and mutates `ctx.history`
 * in place to be the summary followed by the recent portion — mirrors how
 * `runTurn` in loop.ts mutates history in place via its `append()` helper
 * rather than reassigning, since other code may hold a reference to the
 * original array.
 *
 * `options.signal` is accepted for API-compatibility with callers that want
 * to make this abortable, but Provider.streamChat (providers/types.ts) takes
 * no AbortSignal today, so it is not wired to anything here.
 */
export async function compactHistory(
  ctx: CompactableContext,
  options?: { focus?: string; keepRecent?: number; signal?: AbortSignal },
): Promise<CompactResult> {
  const { older, recent } = splitForCompaction(ctx.history, options?.keepRecent);

  if (older.length === 0) {
    throw new Error("Nothing to compact yet — the conversation is still short.");
  }

  const messagesBefore = ctx.history.length;
  const estimatedTokensBefore = estimateTokens(ctx.history);

  const { systemPrompt, history } = buildSummaryRequest(older, options?.focus);

  let summary = "";
  const stream = ctx.provider.streamChat({
    model: ctx.model,
    systemPrompt,
    history,
    tools: [],
    options: { think: false },
  });

  for await (const event of stream) {
    if (event.type === "text-delta") {
      summary += event.text;
    } else if (event.type === "error") {
      throw event.error;
    }
  }

  if (summary.trim() === "") {
    throw new Error("The model returned an empty summary — nothing was compacted.");
  }

  const compacted = buildCompactedHistory(summary, recent);
  ctx.history.splice(0, ctx.history.length, ...compacted);
  const estimatedTokensAfter = estimateTokens(compacted);

  return {
    summary,
    messagesBefore,
    messagesAfter: compacted.length,
    estimatedTokensBefore,
    estimatedTokensAfter,
  };
}
