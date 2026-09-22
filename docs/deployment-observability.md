# Deployment Observability

Start with the human release checklist in [`releasing.md`](releasing.md). This
document records the deeper controls, trust boundaries, and operational checks.

This project observes release readiness through GitHub Actions, verified build
artifacts, updater configuration, private crash intake, and local runtime logs.

## Pre-release signal checklist

Before cutting or promoting a desktop build, verify the latest default-branch CI run is green for:

- Frontend tests
- Sidecar tests
- Frontend typecheck
- Sidecar typecheck
- Electron syntax
- Production build
- Format check
- Documentation check

The CI workflow is defined in `.github/workflows/ci.yml`. Each job uses Node.js 22 and runs the same commands documented in `README.md` and `AGENTS.md`.

## Deployment configuration to capture

Record these values with each release candidate:

| Variable | Why it matters |
| --- | --- |
| `DROIDEX_UNSIGNED_RELEASE_BUILD` | Enables the fail-closed unsigned website release configuration |
| `DROIDEX_RELEASE_BUILD` | Enables the fail-closed signed/notarized release configuration |
| `CSC_LINK` | Developer ID Application certificate supplied through CI secrets |
| `APPLE_API_KEY_P8_BASE64` | Base64-encoded App Store Connect key materialized as a temporary `.p8` file in CI |
| `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_TEAM_ID` | Apple identities used for notarization and signature verification |
| `SENTRY_DSN` | Public client DSN embedded for crash and `/bug` reporting |
| `SPARKLE_PRIVATE_KEY` | EdDSA private key used only in protected release automation to sign unsigned-app update feeds and ZIPs |
| `DROIDEX_RELEASE_TOKEN` | Fine-grained token with Contents write and Administration read access only to the public releases repository |

The current `macos-release` GitHub environment requires `SENTRY_DSN`,
`SPARKLE_PRIVATE_KEY`, and `DROIDEX_RELEASE_TOKEN`. Add the Apple credentials
only when the workflow is deliberately converted to the future Developer ID
path. The environment's deployment policy admits `v*` tags only and disables
administrator bypass. The workflow also requires the tagged commit to be
exactly versioned and already contained in `origin/main`. Keep real secrets out
of release notes and CI logs. The release token is exposed only to public
release-repository checks during preflight, the final publish step, and
marker-gated failed-draft cleanup. Source-repository checks continue to use the
workflow's scoped token.

Release secrets also require a real approval boundary. Before pushing a release
tag, configure a required environment reviewer and protected `main`/tag rules.
If the repository plan cannot enforce those controls, keep release-capable
write access owner-only or remove the release secrets between supervised
releases. A `v*` deployment policy limits eligible refs; it does not stop a
write collaborator from changing a workflow.

Run `npm run release:preflight:unsigned` for the current free distribution path.
It verifies both repository identities and visibility, immutable public releases,
the unsigned disclosure, exact remote commit, Sparkle configuration,
architecture-specific signed feeds, checksums, DMGs, packaged native modules,
and canonical SQLite schema.

Run `npm run release:preflight` before a future Developer ID release. It verifies the
repository identity and visibility, immutable release policy, environment tag
protection, secret names (never values), local Developer ID identity, workflow
syntax, exact `origin/main` commit, and fully verified local artifacts. Any
failure blocks tagging.

## Canonical release path

The current website release is ad-hoc signed, but it has no trusted Developer ID
signature and is not notarized. It does not require an Apple Developer Program subscription. Build with
`DROIDEX_UNSIGNED_RELEASE_BUILD=1`, inject `SENTRY_DSN` from protected release
configuration, generate both Sparkle appcasts with `npm run sparkle:appcast`,
and run the unsigned preflight. Publish only these immutable public assets:

- `droidex-arm64.dmg` and `droidex-x64.dmg`
- `droidex-arm64.zip` and `droidex-x64.zip`
- `appcast-arm64.xml` and `appcast-x64.xml`
- `SHA256SUMS`

The website should link Apple-silicon users to the arm64 DMG and Intel users to
the x64 DMG. Because the app is not Developer ID-signed or notarized, the first
launch requires the user to approve DROIDEX in macOS System Settings > Privacy
& Security > Open Anyway.
The DMG includes an **Open Privacy & Security** shortcut beside the Applications
alias. After macOS blocks the first launch, users can double-click that shortcut
to open the required settings pane directly; macOS still requires the user to
click **Open Anyway** and authenticate.
That friction is intentional until Developer ID signing and notarization are
enabled.

Sparkle 2.9.5 is downloaded from its pinned official release and verified by
SHA-256 during the build. Each architecture reads only its matching HTTPS
appcast. The appcast and enclosed ZIP are signed with DROIDEX's EdDSA key;
release verification checks both signatures against the public key embedded in
the app. DROIDEX may check for updates in the background, but it never downloads
or installs an app update without the user choosing the update action.
Keep the private key only in the macOS Keychain and the protected
`macos-release` GitHub environment.

`.github/workflows/release-macos.yml` is the only production publisher. A tag
whose name exactly matches the source package version and is already
contained in `main` runs all release gates, builds the ad-hoc-signed Intel and
Apple silicon packages, signs both Sparkle appcasts, verifies the artifacts,
and generates `SHA256SUMS`.

The workflow publishes these files to the public
`droidex-anas/droidex-releases` repository in one `gh release create`
operation. GitHub creates a draft, uploads exactly the two DMGs, two ZIPs, two
appcasts, and `SHA256SUMS`, compares every remote digest with the local file,
and publishes only after verification succeeds. Enable immutable releases on
that public repository so published tags and assets cannot be replaced. The
repository itself contains only public download documentation. Its automatic
source archives contain only that documentation, never the application source.

A future Developer ID release must deliberately convert this same workflow to
the signed/notarized `DROIDEX_RELEASE_BUILD=1` path and run
`npm run release:preflight`. That path uses `latest-mac.yml` and blockmaps for
electron-updater. Do not enable the free Sparkle and paid Developer ID paths for
the same tag.

Do not attach `builder-debug.yml`, source maps, `.env` files, certificates, or
source archives. Electron application JavaScript shipped inside the
DMG remains inspectable by users; keep secrets and privileged server logic out
of the client.

## Runtime health checks

After installing a candidate build:

1. Launch the app and confirm the renderer loads.
2. Complete onboarding or confirm existing settings load.
3. Start a Droid session and verify sidecar connection status.
4. Confirm CLI discovery or installation works on a clean machine.
5. Confirm the macOS menu exposes Check for Updates, Privacy & Security,
   standard Edit actions, safe Reload actions, Window actions, and Help. Packaged
   builds must not expose Developer Tools.
6. Trigger an update check against the public releases repository.
7. Inspect Electron and sidecar logs for bridge authentication, download, or update errors.
8. On the oldest supported macOS release, double-click the DMG's Privacy &
   Security shortcut and confirm it opens the correct system pane.

Before promoting every update after the first release, install the previous
public version on a clean test account and confirm it discovers the
architecture-matched appcast, verifies the signed ZIP, installs, and relaunches
into the candidate version. The first release has no N-1 candidate; it instead
requires native Sparkle-load, signed-feed, signed-archive, and packaged-runtime
verification. A future Developer ID release additionally requires Gatekeeper,
notarization, and stapling checks.

The direct-download app is not App Sandbox–restricted. It asks macOS for access
to Desktop, Documents, or Downloads only when the user selects a protected
project location. Camera, microphone, Accessibility, Screen Recording, and
Apple Events permissions are not requested because current DROIDEX features do
not use those system capabilities.

The sidecar uses Electron's bundled Node 22 runtime and its built-in
`node:sqlite`; users do not install or download SQLite. The canonical session
index is `~/.factory/droidex/session-index.sqlite`. It is DROIDEX-owned derived
state built from raw Factory session history under `~/.factory/sessions`.

## Crash and bug intake

Sentry captures uncaught main/renderer/native crashes and sidecar exits. The
`/bug` and `/feedback` composer commands open the private feedback form. A
successful submission creates a sortable `RPT-…` report ID that remains visible
and copyable until the user dismisses the receipt. DROIDEX shows that receipt
only after Sentry returns the same event ID that DROIDEX submitted. This confirms
that Sentry accepted the envelope, not that it has already been indexed or shown
in a particular Issues filter. Missing or mismatched acknowledgments, network
failures, timeouts, rate limits, and server errors keep the form open with its
entered details for retry.

Manual reports use an explicit payload allowlist. They contain the details and
category selected by the user, the report ID, a stable pseudonymous `USR-…`
installation ID, app version, macOS version, CPU architecture,
Electron/Chromium/Node versions, and packaged status. DROIDEX does not attach
chats, prompts, project files or paths, browser content or history, logs,
environment variables, API keys, GitHub credentials, network requests, or
breadcrumbs to manual reports. The UI states this boundary before submission.

Crash reporting retains exception messages and stacks plus the default Electron
runtime, device, screen, GPU, module, source-context, ANR, and crashed-URL
diagnostics needed to debug failures. Native crashes can include minidump
attachments, whose process-memory snapshot may contain incidental sensitive
data. Requests, breadcrumbs, and user fields other than the pseudonymous local
profile ID are removed from JavaScript crash events. Default PII and performance
tracing remain disabled, but those controls do not make crash artifacts free of
incidental sensitive data. Restrict Sentry project access to release/incident
operators and configure retention in Sentry before public distribution.

Packaged app launches also create Sentry Release Health sessions. DROIDEX loads
the stable pseudonymous installation ID before Sentry starts, so Release Health
can report app sessions, unique active local profiles, crash-free sessions, and
observed version adoption without intentionally collecting account identity or
product activity. A profile is one Electron user-data directory: it can survive
an app update or reinstall, resets when that directory is removed, and is not a
person or physical-device count. Treat the first release observed for a profile
as its first observed version and a later release only as that same profile being
active on a later version. Development sessions are isolated under the
`development` environment and must not be included in production usage counts.

Automatic diagnostics are enabled by default in release builds and disclosed in
the README and **Settings → Privacy & diagnostics**. Changing the preference
restarts DROIDEX so the Electron SDK initializes exactly once before app
readiness. Disabling closes the Sentry client and deletes the local profile ID.
Explicit `/bug` and `/feedback`
submissions remain available because they are sent only after the user reviews
the manual-report boundary and chooses Submit; while automatic diagnostics are
disabled, each report uses a report-scoped ID that is not persisted locally.

Sentry is operational observability, not product analytics. DROIDEX does not use
Sentry messages as analytics events and does not track clicks, prompts, commands,
project names, file paths, browser activity, or session content. Installation
counting lives in a separate system described in
[Anonymous installation analytics](#anonymous-installation-analytics); measuring
feature funnels or retention would need its own privacy review before anything
beyond those two events is collected.

Connect the private Sentry project to the source repository using Sentry's
server-side GitHub integration and an issue alert rule. No GitHub token belongs
in the DMG. Upload private source maps from release CI only; never attach source
maps to the public GitHub release.

## Incident triage

If a deployment causes user impact:

1. Stop promotion of the current release candidate.
2. Capture OS version, app version, CPU architecture, and the public release tag.
3. Reproduce with `npm run electron` when possible.
4. Run the relevant runbook in `docs/runbooks.md`.
5. File the fix with the failing CI command and observed runtime log excerpt.

## Anonymous installation analytics

DROIDEX counts installations through Datadog RUM. The goal is a defensible
answer to "how many installations run this?". Nothing here observes features,
funnels, or content: no screen, click, command, setting, harness, prompt, or
session is recorded. Only two events exist, and both are emitted by
`src/lib/usageAnalytics.ts`:

| Event | When | Properties |
| --- | --- | --- |
| `app_opened` | Every launch of a packaged, configured build whose user has not opted out | `app_version`, `platform`, `architecture`, `distribution_channel` |
| `install_first_launch` | Once per installation ID, under the same conditions | the same four, plus `install_origin` |

### The installation identifier

`electron/usageAnalytics.cjs` mints a `crypto.randomUUID()` on the first launch
that reaches it and stores it at `<userData>/usage-analytics.json`. Because
`userData` is outside the app bundle, the identifier survives restarts and
in-place updates, so an installation keeps counting as one installation for as
long as that file is there. It is never derived from hardware, serial numbers,
MAC addresses, usernames, emails, IP addresses, or any account, so it carries
nothing that can be reversed into a person or matched against another
installation. Opting out deletes it and opting back in mints a new one, so the
count is of installations over time and not of people.

`install_origin` separates the two populations that appear the first time an
instrumented build runs:

- `new_install` — nothing else was in `userData`, so this is a first run of the
  app against a fresh profile.
- `existing_install` — an older DROIDEX had already written to `userData`, so
  this is an installation that updated into an instrumented build.

Without that flag, the day an instrumented release ships, the entire existing
user base would look like new installs.

### What is deliberately not collected

Session Replay is not merely disabled, the recorder is not shipped: the app
depends on `@datadog/browser-rum-slim`, which has no replay module, and
`sessionReplaySampleRate` is `0`. Datadog's automatic instrumentation that could
observe user content is off (`trackUserInteractions`, `trackResources`,
`trackLongTasks` are all `false`), `defaultPrivacyLevel` is `mask`, and views
are started manually. Because a RUM view URL in Electron would otherwise be a
local file path, `beforeSend` rewrites every URL and referrer to `app://droidex`
and discards any event that is not one of the two actions or their view.
`sessionPersistence` is `local-storage` because a packaged build loads the
renderer with `loadFile()`, so the page runs on a `file://` origin where cookies
are unavailable and the SDK could not otherwise keep a session. No
prompt, message, file content, repository name, path, project name, email, or
username is collected at any point.

### What Datadog adds server-side

Datadog derives two fields from the connection itself, so they arrive with every
event although the app never sends them: `session.ip`, the client IP, and `geo`,
resolved from it. No client-side SDK option affects either; they are controlled
in the Datadog account under **Organization Settings → RUM**, and changing that
is not retroactive. The Privacy panel names both so its description stays true.

`trackAnonymousUser` is `false`, so the only identifier the app attaches is
`usr.id`, the installation ID.

### Where it does not run

Telemetry initializes only when `app.isPackaged` is true, so `npm run dev`,
`npm run electron`, tests, and CI send nothing. A packaged build stays silent
when any of the three Datadog values is missing, when
`DROIDEX_DISABLE_USAGE_ANALYTICS=1` is set, or when the user has opted out.
Maintainer builds are excluded by channel rather than by hand: only the release
workflow sets `DROIDEX_DISTRIBUTION_CHANNEL=release`, so a local
`npm run dist:mac` reports `distribution_channel:local` and every query below
filters on `release`.

Every failure path is silent by design. A missing configuration, an unreadable
state file, a blocked network, or an SDK that will not load all resolve to "no
telemetry this launch"; none can prevent or delay startup.

### Consent

`Settings → Privacy & diagnostics → Anonymous usage analytics` is a separate
opt-out from the existing crash-reporting toggle, because the two collect
different data for different reasons. It defaults to on, and the copy in the
panel states exactly what is sent. Turning it off deletes the stored
installation ID; turning it back on mints a new one, which counts as a new
installation.

### Release configuration

Set these for the signed release build. They are configured in the
`macos-release` environment and consumed by `.github/workflows/release-macos.yml`,
which passes them to `electron-builder.config.cjs`; that config embeds them in
the packaged `package.json` under `datadog`, which `readBuildMetadata()` in
`electron/main.cjs` reads at startup.

| Variable | Kind | Value |
| --- | --- | --- |
| `DATADOG_APPLICATION_ID` | secret | RUM application id from the Datadog RUM application |
| `DATADOG_CLIENT_TOKEN` | secret | RUM **client token** (`pub…`) from the same application |
| `DATADOG_SITE` | variable | Datadog site — `us5.datadoghq.com` for this project |
| `DROIDEX_DISTRIBUTION_CHANNEL` | literal | `release`, set by the workflow only |

`Kind` says where the release environment holds the value, not how sensitive it
is. The application id and client token are stored as environment secrets so
they are not editable from a fork, but both are embedded in the packaged app and
are public once it ships.

A Datadog **API key** must never be added. It is a server-side credential; a
desktop app ships to users' machines, so anything embedded in it is public. The
RUM client token is designed for exactly this exposure: it can only submit RUM
events to one application and cannot read data or call the Datadog API.

To create the RUM application: in Datadog, go to **Digital Experience → Real
User Monitoring → Applications → New Application**, choose the **Browser** type,
name it `droidex`, and copy the application id and client token. Leave Session
Replay off.

Choose **Browser**, not **Electron**, even though DROIDEX is an Electron app.
The app uses `@datadog/browser-rum-slim`, which is what Datadog's own guide
[Monitor Electron Applications Using the Browser SDK][electron-guide]
prescribes. Datadog's dedicated Electron SDK is alpha, requires Electron 39 or
newer, and does not replace the Browser SDK — it still needs it in every
renderer and only bridges the telemetry through the main process.

The app sets `service: droidex` and `env: production` itself, so no further
configuration is needed in Datadog.

[electron-guide]: https://docs.datadoghq.com/real_user_monitoring/guide/monitor-electron-applications-using-browser-sdk/

### Reading the numbers

All queries filter `@context.distribution_channel:release` so maintainer builds
are excluded, and count `@usr.id`, which is the installation ID.

- **Total unique installations** — RUM Analytics, on `action` events:

      @action.name:app_opened @context.distribution_channel:release
      → measure: unique count of @usr.id, over the full retention window

- **Daily active installations (DAI)** — the same query as a timeseries with a
  1-day rollup; **monthly active installations (MAU)** is the same with a
  30-day rolling window rather than a 30-day rollup, so each point answers "how
  many distinct installations opened the app in the preceding 30 days".

- **New installations per day** — swap the event name:

      @action.name:install_first_launch @context.distribution_channel:release @context.install_origin:new_install
      → unique count of @usr.id, 1-day rollup

  Splitting by `@context.install_origin` separates first runs against a fresh
  profile from the existing base migrating onto an instrumented build.

- **Breakdown by version, platform, and architecture** — the total-installations
  query grouped by `@context.app_version`, `@context.platform`, and
  `@context.architecture`. Grouped by `app_version` over a rolling window this
  doubles as update adoption: the share still on an old version is the share
  that has not updated.

Build these as a single RUM dashboard and link it here once it holds real data.

### Why GitHub release downloads are not the number

The GitHub release API's `download_count` counts asset requests, not people. It
includes repeated downloads by one person, CI and mirror fetches, bots and
scanners, resumed or retried transfers, and the update files Sparkle pulls on
every check. It also cannot tell whether an asset was ever launched. Download
counts and installation counts are different quantities; do not present one as
the other.

A public README badge is deliberately not part of this work. Collect and
validate production telemetry first. A badge, if it is added later, must be fed
by a server-side endpoint that exposes only the aggregate count — never by
embedding a Datadog credential in a public page.

## Missing observability

Release notifications are not configured. If they are added, link the alert
channel here and update `docs/runbooks.md` with escalation steps.
