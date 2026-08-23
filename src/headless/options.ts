/**
 * Pure invocation resolution for stak's headless/print mode (`stak -p "..."`).
 *
 * This module takes the CLI's already-parsed flags (see cli.ts for the actual
 * argv parsing) and decides what stak should do: launch the TUI, run one
 * headless print turn, or refuse with an error message. Keeping this pure and
 * separate from argv parsing means the many edge cases below — validation,
 * the stdin/positional prompt-building rules, and the legacy `-p <provider>`
 * misuse guard — can be exercised directly in tests without spawning a
 * process or faking stdin.
 */

export type OutputFormat = "text" | "json" | "stream-json";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["text", "json", "stream-json"];

export const PERMISSION_MODES = ["plan", "build", "auto"] as const;

/** Removed v0.2 mode names → what to tell the user to use instead. */
const LEGACY_PERMISSION_MODES: Record<string, string> = {
  ask: "build",
  "accept-edits": "build",
  "auto-bypass": "auto",
};

export interface RawInvocation {
  print?: boolean;
  outputFormat?: string;
  /** Raw --permission-mode value, not yet validated against the known set. */
  permissionMode?: string;
  positional: string[];
  /** undefined when stdin is a TTY / not piped */
  stdin?: string;
  /** --resume given with no id */
  resumePicker: boolean;
}

export type Invocation =
  | { mode: "tui" }
  | { mode: "print"; prompt: string; format: OutputFormat; permissionMode?: string }
  | { mode: "error"; message: string };

/**
 * Legacy misuse guard: before print mode existed, `-p` meant `--provider`,
 * so `-p anthropic` / `-p openai` / `-p ollama` were common invocations. Now
 * `-p` means `--print`, and those same three words as a lone positional would
 * silently become the literal prompt text — actually running tools against
 * an ambiguous one-word instruction. Anyone piping real context via stdin
 * clearly means it as a prompt, so the guard only fires on the bare,
 * unpiped case.
 */
const LEGACY_PROVIDER_WORDS = new Set(["anthropic", "openai", "ollama"]);

/**
 * Resolves a parsed-but-unvalidated CLI invocation into what stak should
 * actually do. Pure and side-effect free: no process.exit, no I/O — cli.ts
 * is responsible for acting on the returned Invocation.
 */
export function resolveInvocation(raw: RawInvocation): Invocation {
  if (raw.print !== true) {
    if (raw.outputFormat !== undefined) {
      return { mode: "error", message: "--output-format only applies with --print." };
    }
    if (raw.permissionMode !== undefined) {
      return { mode: "error", message: "--permission-mode only applies with --print." };
    }
    return { mode: "tui" };
  }

  if (raw.resumePicker) {
    return {
      mode: "error",
      message: "--resume (interactive picker) is not supported with --print.",
    };
  }

  let format: OutputFormat = "text";
  if (raw.outputFormat !== undefined) {
    if (!(OUTPUT_FORMATS as string[]).includes(raw.outputFormat)) {
      return {
        mode: "error",
        message: `Unknown --output-format "${raw.outputFormat}". Valid formats: ${OUTPUT_FORMATS.join(", ")}.`,
      };
    }
    format = raw.outputFormat as OutputFormat;
  }

  if (raw.permissionMode !== undefined) {
    const legacy = LEGACY_PERMISSION_MODES[raw.permissionMode];
    if (legacy !== undefined) {
      return {
        mode: "error",
        message: `Permission mode "${raw.permissionMode}" was removed — use "${legacy}".`,
      };
    }
    if (!(PERMISSION_MODES as readonly string[]).includes(raw.permissionMode)) {
      return {
        mode: "error",
        message: `Unknown --permission-mode "${raw.permissionMode}". Valid modes: ${PERMISSION_MODES.join(", ")}.`,
      };
    }
  }

  // Trimmed/blank-checked up front: a genuinely empty piped stdin (e.g.
  // `stak -p ollama < /dev/null`) must count as "nothing meaningful was
  // piped" for both the legacy misuse guard below and prompt-building —
  // an empty string is not real context.
  const stdin = raw.stdin?.trim();
  const hasStdin = stdin !== undefined && stdin.length > 0;
  const hasPositional = raw.positional.length > 0;

  if (
    raw.positional.length === 1 &&
    LEGACY_PROVIDER_WORDS.has(raw.positional[0] as string) &&
    !hasStdin
  ) {
    const value = raw.positional[0];
    return {
      mode: "error",
      message: `-p now means --print (headless mode), not --provider — use -P/--provider instead. If you really meant to send "${value}" as a prompt, pipe it via stdin or quote a longer prompt.`,
    };
  }

  let prompt: string;
  if (hasStdin && hasPositional) {
    prompt = `${stdin}\n\n${raw.positional.join(" ")}`;
  } else if (hasStdin) {
    prompt = stdin;
  } else if (hasPositional) {
    prompt = raw.positional.join(" ");
  } else {
    return {
      mode: "error",
      message: "No prompt given — pass one as an argument or pipe it via stdin.",
    };
  }

  return {
    mode: "print",
    prompt,
    format,
    ...(raw.permissionMode !== undefined ? { permissionMode: raw.permissionMode } : {}),
  };
}
