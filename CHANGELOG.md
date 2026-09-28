# Changelog

All notable changes to stak are recorded here. From 1.0.0 onward stak
follows [semantic versioning](https://semver.org): the CLI flags, the keys in
`~/.stak/config.json` and `.stak/settings.json`, permission mode names, the
hook payload and `STAK_*` hook environment variables, and the session file
format only change incompatibly in a new major version.

## [1.0.0] — 2026-09-28

### Upgrading from 0.1.0

These changes can break an existing setup. Read them before upgrading.

- **`-p` now means `--print`** (headless mode), not `--provider`. Use `-P` or
  `--provider` to choose a provider. As a safety net, `stak -p ollama` (and
  the other provider names) with nothing piped in is refused with an
  explanation rather than being sent to the model as a prompt.
- **Permission modes were renamed, and the default changed.** `ask` and
  `accept-edits` became `build`; `auto-bypass` became `auto`. The new default
  is `build`, which **applies file edits without asking** and still asks
  before shell commands — the old default, `ask`, asked before edits too. Old
  mode names in `.stak/settings.json` are migrated automatically with a
  warning; `--permission-mode` refuses them with a hint. Use `plan` if you
  want nothing to change without your approval.
- **Hooks are read only from `~/.stak/config.json`.** A `hooks` block in a
  project's `.stak/settings.json` is ignored with a warning (see Security
  below). Hook commands no longer have `$argument` tokens substituted into
  them; read the tool call from the `STAK_TOOL_ARGS` environment variable or
  the JSON on stdin instead.

### Added

- **Headless mode** — `stak -p "prompt"` runs one turn and exits, for scripts,
  pipes, and CI. Piped stdin becomes context. `--output-format` chooses
  `text`, `json`, or `stream-json`; exit codes are `0`/`1`/`130`.
  `--permission-mode` sets the mode for that one run.
- **MCP servers** — connect stdio and HTTP/SSE servers through `mcpServers`
  in either config file, with `${VAR}` expansion so a committed file never
  holds a secret. `/mcp` shows connection status. MCP tools are always gated
  like `bash`.
- **Project memory** — `STAK.md` files (global, parent directories, and the
  project) are loaded into every session, with `@path` imports. `/memory`
  shows what loaded, `/init` asks the model to write one, and typing
  `# some fact` appends to it.
- **Conversation compaction** — `/compact [focus]` summarizes older turns to
  free up context, and it happens automatically at 85% of the context window
  (`autoCompact`, `autoCompactThreshold`). Compaction is saved to the session,
  so resuming keeps the short history.
- **Hooks** — shell commands that run before and after each tool call; a
  failing `beforeTool` hook blocks the call. `/hooks` lists them.
- **`bypass` permission mode** — no prompts and no hooks. Deliberately not in
  the `shift+tab` cycle; reachable only as `/permissions bypass` or
  `--permission-mode bypass`.
- **Task lists** — the model keeps a todo list for multi-step work; `/todo`
  shows it.
- **`webfetch`** — reads a URL as text.
- **Images and video** — `read` sends images to vision-capable models and
  samples video frames with ffmpeg.
- **`-C`/`--cwd` and `STAK_CWD`** — run stak against a directory other than
  the current one.
- **A startup check** that explains a model which isn't downloaded, or an
  Ollama that isn't running, instead of failing the first prompt with a raw
  error.
- A version marker in session files, so future versions can recognize files
  they can't read instead of mis-reading them.
- The system prompt now tells the model what the current permission mode
  allows.

### Fixed

- Tokens-per-second now updates while the model is writing, instead of only
  after the turn finishes.
- A response cut off in the middle of a tool call no longer ends the turn
  with a raw JSON error.
- The TUI no longer flickers while a response streams.
- Interrupting a turn part-way through several tool calls no longer leaves a
  session that Anthropic and OpenAI refuse to resume.
- The session picker no longer resumes the wrong session when down and enter
  are pressed quickly.
- Short JPEG headers are recognized as images.

### Security

These affected the development branch between releases; no tagged release
contained them.

- **Project hooks could run code on clone.** Hooks were read from a
  project's committed `.stak/settings.json`, and read-only tools never ask,
  so opening a hostile repository ran its hook on the first file read —
  including in `plan` mode. Hooks now load only from your own global config.
- **Hook commands were open to injection.** Tool arguments chosen by the
  model were substituted into the shell command string. They now travel only
  as environment variables and JSON, which the shell never re-parses.
- **`webfetch` could reach private networks.** It now refuses loopback,
  private, CGNAT, and link-local addresses — including the cloud metadata
  endpoint — checks every resolved address, and re-checks each redirect.

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## [0.1.0] — 2026-08-21

First public version: an agent loop over Ollama, Anthropic, and OpenAI with
file and shell tools behind a permission gate; `plan` mode; project-confined
file tools; slash commands and skills; session resume; live token and
context stats; and a thinking view (`Ctrl+O`).

[1.0.0]: https://github.com/chayapolsuriyajan-stack/stak/releases/tag/v1.0.0
[0.1.0]: https://github.com/chayapolsuriyajan-stack/stak/commit/a7918e9
