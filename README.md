# Stak

A local-first agentic coding CLI. Runs against a local model through Ollama, or
against Claude and OpenAI when you want a hosted one — the agent loop is the
same either way.

## Install

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
stak --model qwen3.8-iq4xs # override the model for this run
stak --provider anthropic  # override the provider
```

Inside a session:

| Command | Effect |
| --- | --- |
| `/help` | list commands |
| `/clear` | clear the transcript and start a new session |
| `/model [name]` | show or switch the active model |
| `/permissions [mode]` | show or set the permission mode |
| `/exit` | quit |
| `shift+tab` | cycle the permission mode |

## Configuration

Credentials and defaults live in `~/.stak/config.json`:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "qwen3.8-iq4xs",
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
| `ask` | prompts before edits and commands (default) |
| `accept-edits` | edits run unattended, commands still prompt |
| `auto-bypass` | nothing prompts |

Commands stay gated in `accept-edits` because an edit leaves a diff you can
read and revert, and an arbitrary shell command does not.

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

## Sessions

Conversations append to `.stak/sessions/<id>.jsonl` as they happen, so an
interrupted session still leaves a resumable transcript. `--continue` reopens
the most recent one and keeps writing to the same file.

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
