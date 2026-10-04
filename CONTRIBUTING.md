# Contributing

Thanks for helping. Bug reports, fixes, and small features are all welcome —
for anything large, open an issue first so we can agree on the approach
before you spend time on it.

For security problems, follow [SECURITY.md](SECURITY.md) instead of opening
an issue.

## Setup

Requires Node 20 or newer.

```bash
npm install
npm run dev        # run stak from source
npm test           # the full suite
npm run typecheck
npm run build      # bundles to dist/
```

To try your build as the real `stak` command, run `npm link` in the repo.

## Before opening a pull request

- `npm run typecheck`, `npm test`, and `npm run build` all pass. CI runs them
  on Linux and Windows with Node 20 and 22, and a red check blocks merging.
- New behavior comes with tests. Bug fixes come with a test that fails
  without the fix.
- User-facing changes update the README.
- Keep pull requests focused: one change per PR is much easier to review.

## Code conventions

- Logic that can be pure lives in its own small module with its own tests
  (see `src/agent/compact.ts`, `src/providers/preflight.ts`), rather than
  inline in a component or in `cli.ts`.
- Comments explain *why*, especially for anything that looks odd — a
  security boundary, a platform quirk, a race.
- Anything touching the filesystem, subprocesses, the network, or what gets
  sent to a model provider needs particular care; read the Security section
  of the README first.
- Windows is a first-class platform. Don't assume POSIX paths, shells, or
  signals.

## Releasing (maintainers)

1. In `CHANGELOG.md`, turn the `Unreleased` entries into a new
   `## [x.y.z] — YYYY-MM-DD` section.
2. `npm version x.y.z --no-git-tag-version`, then commit both changes as
   `Release x.y.z` and push. Wait for CI to pass.
3. `git tag -a vx.y.z -m "stak x.y.z"` and `git push origin vx.y.z`.

Pushing the tag runs the Release workflow. It checks that the tag matches
`package.json`, runs the full verification, creates the GitHub release from
that version's changelog section, and attaches the pre-built `stak.tgz`
that the README's install command downloads. A release without that file
would break installation for everyone, so don't create releases by hand.

## Compatibility

stak follows semantic versioning from 1.0. The public surface is: CLI flags,
the keys in `~/.stak/config.json` and `.stak/settings.json`, permission mode
names, the hook payload and `STAK_*` hook environment variables, and the
session file format. Changing any of those incompatibly needs a major
version, so call it out in your PR.
