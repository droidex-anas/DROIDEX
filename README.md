# DROIDEX

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

DROIDEX is a macOS desktop workspace for coding agents. It lets you run Factory
Droid, Claude Code, and Codex from one place while keeping conversations,
projects, terminals, browser sessions, file changes, pull requests, and agent
activity together.

Website: [droidex.vercel.app](https://droidex.vercel.app)

## Why DROIDEX

Agents are getting better. The workflow around them is still messy. One task is
in a chat, another is running in a terminal, the diff is somewhere else, and the
pull request lives in a browser tab.

DROIDEX keeps the work together:

- run sessions with Factory Droid, Claude Code, or Codex;
- keep parallel agent tasks visible across workspaces;
- review captured diffs and current Git changes from the same task;
- inspect tool activity without digging through raw logs;
- track linked GitHub pull requests, checks, and review comments;
- keep terminals, browser sessions, files, and conversation history close to
  the work that created them.

The app is built around the project and the work happening inside it, not around
one model or one chat window.

## Supported harnesses

DROIDEX currently supports:

- **Factory Droid**
- **Claude Code**
- **Codex**

Factory Droid can be installed during DROIDEX onboarding. Claude Code and Codex
use the CLIs already installed and authenticated on your machine.

A session keeps the harness it was created with. If a supported CLI is missing,
signed out, or unavailable, DROIDEX shows that state in the harness picker.

## Install and updates

Official macOS downloads and first-launch instructions live in the
[public releases repository](https://github.com/droidex-anas/droidex-releases).

Release builds use Sparkle for signed update checks. When an update is available,
DROIDEX shows it in the app and opens Sparkle's native update flow when you
choose to install it.

## Run it locally

You need macOS, Node.js 22, and npm. To run agent sessions, install at least one
supported agent CLI. Factory Droid can also be installed during onboarding.

```bash
npm install
npm ci --prefix sidecar
npm run electron
```

For renderer-only development:

```bash
npm run dev
```

Copy `.env.example` to `.env` if you need local overrides.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend dev server |
| `npm run electron` | Build the sidecar and launch DROIDEX |
| `npm run build` | Create a production build |
| `npm run test` | Run app and Electron tests |
| `npm --prefix sidecar run test` | Run sidecar unit tests |
| `npm run typecheck` | Check app TypeScript |
| `npm run sidecar:typecheck` | Check sidecar TypeScript |
| `npm run electron:check` | Check Electron main-process syntax |
| `npm run docs:check` | Check generated docs and agent instructions |
| `npm run format:check` | Check formatting |

## GitHub and review

For GitHub repositories, DROIDEX can show pull requests, checks, and review
comments through GitHub CLI. It also detects pull requests linked to chat
worktrees, supports PR grouping in the sidebar, and lets you search linked PRs
by number, URL, title, or branch.

Changed files open in the Review surface with the captured diff from the task.
You can also return to the live Git changes when you need the current repository
state.

## Privacy and diagnostics

DROIDEX keeps its app state, local history, project files, and terminals on your
machine. Connected agent CLIs may use their own provider services and
authentication. GitHub features use GitHub CLI authentication.

Release builds enable automatic crash reports and Sentry Release Health by
default. Reports use a random local profile ID and can include crash stacks,
native crash dumps, and technical device or runtime context. DROIDEX does not
intentionally attach account identity or use Sentry for feature analytics.

Automatic diagnostics can be disabled under **Settings -> Privacy &
diagnostics**. `/bug` and `/feedback` reports are sent only when you submit
them.

Found a security problem? Do not open a public issue. Follow
[`SECURITY.md`](SECURITY.md).

## Contributing

Contributions are welcome.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, validation, pull requests,
and the required DCO sign-off. [`AGENTS.md`](AGENTS.md) is the engineering
guide used for changes in this repository, and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies to everyone taking part.

Building from source or changing behavior across the renderer, Electron host,
and sidecar? Start with [`docs/architecture.md`](docs/architecture.md).

## Documentation

- [Automations](docs/automations.md)
- [Architecture overview](docs/architecture.md)
- [Command reference](docs/generated/project-reference.md)
- [Runbooks](docs/runbooks.md)
- [Team release guide](docs/releasing.md)
- [Release controls and observability](docs/deployment-observability.md)
- [Engineering instructions](AGENTS.md)

## License and trademark

DROIDEX is open source under the [Apache License 2.0](LICENSE). You may use,
modify, and redistribute it, including commercially, as long as you follow the
license, keep the copyright and attribution notices, ship the [NOTICE](NOTICE)
file, and state prominently in any file you changed that you changed it.

The DROIDEX name, logo, and visual identity are not covered by the license. If
you fork DROIDEX, rename your build and say plainly that it is a fork of
DROIDEX, with a link back here. [`TRADEMARKS.md`](TRADEMARKS.md) covers what
that means in practice.
