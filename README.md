# DROIDEX

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

DROIDEX is a macOS desktop workspace for coding agents. It runs Factory Droid,
Claude Code, and Codex side by side, and keeps their chats, projects, terminals,
browser sessions, and file changes together in one app instead of scattered
across terminal tabs.

Website: [droidex.vercel.app](https://droidex.vercel.app)

## What it does

- **Run several agents at once.** Each conversation is a session with its own
  workspace, model, and autonomy level. The sidebar groups them by workspace or
  by what needs your attention.
- **Watch the work as it happens.** Tokens stream live, tool runs expand to the
  detail you choose, and every file an agent touches is one click from a diff.
- **Review before you accept.** Changed files open in Review with the captured
  diff, so you see what actually happened rather than trusting a summary.
- **Stay on top of pull requests.** For GitHub repositories, DROIDEX reads pull
  requests, checks, and review comments through the GitHub CLI.
- **Drive a real browser.** Agents can open and operate a browser pane when a
  task needs the web.

[docs/using-droidex.md](docs/using-droidex.md) explains these in detail.

## Install

You need **macOS**, **Node.js 22**, and npm. You also need the CLI for whichever
agent you want to use: Factory Droid, Claude Code, or Codex. DROIDEX can install
the Factory Droid CLI for you during onboarding.

```bash
git clone https://github.com/droidex-anas/droid-maxxing.git
cd droid-maxxing
npm install
npm ci --prefix sidecar
npm run electron
```

Prebuilt, signed macOS downloads live in the
[releases repository](https://github.com/droidex-anas/droidex-releases).
DROIDEX checks a signed Sparkle feed for updates and never downloads or installs
one until you approve it.

## Develop

`npm run dev` starts the renderer alone against Vite, which is faster when you
are only changing UI.

To run a development build beside an installed copy, give it its own port and
profile so the two do not fight over the same state:

```bash
ELECTRON_START_URL=http://127.0.0.1:1421 BRIDGE_PORT=8766 \
DROIDEX_USER_DATA_DIR="$HOME/Library/Application Support/DROIDEX-dev" \
npm run electron
```

Copy `.env.example` to `.env` for local overrides. It documents every supported
environment variable.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend dev server |
| `npm run electron` | Build the sidecar and launch DROIDEX |
| `npm run build` | Create a production build |
| `npm run test` | Run app and Electron tests |
| `npm --prefix sidecar run test` | Run sidecar unit tests |
| `npm run typecheck` | Check app TypeScript |
| `npm run sidecar:typecheck` | Check sidecar TypeScript |
| `npm run format:check` | Check formatting |

## Privacy

Crash reporting and release health are on by default in release builds. They use
a random local profile ID and can include crash stacks, native crash dumps, and
technical device information. Crash data can contain incidental sensitive
material, and access belongs only to the private DROIDEX Sentry project. DROIDEX
does not attach your account identity and does not use Sentry for analytics.

Turn it off under **Settings → Privacy & diagnostics**. That stops automatic
reporting and deletes the local profile ID. `/bug` and `/feedback` are only ever
sent when you submit them yourself.

## Documentation

- [Using DROIDEX](docs/using-droidex.md), the day to day guide
- [Architecture](docs/architecture.md)
- [Automations](docs/automations.md), for scheduled tasks
- [Command reference](docs/generated/project-reference.md)
- [Runbooks](docs/runbooks.md)
- [Releasing](docs/releasing.md) and
  [release observability](docs/deployment-observability.md)
- [AGENTS.md](AGENTS.md), the engineering guide

## Contributing

Contributions are welcome: bugs, fixes, features, and documentation. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) for the setup, the checks to run, and the
commit sign-off. Issues labelled
[good first issue](https://github.com/droidex-anas/droid-maxxing/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
are a good place to start, and
[Discussions](https://github.com/droidex-anas/droid-maxxing/discussions) is the
place for questions.

Found a security problem? Do not open an issue. Follow [SECURITY.md](SECURITY.md).

Everyone taking part is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

DROIDEX is open source under the [Apache License 2.0](LICENSE). You may use,
modify, and redistribute it, including commercially, as long as you follow the
license: keep the copyright and attribution notices, ship the [NOTICE](NOTICE)
file, and state prominently in any file you changed that you changed it.

The DROIDEX name, logo, and visual identity are not covered by the license. If
you fork DROIDEX, rename your build and say plainly that it is a fork, with a
link back here. [TRADEMARKS.md](TRADEMARKS.md) covers what that means in
practice. Fork it, build on it, sell it if you like. Just do not present it as
though you wrote it.
