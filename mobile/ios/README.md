# DROIDEX iOS companion — connected local MVP

Native SwiftUI companion for iOS/iPadOS 27. Desktop and phone must run this branch;
remote protocol 3 is not compatible with an older desktop release. The explicit
**Explore offline preview** route is a separate demo; live errors never substitute
scripted output.

## Pair with QR or copy/paste

On the computer, from the repository root:

```sh
git fetch origin
git switch feat/droidex-ios27-mvp
git pull --ff-only
npm ci
npm --prefix sidecar ci
npm run electron:dev
```

Sign in through the desktop's usual Droid setup. Open **Settings → Remote**.
The current project is preselected when available; otherwise choose a project.
Select **Create pairing QR**, review the native consent, then scan the QR on the
phone. A private LAN address is selected by default. Network selection remains
available for multiple interfaces. Use `127.0.0.1` only for the iOS simulator on
that same Mac, not a physical phone.

On the Mac, generate the bundled artwork, then open the checked-in project:

```sh
node packages/remote-artwork/generate.mjs
open mobile/ios/Droidex.xcodeproj
```

The desktop dev/build scripts generate these assets automatically. For iOS-only
work, run the generator before opening Xcode. Node is a development-time
requirement only; the bundled artwork makes no network requests.

Use Xcode 27, select **Droidex**, and run on an iOS 27 simulator or signed physical
iPhone. Choose **Add computer → Scan QR code**. Alternatively, click **Copy pairing
code** on the desktop and **Paste** on the phone, or paste into the field and press
**Connect with code**. Scanning and pasting use the same authenticated payload.
Approve the identified phone on the computer. Both devices show their actual
connection state; the mobile inbox appears before model/history discovery ends.

The QR lasts three minutes. **New code** renews an unused/expired ticket without
restarting the listener. A paired device must be disconnected before replacing
it. **File → Connect phone…** remains an alternative desktop QR window. On mobile,
**Settings → Remote** provides pairing, reconnect, and forget-computer controls.

Both devices need the same trusted private network. Allow the iOS local-network
prompt and camera permission for scanning. The simulator/unsupported devices have
paste fallback. Git is needed for diff review. Temporary TLS certificates still
require OpenSSL on the desktop PATH, or `DROIDEX_OPENSSL_PATH` pointing to it; this
build does not install prerequisites silently.

## What is real, and what is intentionally bounded

- One explicitly shared project per connection. The initial inbox imports its
  five most recent desktop chat sessions, with canonical state and original
  backend identities. New sessions and live updates are mirrored. This is not an
  all-computer project catalog or a complete historical archive.
- Session summaries arrive before transcripts. Opening a session requests its
  recent 200-event history; concurrent live updates cannot be overwritten by an
  older response. A partial-history notice identifies omitted scrollback.
- **Files** opens directories on demand (100 entries per page); text previews are
  limited to 64 KiB. Binary files, symlinks, common credentials and dependency/Git
  internals are omitted. It is read-only browsing, not a remote file editor.
- **Activity** shows real timestamps, phases and reported operations. Motion is
  reserved for actual running work and respects Reduce Motion / backgrounding.
- Live models and exact supported reasoning levels come from the desktop catalog.
  Unsupported levels are rejected server-side. Models without reported effort
  controls have no slider. Existing session settings follow the desktop unless
  the phone has an explicit unsent configuration draft.
- The live harness is **Droid/Factory**. Claude Code and Codex are not connected
  runtimes in this build. Provider credentials and execution remain on desktop.
- Sending to an existing conversation resumes/sends to that original session,
  never a duplicate. Follow-up prompts are echoed to the normal desktop bridge
  before generation. New sessions use the desktop's existing opening-prompt
  event. Mobile sends do not steal focus from another desktop conversation.
- Real approvals, provider questions, Stop, follow-ups and working-tree diffs are
  supported. Diffs can include pre-existing edits, not only this turn's changes.
- Locking the phone detaches its stream, not the desktop agent. Reopening restores
  authoritative state. Uncertain sends are not automatically replayed.

## Security and lifecycle

The normal desktop bridge stays loopback-only. The LAN HTTPS listener starts only
after explicit native consent. Pairing uses a single-use 256-bit ticket, manual
desktop approval, and exact certificate fingerprint pinning. QR encoding is local;
no external QR service receives the ticket. Redirects are rejected. A separate
bearer credential is stored in device-only Keychain; provider secrets never leave
the computer. The desktop Settings IPC accepts only the trusted main renderer.

Autonomy is explicitly `off`; approving an action can still modify real files,
execute commands, or consume paid quota. The shared folder is a starting directory,
not an OS sandbox. Test on a throwaway Git repository first. File preview exclusions
are not a guarantee that arbitrary project files contain no sensitive information.

Disable Remote to revoke access and close sessions created by the phone. Sessions
originally created on desktop remain running. Explicitly closing a session from the
phone is a separate confirmed action. Neither operation undoes edits. Forgetting a
computer deletes the phone credential only. Restarting the desktop requires pairing
again. No public relay, port forwarding, background iOS service, push notifications,
or multi-computer switching is included.

## Validation

From the repository root, with dependencies installed:

```sh
npm run remote:assets
node packages/remote-artwork/generate.mjs --check
node --test packages/remote-artwork/artwork.test.mjs
npm run sidecar:typecheck
npm run sidecar:build
node --import tsx --test sidecar/src/remote/*.test.ts
node --test electron/applicationMenu.test.cjs electron/mobile/remoteSettings.test.cjs
swift test --package-path mobile/ios/DroidexCore
xcodebuild -project mobile/ios/Droidex.xcodeproj -scheme Droidex \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Run the `DroidexUITests` target on an available iOS 27 simulator in Xcode. The new
Add-computer test launches `--pairing-ui-testing`, which deliberately ignores saved
Keychain credentials. `--ui-testing` runs the explicit offline example suite. Six authored UI
checks cover New Session/Plan navigation, stop, review/approval, nested activity,
Add computer hit testing, invalid-code errors, and Settings → Remote → pairing. They do not automate camera authorization or a live
provider account.

In the implementation environment: **33 Swift core tests, 31 sidecar remote tests,
seven Electron/menu tests, and eight artwork tests passed**. The sidecar tests use the real HTTPS
listener and transport with a simulated provider runtime. Swift app syntax parsing,
JavaScript syntax and resource-format checks passed.

Environment qualification: Linux Swift's installed Observation runtime required
`-Xlinker --allow-shlib-undefined` for tests; that diagnostic flag is not in the
project settings. Sidecar test files were transpiled with the available TypeScript
compiler and executed with Node 22 because repository dependencies could not be
installed here. This is not a full TypeScript typecheck or desktop build.

**No native iOS compilation, simulator launch, UI-test execution, physical-camera
scan, or authenticated model run was performed in this environment.** Validate the
complete desktop build and Xcode build before promoting the draft PR.

Manual checks: camera denied/unavailable, direct Paste, Add computer's full hit area,
expired QR and New code, desktop decline/approve, incorrect certificate, foreground
reconnect, actual models/efforts, five real sessions, opening history during a run,
follow-up echo on desktop, concurrent approvals, Stop, desktop-originated turns,
revocation while creating a session, and project-file traversal/symlink rejection.
Check compact iPhone/landscape/iPad, Dynamic Type, VoiceOver and device haptics.

## Conversation and review behavior

The app wordmark uses the exact Silkscreen Regular outlines, including the desktop
tracking, as a fixed vector mark. No font download is required. The interface
still uses the system text font; monospace is reserved for code.

Messages render a deliberately bounded Markdown subset: headings, paragraphs,
quotes, ordered/unordered/task lists, fenced code (including an unfinished
streaming fence), and pipe tables, with native inline emphasis/code/links. This is
not a complete CommonMark/GFM parser or a syntax highlighter. Remote images and
HTML are not fetched/executed. Block parsing runs in a shared worker actor,
unchanged blocks keep stable identities, and token bursts are coalesced.

New Session validates configuration before inserting a session, then shows
Sending / Accepted until an authoritative desktop receipt with the same request
ID arrives. Rejected sends retain the draft. A transport failure after a stream
receipt does not falsely fail the turn. An unconfirmed send is never repeated
automatically. Check the desktop before choosing to retry it.

Scrolling follows the bottom while you are there, stops following when you drag
into history, and offers Jump to latest. It does not issue a scroll command for
every token. Activity disclosures show the reported thinking, tool arguments,
results and state. Shimmer is local to active labels, capped at 30 frames/second,
and disabled in the background and with Reduce Motion. These implementation
limits are not a measured frame-rate or memory guarantee on an iPhone.

**Changes** is always available in the inbox and conversation toolbar. It reads
the shared project's working tree independently of turn completion; previous
changes are retained during the next turn. File sections have actual hunk headers
and old/new line numbers. Large reviews are bounded and marked partial, and
private paths excluded by the file browser are excluded here too. This view
neither applies edits nor attributes all existing edits to the current turn.

**Pull requests** is read-only. It requires GitHub CLI (`gh`) already installed and
authenticated on the computer for this repository. It lists up to 20 open PRs and
loads a selected PR's body, branches and diff. It never checks out, merges, posts a
review, or changes authentication. Missing CLI/authentication and unavailable
diffs are explicit errors, not synthetic content. PR response/diff sizes are
bounded; omitted sections require review on GitHub.

Spec/Plan approval renders the provider's plan as Markdown and offers the full
plan before **Approve plan & build**. That control sends the original permission
request to the desktop; the normal desktop runtime owns the transition to Build.
It is not a local mode toggle or an approval bypass.

Before releasing this refinement, run the native build and UI tests above; check
New Session with the keyboard open, back navigation on iPhone and iPad, streaming
while scrolled into history, nested disclosures, complete permission details,
PR auth errors, large diffs, and a real Plan → approval → Build turn. Component
tests with a simulated provider are not an authenticated end-to-end app test.
