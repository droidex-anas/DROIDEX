# Runbooks

These runbooks cover local development and release triage for DROIDEX.

## User feedback report

1. Ask the user for the copyable `RPT-…` report ID shown after `/bug` or
   `/feedback` submission.
2. Search the private Sentry project by `report_id`. Use `installation_id` only
   when correlating multiple reports from the same pseudonymous installation.
3. Create only a sanitized source-repository issue when public tracking is useful.
   Keep the report ID, description, and attachments in private Sentry.
4. Keep report descriptions and crash attachments out of the public releases
   repository.

## Release Health and profile usage

1. Open the private Sentry Electron project and select Releases or Release
   Health.
2. Filter the environment to `production`. Development launches use the same
   project but a separate `development` environment.
3. Use sessions for app-launch volume, unique users for pseudonymous active local
   profiles, and crash-free sessions for reliability. These are not counts of
   named people, accounts, physical devices, or downloads.
4. Group by `release` to compare observed adoption. The first release observed
   for a `USR-…` profile is its first observed version; seeing the same profile
   later proves only that it was active on a later version. It does not prove
   whether Sparkle or a manual reinstall produced that transition.
5. Do not interpret Sentry as feature analytics. DROIDEX sends no product
   interaction events.
6. Restrict crash-event and minidump access to incident/release operators. Apply
   the approved Sentry retention policy and never copy crash material into the
   public releases repository.

## App does not start in Electron development mode

1. Confirm dependencies are installed:
   ```bash
   npm install
   npm ci --prefix sidecar
   ```
2. Confirm Vite is reachable at the URL used by Electron:
   ```bash
   npm run dev
   ```
3. In another terminal, launch Electron:
   ```bash
   npm run electron
   ```
4. If the renderer is blank, set `ELECTRON_START_URL=http://127.0.0.1:1420` in `.env`.
5. Run syntax and build checks:
   ```bash
   npm run electron:check
   npm run sidecar:build
   ```

## Sidecar bridge is unreachable

1. Check the Electron log for the dynamically assigned bridge port. The
   renderer must obtain its short-lived connection information through the
   authenticated preload bridge; there is no unauthenticated local mode.
2. Run sidecar tests and typecheck:
   ```bash
   npm --prefix sidecar run test
   npm run sidecar:typecheck
   ```
3. In development, rebuild the canonical sidecar entry with
   `npm run sidecar:build`. Packaged builds do not accept a sidecar path
   override.

## Publish a macOS release

1. Confirm the source version is final and the release branch checks are green.
2. Confirm the protected `macos-release` GitHub environment contains the public
   Sentry DSN and Sparkle private key documented in
   `docs/deployment-observability.md`, and the signing certificate from the
   [one-time self-signed certificate setup](releasing.md#one-time-free-signing-setup),
   which keeps macOS permissions across updates.
3. Build both architectures with `DROIDEX_UNSIGNED_RELEASE_BUILD=1`, download
   the last three releases' ZIPs as delta bases, generate the two signed
   appcasts and their Sparkle deltas, and write `SHA256SUMS`.
4. Push the exact release branch, then run the executable unsigned
   release preflight and resolve every failure:
   ```bash
   npm run release:preflight:unsigned
   ```
5. Create the public GitHub release as a draft. Upload only two DMGs, two ZIPs,
   `appcast-arm64.xml`, `appcast-x64.xml`, the `*.delta` files, and
   `SHA256SUMS`. Verify every remote asset byte-for-byte before publishing the
   immutable release.
6. On the public repository, confirm the published release contains exactly
   the assets listed in `SHA256SUMS` plus `SHA256SUMS` itself, and that the
   website download buttons target the DMGs.
7. Download each DMG from the public release on a clean Intel/Apple silicon Mac
   as applicable, install it, start a Droid session, submit a private `/bug`
   report, and record the result.
8. For subsequent releases, complete the Sparkle N-1-to-N update smoke before
   treating the release as operationally ready.

The free release's first-launch recovery is: open System Settings, choose Privacy &
Security, find the blocked DROIDEX notice, choose Open Anyway, and confirm. Do
not advise users to disable Gatekeeper globally.

## Canonical history cannot open or has an incompatible schema

If startup cannot open or validate canonical history, the sidecar stays running
with history reads and writes disabled. It does not publish an empty replacement
catalog. A persistent history banner and an error toast report the failure even
when the renderer connects after startup. After repairing storage, restart
DROIDEX to reopen history.

1. Quit DROIDEX.
2. Back up the history directory, including SQLite WAL/SHM files. The default is
   `~/.factory/droidex`; an explicit `DROIDEX_HISTORY_DIR` selects another location.
3. Check directory access, available disk space, and the reported SQLite error.
   For an incompatible schema or damaged database, use a supported repair or
   restore a known-good backup while DROIDEX is stopped.
4. Restart DROIDEX and confirm history loads.

`session-index.sqlite` contains canonical DROIDEX sessions, child relationships,
metadata, and settings. **Do not delete it as derived state.** Provider transcripts
cannot reconstruct those records. `session-search.sqlite` also retains the last
admitted summaries of owned chats whose transcripts are unavailable. Corruption
fails without deleting search storage. Quit DROIDEX, back it up with its WAL/SHM
files, then repair it or restore a known-good backup; deleting it to force a
rebuild loses summaries that missing transcripts cannot reconstruct.

Missing or inaccessible provider transcripts do not remove previously admitted
owned chats or DROIDEX notices. The catalog retains their DROIDEX titles;
resuming reports an unavailable transcript until the file is accessible again.
A header-only restoration keeps the last admitted summary until a completed
conversation can be read again. Missing files stop search indexing until they
return; delete/archive tombstones remain in renderer storage so retention cannot
make hidden chats reappear.

## Mission Control role model change fails

Changing a worker or validator model applies the model to matching live children and re-arms each child's automatic compaction limit. The parent role-model summary changes only after all matching live children accept the update. Completed children are skipped.

If a live child rejects the change, DROIDEX reports its provider error and a parent-level error asking you to retry. Successfully updated siblings keep their accepted model. Resolve the provider error, then select the requested role model again; the retry reapplies the requested model and publishes the parent preference once all matching live children accept it. Resetting to Default fails immediately if the provider has no effective default model; choose an explicit model instead.

## Verify child navigation without Factory authentication

Run the deterministic local Electron smoke:

```bash
npm run test:smoke:electron-child-sessions
```

The smoke uses the real Electron main process, preload, and built renderer with a local fixture sidecar. It strips `FACTORY_API_KEY` and `DROID_PATH`, makes no Factory/Droid calls, and verifies parent-only left navigation, parent-scoped child rows, isolated agent transcripts in the Subagents pane, long-conversation virtualization, pane expansion, and preservation of the primary chat. Reading an agent must not open or mutate its runtime.

## Verify an authenticated desktop round trip

Run `FACTORY_API_KEY=... npm run test:smoke:electron-droid` with a key supplied securely in your environment, or explicitly reuse your current Droid CLI login:

```bash
DROIDEX_SMOKE_AUTH=cli npm run test:smoke:electron-droid
```

CLI mode requires an existing `droid` sign-in and explicitly uses its current home and keychain. Droid records the smoke sessions in the normal Factory history. Electron app data remains in a private temporary profile. The smoke disables updates, completes onboarding, verifies the authenticated bridge, creates an idle Mission Control runtime, and updates worker and validator models while checking that the primary model and compaction limit remain unchanged. It also requests exactly `E1_OK` from a real chat. It closes the sessions and deletes the temporary app profile on completion or failure. It does not copy or log credentials. API-key mode remains the default, isolates the CLI home too, and fails immediately without `FACTORY_API_KEY`.

## Droid CLI cannot be found

1. Run `droid --version` in the same shell that starts the app.
2. If PATH discovery is not reliable, set `DROID_PATH` in `.env` to the absolute CLI path.
3. Remove stale `DROID_PATH` values if the binary was moved.
4. Re-run sidecar environment tests:
   ```bash
   npm --prefix sidecar run test
   ```

## Factory API key problems

1. Prefer the app onboarding flow for key entry.
2. For local debugging, set `FACTORY_API_KEY` in `.env` or the shell.
3. Do not commit keys or paste them into logs.
4. If child processes still lack credentials, inspect sidecar startup logs and confirm the app is passing an explicit key.

## Build or CI failure

1. Reproduce the failing job locally with the same command listed in `.github/workflows/ci.yml`.
2. For broad changes, run:
   ```bash
   npm run docs:check
   npm run format:check
   npm run typecheck
   npm run sidecar:typecheck
   npm run electron:check
   npm run test
   npm --prefix sidecar run test
   npm run build
   ```
3. Check whether generated docs are stale. If so, run `npm run docs:generate` and commit the generated file.
4. Known baseline: lint blocks CI on new errors only; existing errors are recorded in `eslint-suppressions.json`.
