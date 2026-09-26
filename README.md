# DROIDEX

**One desktop app for all your coding agents.**

Run Factory Droid, Claude Code, and Codex side by side, and keep every chat,
terminal, browser session, diff, and pull request attached to the work that
produced it.

[![Latest release](https://img.shields.io/github/v/release/droidex-anas/droidex-releases?label=download&color=orange)](https://github.com/droidex-anas/droidex-releases/releases/latest)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/droidex-anas/droidex-releases/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[**Download for macOS**](https://github.com/droidex-anas/droidex-releases/releases/latest)
· [Website](https://droidex.vercel.app)
· [Contributing](CONTRIBUTING.md)

## Why DROIDEX

Agents are getting better. The workflow around them is still messy. One task
lives in a chat, another is running in a terminal, the diff is somewhere else,
and the pull request sits in a browser tab.

DROIDEX puts all of it in one place. It is built around your project and the
work happening inside it, not around one model or one chat window.

## What you can do

**Use every agent from one app.** Start sessions with Factory Droid, Claude
Code, or Codex using the CLIs and accounts you already have. Each session keeps
the agent it started with, so switching projects never switches tools under you.

**Run work in parallel without losing track.** The sidebar sorts conversations
by what they need from you: waiting for input, still working, ready to review,
or done. When an agent spins up subagents, you watch them work alongside the
main conversation.

**See exactly what the agent did.** Tool activity reads like a summary, not a
wall of logs. Every file the agent changed opens in Review with the diff it
produced, and one click takes you to the live Git changes.

**Give your agent a real browser.** DROIDEX includes a built-in browser that
agents can drive. They can open pages, click, fill forms, scroll, take
screenshots, and read the console and network, so they can check their own
work in a running app.

**Keep terminals and files next to the chat.** Terminals, a file browser, and
previews live in the same window as the conversation that needs them.

**Stay on top of pull requests.** For GitHub repositories, DROIDEX shows pull
requests, checks, and review comments inside the app. It links chats to their
pull requests automatically and lets you group the sidebar by pull request.

**Schedule work for later.** Send a prompt to a conversation at a set time, or
set up automations that start new chats, all from one list.

**Talk instead of type.** Voice mode lets you speak to your agent without
leaving the conversation.

## Supported agents

| Agent | Setup |
| --- | --- |
| Factory Droid | DROIDEX can install it for you during onboarding |
| Claude Code | Uses the Claude Code CLI already installed and signed in on your Mac |
| Codex | Uses the Codex CLI already installed and signed in on your Mac |

If an agent is missing or signed out, DROIDEX tells you in the agent picker
instead of failing mid-task.

### Use subscriptions with Droid

On an Apple silicon Mac, open **Settings → DroidProxy** to install DroidProxy,
connect a supported subscription through its browser sign-in, and add its models
to Droid's model picker. DROIDEX verifies the download checksum and leaves the
macOS app approval to you. If macOS blocks the first launch, approve DroidProxy
in **System Settings → Privacy & Security**, then open it again.

**Apply** updates `~/.factory/settings.json` with a backup and refreshes the
model picker. If you disable every provider, **Remove proxy models** clears the
previously applied entries. DroidProxy runs locally and must be open to serve
those models.

## Install

1. Download the latest DMG from the
   [releases page](https://github.com/droidex-anas/droidex-releases/releases/latest).
   There are builds for both Apple silicon and Intel Macs.
2. Drag DROIDEX into Applications.
3. Follow the first-launch steps on the releases page.

DROIDEX checks for updates through Sparkle and tells you when a new version is
ready. Nothing downloads or installs until you approve it.

## Privacy

Your projects, terminals, and conversation history stay on your Mac. Agents
talk to their own providers using your own accounts, and GitHub features use
your GitHub CLI login.

Release builds send two kinds of data, and you can turn off each one under
**Settings > Privacy & diagnostics**:

- **Crash reports**, so bugs get fixed. They include crash details and device
  and runtime information, tied to a random local ID.
- **Anonymous usage analytics**, so we know how many installations are active.
  They include a random installation ID, the app version, your platform and
  architecture, and the release channel. The analytics service also sees the IP
  address the request comes from and the approximate location it resolves to.

DROIDEX never sends your prompts, messages, file contents, repository names, or
paths. Reports you send with `/bug` or `/feedback` go out only when you submit
them.

Found a security problem? Please do not open a public issue. Follow
[`SECURITY.md`](SECURITY.md).

## Build from source

You need macOS, Node.js 22, and npm.

```bash
npm install
npm ci --prefix sidecar
npm run electron
```

For renderer-only development, run `npm run dev`. Copy `.env.example` to `.env`
for local overrides.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend dev server |
| `npm run electron` | Build the sidecar and launch DROIDEX |
| `npm run build` | Create a production build |
| `npm run test` | Run app and Electron tests |
| `npm --prefix sidecar run test` | Run sidecar tests |
| `npm run typecheck` | Check app TypeScript |

The full list lives in the
[command reference](docs/generated/project-reference.md).

## Contributing

Contributions are welcome, from bug reports to new features.
[`CONTRIBUTING.md`](CONTRIBUTING.md) covers setup, validation, pull requests,
and the required DCO sign-off. [`AGENTS.md`](AGENTS.md) is the engineering guide
the project reviews against, and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
applies to everyone taking part.

Changing behavior across the renderer, Electron host, and sidecar? Start with
the [architecture overview](docs/architecture.md).

## Documentation

- [Architecture overview](docs/architecture.md)
- [Automations](docs/automations.md)
- [Command reference](docs/generated/project-reference.md)
- [Runbooks](docs/runbooks.md)
- [Release guide](docs/releasing.md)
- [Release controls and observability](docs/deployment-observability.md)

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
