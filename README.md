# DROIDEX

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

DROIDEX is a macOS desktop workspace for coding agents. It brings chat,
projects, terminals, browser sessions, GitHub pull requests, file review, and
agent activity into one local app so you can run serious development work
without losing the thread.

DROIDEX works with supported agent CLIs including Factory Droid, Claude Code,
and Codex. Factory Droid onboarding can be handled inside the app; other agent
CLIs can be connected from your local environment.

Website: [droidex.vercel.app](https://droidex.vercel.app)

## Why DROIDEX

Coding agents are most useful when their context, changes, terminals, and
reviews stay connected. DROIDEX is built around that workflow:

- keep multiple agent-driven tasks visible across workspaces;
- inspect tool activity without digging through raw logs;
- review changed files and captured diffs where the conversation happened;
- track linked GitHub pull requests, checks, and review comments;
- run isolated development profiles beside your main app;
- preserve local-first control over project files, terminals, history, and
  diagnostics.

The goal is not another chat window. DROIDEX is a desktop control center for
shipping with coding agents.

## What you can do

### Run agent work in one place

Create and resume coding sessions across local workspaces. DROIDEX keeps the
conversation, project context, terminal activity, browser sessions, and file
changes together so you can switch between tasks without reconstructing state.

### Review changes as the work happens

Open changed files from the Review surface, inspect captured diffs, and jump
back to live Git changes. Repeated edits show the latest captured change and
matching line counts, even when the full Git diff has moved on.

### Understand tool activity

Settings -> Tool activity controls how much detail appears inside tool runs:
compact summaries, balanced expandable rows, or detailed output. Completed
turns keep one Worked disclosure followed by the final answer at every density.
Read output remains available inside the disclosure, while compaction markers
stay visible.

### Track GitHub pull requests

For GitHub repositories, the Context panel shows pull requests, checks, and
review comments through GitHub CLI. If `gh` is missing or signed out, DROIDEX
shows a recovery action. It can install `gh` through Homebrew when available,
or open GitHub's official installation page.

DROIDEX also detects linked pull requests for chat worktrees automatically.
The sidebar can group conversations by pull request, and PR search works by
number, URL, title, or branch.

### Manage parallel work

Use **Customize sidebar** to switch between workspace grouping and
**Activity / status**. Activity separates tasks that need attention, working
tasks, ready conversations, and settled work. Conversations can be marked
settled after review and reopened later; new activity brings them back.

## Product highlights

- **Agent workspace**: sessions for supported coding-agent CLIs in one desktop
  app.
- **Project context**: workspaces, terminals, browser sessions, files, and
  chat history stay connected.
- **Review mode**: captured diffs, changed-file previews, and live Git changes
  are available from the same task.
- **GitHub context**: pull requests, checks, and review comments appear inside
  DROIDEX through GitHub CLI.
- **Task triage**: activity grouping, unread filters, settled tasks, and PR
  grouping keep busy sidebars usable.
- **Local-first defaults**: app state, local history, and agent tooling remain
  under your macOS profile unless you explicitly connect external services.
- **Signed updates**: release builds use Sparkle for macOS update checks.

## Install and updates

Official macOS downloads and first-launch instructions live in the
[public releases repository](https://github.com/droidex-anas/droidex-releases).

DROIDEX checks its signed Sparkle feed for new versions. When an update is
available, a blue download button appears beside Settings. Clicking it opens
Sparkle's native update window; nothing downloads or installs until you approve
it. You can also check manually from the DROIDEX menu.

Permanent website links and the tag-controlled publishing flow are documented
in [`docs/releasing.md`](docs/releasing.md).

## Run it locally

You need macOS, Node.js 22, npm, and at least one supported agent CLI. DROIDEX
can install the Factory Droid CLI during onboarding if it is not already
available.

Install dependencies and launch the desktop app:

```bash
npm install
npm ci --prefix sidecar
npm run electron
```

For renderer-only development, use:

```bash
npm run dev
```

To run a second development instance beside your main app, isolate both its
profile and history writer. Raw Factory transcripts are still discovered.
Electron places the isolated history database in `<profile>/history`; a bare
sidecar can set `DROIDEX_HISTORY_DIR` explicitly. The default app keeps
`~/.factory/droidex`:

```bash
ELECTRON_START_URL=http://127.0.0.1:1421 BRIDGE_PORT=8766 \
DROIDEX_USER_DATA_DIR="$HOME/Library/Application Support/DROIDEX-dev" \
npm run electron
```

Copy `.env.example` to `.env` for local overrides.

## Useful commands

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

## Privacy and diagnostics

DROIDEX is designed around local development workflows. Project files, local
history, terminals, and agent CLIs live on your machine. GitHub features use
GitHub CLI authentication, and agent features use the supported CLI you connect
or install.

Release builds enable automatic crash reports and Sentry Release Health by
default. Reports use a random local profile ID and can include crash stacks,
native crash dumps, and technical device/runtime context. Crash material can
contain incidental sensitive data; access belongs only to the private DROIDEX
Sentry project. DROIDEX does not intentionally attach account identity or use
Sentry for feature analytics.

You can turn automatic diagnostics off under **Settings -> Privacy &
diagnostics**. Changing the preference restarts DROIDEX. Disabling it stops
automatic reporting and deletes the local profile ID. `/bug` and `/feedback`
reports are sent only when you explicitly submit them; while automatic
diagnostics are off, those reports use a non-persisted report-scoped ID.

Found a security problem? Do not open a public issue. Follow
[`SECURITY.md`](SECURITY.md).

## Project structure

| Area | Path | Role |
| --- | --- | --- |
| Renderer | `src/` | React UI, state, hooks, and workspace surfaces |
| Electron host | `electron/` | Main process, preload, menus, native browser, updater |
| Sidecar | `sidecar/src/` | Node service that drives supported agent CLIs |
| Docs | `docs/` | Architecture, generated references, runbooks, release notes |

Read [`docs/architecture.md`](docs/architecture.md) before changing behavior
that crosses the renderer, Electron, or sidecar boundary.

## Contributing

Contributions are welcome: bugs, fixes, features, and documentation.
[`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, validation, pull requests,
and the required DCO sign-off. [`AGENTS.md`](AGENTS.md) is the engineering
guide the project uses for review. [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
applies to everyone taking part.

For most code changes, run the focused checks for the files you touched. For a
broad change, start with:

```bash
npm run docs:check
npm run format:check
npm run typecheck
npm run sidecar:typecheck
npm run electron:check
```

If you change scripts, environment variables, or onboarding commands, also run:

```bash
npm run docs:generate
npm run docs:check
```

## License and trademark

DROIDEX is open source under the [Apache License 2.0](LICENSE). You may use,
modify, and redistribute it, including commercially, as long as you follow the
license: keep the copyright and attribution notices, ship the [NOTICE](NOTICE)
file, and state prominently in any file you changed that you changed it.

The DROIDEX name, logo, and visual identity are not covered by the license. If
you fork DROIDEX, rename your build and say plainly that it is a fork of
DROIDEX, with a link back here. [`TRADEMARKS.md`](TRADEMARKS.md) covers what
that means in practice. Fork it, build on it, sell it if you like; just do not
present it as though you wrote it.

## More documentation

- [Automations](docs/automations.md)
- [Architecture overview](docs/architecture.md)
- [Command reference](docs/generated/project-reference.md)
- [Runbooks](docs/runbooks.md)
- [Team release guide](docs/releasing.md)
- [Release controls and observability](docs/deployment-observability.md)
- [Engineering instructions](AGENTS.md)
