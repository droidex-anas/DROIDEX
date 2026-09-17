# DROIDEX iOS — device-testing checkpoint

This is the real connected companion, not a scripted preview. Desktop and iOS
must use this branch. Remote protocol remains **3** in this checkpoint.

## Run

From a clean checkout:

```sh
npm ci
npm --prefix sidecar ci
npm run remote:assets
open mobile/ios/Droidex.xcodeproj
npm run electron:dev
```

Use Xcode 27 and an iOS 27 target. Set your signing team for a physical phone.
The Node generator is needed only for the optional, shareable SVG guide; normal
onboarding no longer creates a web view or plays folding-device artwork.

On desktop: **Settings → Remote → choose project → Create pairing QR**.
On iPhone: **Add computer → Scan QR code**, or paste the copied pairing code.
Approve your phone on the computer. Both devices must be on the same trusted
private network. `127.0.0.1` is only for a simulator on the same Mac. Git and
OpenSSL must be available on desktop; `DROIDEX_OPENSSL_PATH` can override OpenSSL.
Read-only pull-request views use the computer's signed-in GitHub CLI.

## What this checkpoint changes

- Remote settings and QR pairing are now in the actual branch, not only ZIPs.
- The production scripted runner, invented model choices, preview route and
  separate New Session sheet are removed. New Session opens an ordinary draft.
- Received conversations, drafts, session changes, independently loaded changes,
  and opened PR reviews are saved locally before reconnecting on next launch.
- Offline screens retain last-known states. They do not claim a running agent
  finished, and working indicators stop animating when disconnected.
- You can write drafts offline. Sending, stopping and approvals require a live
  connection. An unresolved send receipt survives restart and is never replayed
  automatically. Check the computer before explicitly retrying an uncertain send.
- The initial recent-session window no longer erases previously downloaded
  history. Explicit removal events still remove a session from the cache.
- First-run onboarding uses a native illustration of Settings → Remote. The
  shareable SVG guide remains optional help, not a fake live device screen.

## Offline boundaries

The archive contains only content this phone has received. It cannot show an
unopened file, unreceived response or undownloaded PR diff while the PC is off.
File browsing still requires the computer. A loaded working-tree review can
include edits made before the current turn; it is not per-turn attribution.

A per-computer JSON archive is written atomically outside the UI actor, with a
16 MiB cap and iOS file protection. It is excluded from device backup. Provider
keys and the pairing bearer token never enter the archive; credentials stay in
Keychain. Corrupt or mismatched caches are preserved, not silently overwritten.
Forgetting a computer deletes its credential and this phone's cache, including
unsent drafts. It does not undo edits or stop existing desktop work.

The service is private-LAN only. Do not port-forward it. Sharing a workspace is
not an operating-system sandbox; approved actions can consume quota and change
real files. Desktop restart requires pairing again.

## Validation

Swift core tests cover real-content restoration, corrupt-cache preservation,
computer identity, receipt recovery, stale events, history retention, composition
validation and duplicate connection attempts. Run on macOS with:

```sh
cd mobile/ios/DroidexCore
swift test
```

The Linux test host required `-Xlinker --allow-shlib-undefined` for its installed
Observation runtime. Do not add that workaround to the Xcode build.

The two XCUITests exercise unpaired navigation and invalid-code handling, without
starting a paid model or introducing a production demo mode. They have not been
executed here. Prior sample-conversation UI tests were removed with the scripted
runner; they did not test the live product.

**This is not a native-build or performance certification.** Full desktop
compilation, Xcode compilation, actual device visuals, real QR scanning and
provider runs must still be tested. No measured iPhone frame-rate improvement is
claimed. The broader transcript-streaming and visual-polish work remains open.

First device test: pair, open a real conversation and Changes, write an unsent
draft, background the phone, stop the computer, then relaunch. The received chat,
draft and downloaded diff should remain readable; Send must be disabled. Bring
the computer back, pair again if it restarted, and verify a single submitted
prompt appears on both devices. Use a throwaway project for edits.
