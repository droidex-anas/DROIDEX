# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub:
[Report a vulnerability](https://github.com/droidex-anas/droid-maxxing/security/advisories/new).
This opens a private advisory visible only to you and the maintainer.

Please include:

- what the vulnerability lets an attacker do;
- the steps or proof of concept that demonstrate it;
- the DROIDEX version, macOS version, and architecture (Intel or Apple silicon);
- any agent CLI involved (Factory Droid, Claude Code, Codex) and its version.

You should get an acknowledgement within 72 hours and an assessment within a
week. If a fix is warranted, you will be kept updated until it ships, and you
will be credited in the advisory unless you ask not to be.

Please give the maintainer a reasonable chance to release a fix before
disclosing publicly.

## What is in scope

DROIDEX is a desktop application that runs agent CLIs against your local
machine, so the interesting boundaries are:

- **Sandbox escape in the renderer.** Anything that gets code execution in the
  Electron main process from renderer-controlled input.
- **The bridge protocol** between the Electron host and the sidecar, including
  unauthenticated or cross-origin access to the local WebSocket port.
- **Path traversal** in file previews, attachments, and workspace file access
  that escapes the permitted workspace folder, including through symlinks.
- **Command injection** through session parameters, workspace paths, or agent
  CLI arguments.
- **Credential exposure**: provider API keys, GitHub CLI tokens, or the bridge
  token being logged, sent to diagnostics, or written where another local
  application can read them.
- **Transcript and session data** being read or written across profile
  boundaries.
- **Update integrity**: anything that lets an unsigned or substituted build pass
  the Sparkle update check.

## What is not in scope

- An agent CLI doing what the user explicitly approved it to do. DROIDEX runs
  real agents against real files by design.
- Vulnerabilities in the agent CLIs themselves. Report those to their vendors.
- Findings that require an attacker who already has local code execution as the
  same user, since they can read the same files DROIDEX can.
- Reports produced only by an automated scanner, with no demonstrated impact.

## Supported versions

Security fixes land on `main` and ship in the next release. Only the latest
released version is supported; there are no backports to older versions.

## Handling of your data

DROIDEX's privacy and diagnostics behaviour is documented in the
[README](README.md#privacy-and-diagnostics).
