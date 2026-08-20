import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { TurnPhase } from "../../agent/types.js";
import { formatPhaseLine, formatStatsLine, type StatsLine } from "../formatStats.js";
import { ACCENT, MUTED } from "../theme.js";

export interface StatusBarProps {
  provider: string;
  model: string;
  busy: boolean;
  hint?: string;
  /** The last-known live/final stats snapshot — kept and shown even once
   * idle, so context usage stays visible between turns rather than
   * vanishing the moment a turn completes. */
  stats?: StatsLine;
  /** Undefined until the model's context limit is known (or never becomes
   * known, e.g. an unrecognized Anthropic/OpenAI model) — the context
   * segment is omitted entirely in that case rather than guessing. */
  contextLength?: number;
  /** Only meaningful while busy; the phase/round readout that replaces the
   * generic "working…" hint. */
  phase?: TurnPhase;
  round?: number;
}

export function StatusBar({
  provider,
  model,
  busy,
  hint,
  stats,
  contextLength,
  phase,
  round,
}: StatusBarProps) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={MUTED}>
        {busy ? (
          <>
            <Text color={ACCENT}>
              <Spinner type="dots" />
            </Text>
            <Text color={MUTED}>
              {" "}
              {phase !== undefined && round !== undefined
                ? formatPhaseLine(phase, round)
                : "working… esc to interrupt"}
            </Text>
          </>
        ) : (
          (hint ?? "enter send")
        )}
      </Text>
      <Box gap={2}>
        {stats && <Text color={MUTED}>{formatStatsLine(stats, contextLength)}</Text>}
        <Text color={MUTED}>
          {provider} {model}
        </Text>
      </Box>
    </Box>
  );
}
