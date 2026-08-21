# Stak

A local-first agentic coding CLI. Runs against a local model through Ollama, or
against Claude and OpenAI when you want a hosted one — the agent loop is the
same either way.

## Install

```bash
npm install -g github:chayapolsuriyajan-stack/stak
```

Requires Node 20+. This installs straight from GitHub — stak isn't published
to the npm registry.

To work on stak itself instead:

```bash
npm install
npm run build
npm link
```

`stak` is then available from any directory.

## Use

```bash
stak                       # start a session in the current directory
stak --continue            # resume the most recent session here
stak --resume              # pick a past session interactively
stak --resume <id>         # resume one specific session directly
stak --model llama3.2      # override the model for this run
stak --provider anthropic  # override the provider
```

Inside a session:

| Command | Effect |
| --- | --- |
| `/help` | list commands |
| `/clear` | clear the transcript and start a new session |
| `/model [name]` | list known models with the current one marked, or switch to a new one |
| `/permissions [mode]` | show or set the permission mode |
| `/exit` | quit |
| `shift+tab` | cycle the permission mode |
| `esc` | interrupt a turn in progress, or quit when idle |

Typing `/` shows matching commands as you type. `/model` with no argument
lists what the active provider actually has available (Ollama's local models,
or Anthropic/OpenAI's via their API) rather than a guess, and switching
confirms with a before/after pair — `Model changed: ollama a → ollama b` — so
a typo in the name doesn't silently "succeed."

The status bar shows token usage and throughput for the last turn: total
tokens, the input/output split, and tokens/second computed from wall-clock
time. When the model's reply ends with a numbered list, answering with a bare
number (`1`, `2`, ...) sends that option's text instead of the literal digit —
useful for the model's own multiple-choice questions, and for approving a
permission prompt (`1` = yes, `2` = no) without reaching for the arrow keys.

## Configuration

Credentials and defaults live in `~/.stak/config.json`:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "llama3.2",
  "anthropicApiKey": "sk-...",
  "openaiApiKey": "sk-...",
  "ollamaHost": "http://localhost:11434"
}
```

Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_HOST`,
`STAK_MODEL`) override that file. A project may pick its own model in
`.stak/settings.json`, which outranks both — but credentials there are ignored
and warned about, since project files tend to end up in version control.

## Permission modes

Every command and file change passes a permission gate before it runs.

| Mode | Behaviour |
| --- | --- |
| `plan` | read-only tools work freely; every edit and command is refused outright, no prompt |
| `ask` | prompts before edits and commands (default) |
| `accept-edits` | edits run unattended, commands still prompt |
| `auto-bypass` | nothing prompts |

Commands stay gated in `accept-edits` because an edit leaves a diff you can
read and revert, and an arbitrary shell command does not.

**Plan mode** is for exploring a change before committing to it. The model is
told plainly that write/edit/bash are disabled and to research with
read/grep/glob/Skill, then present a concrete plan and stop — it won't retry
blocked tools or nag you to switch modes. Cycling to any other mode (`shift+tab`
or `/permissions ask`) is how you approve the plan; send a follow-up message
like "go ahead" and it executes normally from there.

## Security

**The `bash` tool is not sandboxed.** A command stak is allowed to run can do
anything your OS user account can do — read, write, or delete any file you
have access to, reach the network, install software. There is no allowlist
or denylist of commands; pattern-matching shell input to decide what's "safe"
is easy to get wrong and easy to bypass, so stak doesn't pretend to do it.
Treat an approved `bash` call exactly as if you had typed it yourself, and
lean on the permission modes above — `ask` (the default) or `plan` — rather
than assuming the tool itself limits what a command can reach.

The file tools (`read`, `write`, `edit`, `glob`, `grep`) are different: they
are confined to the project directory stak was started in. A path that
resolves outside it — via `..`, an absolute path, or a same-prefix sibling
directory like `../project-evil` — is rejected before anything touches disk.
This confinement is unconditional; no config setting weakens it. It does not
apply to `bash`, since a shell command can `cd` anywhere regardless of what
argument it was called with — confining only that argument would be a false
sense of safety rather than a real one.

Session transcripts (`.stak/sessions/`) can contain whatever the model read
or wrote, including file contents from your project — review before sharing
one or committing `.stak/`.

## Commands and skills

Both are markdown files, discovered in `~/.stak/` and then the project's
`.stak/`, where a project file of the same name wins.

A command at `.stak/commands/review.md`:

```markdown
---
description: review a file
argument-hint: <path>
---
Review this file and list any correctness problems: $ARGUMENTS
```

Running `/review src/app.ts` sends the expanded body as your message. If a body
has no `$ARGUMENTS`, whatever you typed is appended rather than dropped.

A skill at `.stak/skills/reviewer/SKILL.md`:

```markdown
---
name: reviewer
description: Use when asked to review code for correctness
---
Read the file first. Report only defects you can trace to a concrete failure.
```

Skill names and descriptions go into the system prompt, so the model knows what
exists; it loads one by calling the `Skill` tool, and the instructions come back
as the tool result. That works on any provider with native tool-calling, with no
protocol support of its own.

## When a response gets cut off

A reply cut off by the model's context/output limit looks identical to a
normal finished reply unless something flags it — stak checks each
provider's stop reason and shows "⚠ Response cut off" when that happens,
rather than silently presenting an incomplete answer as done. If you're
hitting this often, `num_ctx` in your Modelfile is likely too small for the
task at hand; raising it costs VRAM headroom (more context needs a bigger
KV cache), so there's a real tradeoff against how much of the model can stay
resident on a GPU with limited memory.

## Sessions

Conversations append to `.stak/sessions/<id>.jsonl` as they happen, so an
interrupted session still leaves a resumable transcript. `--continue` reopens
the most recent one; `--resume` with no id shows a picker (age, model, message
count, first-message preview) and `--resume <id>` loads one directly. All
three keep writing to the same file rather than starting a new one.

## Development

```bash
npm run dev        # run from source
npm test           # run the test suite
npm run typecheck  # check types
```

## Not implemented

MCP servers. Tool definitions already carry plain JSON Schema regardless of
where they came from, so MCP tools can register through the same path without
the provider adapters changing.
