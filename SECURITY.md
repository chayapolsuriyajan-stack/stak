# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it
privately instead:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.

Only the maintainer can see the report. Include what you did, what happened,
and what you expected — a minimal `STAK.md`, `.stak/settings.json`, or prompt
that reproduces it is ideal.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No — please upgrade |

## What counts

stak runs a model's tool calls on your machine, so some of what it can do is
dangerous by design. Worth reporting — anything that crosses a boundary stak
promises to hold:

- File tools (`read`, `write`, `edit`, `glob`, `grep`) reaching outside the
  project directory.
- A committed project file (`.stak/settings.json`, `STAK.md`) causing code to
  run, or reading files outside the project, without the user opting in.
- `webfetch` reaching loopback, private, or cloud-metadata addresses without
  `STAK_WEBFETCH_ALLOW_PRIVATE=1`.
- A tool call running without approval in a mode that should have asked, or
  running at all in `plan` mode.
- Model-chosen text (tool arguments, fetched pages, file contents) being
  executed as shell syntax — for example in hook commands.

Working as designed — not vulnerabilities:

- The `bash` tool is **not sandboxed**. A command you approve can do anything
  your OS account can.
- `auto` and `bypass` modes run tool calls without asking; `bypass` also skips
  hooks. That is what they are for.
- Hooks in `~/.stak/config.json` run whatever you configure them to.
- A model choosing a harmful action you then approve.

See the [Security section of the README](README.md#security) for the full
model.
