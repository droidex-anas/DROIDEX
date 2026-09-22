# Contributing to DROIDEX

DROIDEX is open source under the [Apache License 2.0](LICENSE), and
contributions are genuinely welcome. Bug reports, fixes, features,
documentation, and design feedback all move the project forward.

This guide covers how to get the app running, what the project expects from a
change, and how to get that change merged. Everything here is meant to be
followed by a first-time contributor without asking anyone for context.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## What DROIDEX is

DROIDEX is a macOS desktop workspace for coding agents. It is an Electron
application with three processes you will hear about constantly:

| Area | Path | Role |
| --- | --- | --- |
| Renderer | `src/` | React UI, store, hooks |
| Host | `electron/` | Electron main process, preload, launcher |
| Sidecar | `sidecar/src/` | Node service that drives the agent CLIs |

`docs/architecture.md` explains how they talk to each other. Read it before any
change that crosses a process boundary.

## Ways to contribute

- **Report a bug.** Open a [bug report](https://github.com/droidex-anas/droid-maxxing/issues/new?template=bug_report.yml)
  with your macOS version, DROIDEX version, and the steps that reproduce it.
- **Propose a feature.** Open a [feature request](https://github.com/droidex-anas/droid-maxxing/issues/new?template=feature_request.yml)
  describing the problem before the solution.
- **Pick up an issue.** Anything labelled `good first issue` or `help wanted` is
  fair game. Comment on it so two people do not build the same thing.
- **Improve the docs.** Unclear setup steps and stale runbooks are real bugs.
- **Ask a question.** Use
  [Discussions](https://github.com/droidex-anas/droid-maxxing/discussions) for
  anything that is not a bug or a concrete proposal.
- **Report a vulnerability.** Do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).

## Before you write code

For anything beyond an obvious fix, open an issue first and wait for a
maintainer to agree on the approach. A short discussion up front is much cheaper
than a rejected pull request, and it lets the maintainer tell you if the work
collides with something already in flight.

Typos, broken links, small documentation fixes, and clearly-scoped bug fixes do
not need an issue. Just open the pull request.

Agreement on an approach is not a guarantee of merge. The maintainer owns the
roadmap and the final call on what ships.

## Development setup

You need **Node.js 22**, npm, and macOS. DROIDEX drives agent CLIs (Factory
Droid, Claude Code, Codex) and can install the Factory Droid CLI for you during
onboarding.

```bash
git clone https://github.com/<your-username>/droid-maxxing.git
cd droid-maxxing
npm install
npm ci --prefix sidecar
```

Run the full desktop app:

```bash
npm run electron
```

Run the renderer alone, against Vite's dev server:

```bash
npm run dev
```

To run your development build beside an installed copy of DROIDEX, give it its
own port and profile directory so the two do not fight over the same state:

```bash
ELECTRON_START_URL=http://127.0.0.1:1421 BRIDGE_PORT=8766 \
DROIDEX_USER_DATA_DIR="$HOME/Library/Application Support/DROIDEX-dev" \
npm run electron
```

Copy `.env.example` to `.env` for local overrides. It documents every supported
environment variable.

## Engineering standards

**[`AGENTS.md`](AGENTS.md) is the authoritative engineering guide for this
repository, and it applies to human contributors too.** It is long, but it is
the difference between a patch that gets merged and one that sits in review. The
short version:

- Deliver the smallest coherent solution. Fewest concepts, not fewest lines.
- Read the implementation, its callers, and its existing tests before editing.
- Trace a bug to its actual cause. Do not paper over a symptom with another
  flag or fallback.
- Search for an existing helper, hook, or type with `rg` before adding one.
- Keep the renderer provider-neutral; translate CLI-specific behaviour at the
  bridge boundary.
- Use the existing theme tokens (`--droid-*`). Never hardcode a colour.
- Production files stay under 500 lines. Crossing that line needs a reason.
- Delete what you supersede: no dead exports, unused props, or stale comments.
- Comments explain *why*, sparingly. Prefer a clearer name over a comment.

On tests, this project deliberately does **not** want padded pull requests. Add
a test when it protects real behaviour, such as data integrity, session
targeting, ordering, cancellation, cleanup, or a cross-process contract, or when
it pins a bug you just fixed. Keep the existing suites green and update the tests your
change affects. "No new tests" is a normal and accepted outcome.

## Validating your change

Run the checks that match what you touched. For a broad change, run all of them:

```bash
npm run format:check        # Prettier
npm run typecheck           # Renderer TypeScript
npm run sidecar:typecheck   # Sidecar TypeScript
npm run electron:check      # Electron main-process syntax
npm run test                # Renderer and Electron tests
npm --prefix sidecar run test
npm run docs:check          # Generated docs are in sync
npm run build               # Production build
```

`npm run lint` is non-blocking because of an existing backlog, but files you add
or change own their diagnostics, so leave them clean.

If you changed scripts, environment variables, or onboarding commands,
regenerate the docs:

```bash
npm run docs:generate
npm run docs:check
```

For UI work, look at the change in the running app. A passing build is not
visual verification.

Performance-sensitive changes are validated with the deterministic replay
harness, not intuition:

```bash
npm run perf:replay -- --scenario streaming
npm run perf:compare
npm run perf:gates
```

The pre-commit hook runs lint-staged, file-size, tech-debt, and typecheck gates,
so most mistakes are caught before you push.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sidecar): stream Codex tool events through the bridge
fix(sessions): keep a replaced session from applying stale results
docs(contributing): document the DCO sign-off
```

Common types here are `feat`, `fix`, `perf`, `refactor`, `docs`, `test`,
`style`, `build`, and `chore`. Keep each commit focused and buildable, and write
a plain message that says what changed and why. No generated trailers.

### Sign your commits (DCO)

DROIDEX uses the [Developer Certificate of Origin](https://developercertificate.org/).
It is a one-line statement that you wrote the code you are submitting, or
otherwise have the right to submit it. You keep the copyright in your work; you
license it to the project under Apache 2.0.

Add the sign-off by committing with `-s`:

```bash
git commit -s -m "fix(sessions): keep a replaced session from applying stale results"
```

That appends a trailer using your configured git name and email:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Every commit in your pull request needs one, and CI checks this. If you forgot,
fix the last commit with:

```bash
git commit --amend -s --no-edit
git push --force-with-lease
```

For a whole branch:

```bash
git rebase --signoff main
git push --force-with-lease
```

## Opening a pull request

1. Branch from `main` in your fork, named for the work:
   `fix/stale-session-results`, `feat/codex-tool-events`.
2. Make the change, run the relevant checks, and sign off your commits.
3. Push and open a pull request against `main`.
4. Fill in the pull request template: what changed, why, and which checks you
   actually ran. Never claim a check you did not run.
5. Include screenshots or a short recording for anything visual.

Keep the diff reviewable. Unrelated reformatting, import reordering, and
drive-by renames make a change harder to review and will be asked out. If a
mechanical move and a behaviour change are both large, split them into separate
commits so a reviewer is not hunting for logic inside a rename.

## Review

A maintainer reviews every pull request. CI must be green and the DCO check must
pass before review. Expect questions about naming, ownership of state, failure
handling, and whether a simpler version of the change exists. The bar is
readability by the next person, not just working code.

Push follow-up commits rather than force-pushing during review, so reviewers can
see what changed. Squashing happens at merge.

If a pull request goes quiet, a polite ping after a week is welcome.

## Licensing of contributions

Contributions are accepted under the [Apache License 2.0](LICENSE), the same
license as the rest of the project. You keep the copyright in your work. Your
DCO sign-off is your statement that you have the right to submit it under that
license.

If a change includes third-party code, say so explicitly in the pull request and
name its license, so it can be attributed correctly in `NOTICE`.

Forking for your own product is allowed and encouraged. See
[TRADEMARKS.md](TRADEMARKS.md) for what you must do to credit DROIDEX and make
clear that your fork is a fork.
