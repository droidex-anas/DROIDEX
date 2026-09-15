# DROIDEX for iOS

A native SwiftUI interaction MVP for **iOS / iPadOS 27**. This is a standalone
preview, not a wrapper around the Electron renderer. It starts with local sample
sessions so the interface can be explored without a server, account, or API key.

**The agent is simulated.** Requests are stored locally and answered by a scripted
stream. Harness choices demonstrate configuration; they do not connect to Droid,
Claude Code, or Codex. The sample diffs and approval buttons never read, execute,
or modify repository files. There is no desktop pairing, GitHub connection,
terminal, remote model inference, microphone recording, or background agent.

## Run it

Use Xcode 27 with an installed iOS 27 simulator runtime. The checked-in project
needs no XcodeGen, CocoaPods, npm install, or external Swift packages.

From the repository root:

```sh
open mobile/ios/Droidex.xcodeproj
```

Select the **Droidex** scheme, choose an iPhone or iPad simulator, and press
**Command-R**. For a physical iOS 27 device, select your signing team in the app's
Signing & Capabilities panel and use your own bundle identifier as needed.
Simulator builds do not require a paid developer membership.

Start with **Refine the mobile composer**. Open **Review changes**, inspect the
sample patch, and approve or decline it. Then use the floating **New session**
control. Build mode demonstrates an approval; Plan mode completes a proposal.
Send a follow-up, stop a response, change the theme, or reopen the app to check
saved sessions. Harness and mode can change only when a session is not working
or waiting for approval.

## Design choices

The reference recording informed the inbox, status counts, session rows,
conversation rhythm, disclosure-based steps, diff review, and floating composer.
Dark colors mirror `src/index.css`: near-black canvas, two quiet surface levels,
neutral primary actions, and semantic color for attention and diff counts.

System fonts carry the interface; fixed-width type appears only in code diffs.
The wordmark is a small vector pixel treatment, without bundling a custom font.
The app icon reuses the block geometry and colors from
`assets/brand/icon-dark.svg`, on an opaque square canvas for iOS to mask.

Native navigation, menus, search, and sheets provide system Liquid Glass.
`GlassChrome` applies the actual SwiftUI `glassEffect` API only to floating
controls and the composer, never to message or diff content. Interactive glass
is reserved for buttons. Increased Contrast and Reduce Transparency use an
opaque, outlined surface instead. The jump-to-latest animation respects Reduce
Motion; there are no ambient shimmer loops, animated gradients, or token haptics.

A `NavigationSplitView` adapts between compact navigation and a sidebar/detail
layout. Transcript widths are bounded rather than stretched across an iPad.
Status tiles, session metadata, review summaries, and approval actions reflow at
larger text sizes. The composer follows the safe area and keyboard. Transcript
updates stay pinned only while the reader is near the bottom; older content can
be read without each streamed word pulling the scroll position down.

Haptics distinguish a light send, selection/stop, approval warning, successful
completion, and failure. The setting can disable them. Physical feel still needs
to be evaluated on an iPhone; a simulator is not haptic validation.

## Structure and state ownership

- `DroidexApp/`: native screens, small shared visual primitives, app lifecycle.
- `DroidexCore/`: a dependency-free Swift package with typed sessions, the demo
  event producer, observable session state, atomic persistence, and core tests.
- `DroidexUITests/`: simulator smoke tests for review/approval and start/stop.

`SessionStore` is the main-actor owner of mutable session state. UI identity is
always `appSessionId`; each turn also has a fresh run identity. Stop/delete
invalidate the run before cancellation. Every streamed event checks the current
identity so stale output cannot target a replacement turn. Pending approvals
are session-scoped and single-use, and a stream ending without a terminal event
is a recoverable failure rather than a false success.

`SessionArchive` serializes atomic JSON writes, rejecting older snapshot
revisions. Draft writes are debounced. Backgrounding stops local tasks and flushes
state; an interrupted run restores as stopped, never as a phantom live session.
Malformed or unknown-version archives show an error and are not silently replaced.
Explicit reset requires confirmation.

The archive is `Library/Application Support/DROIDEX/sessions.json` inside the app
sandbox. Theme and haptic preferences use app-only UserDefaults, declared in
`PrivacyInfo.xcprivacy`. There is no analytics or automatic network transmission.
The system share sheet sends text only when the user explicitly chooses to share.
`--ui-testing` uses in-memory sessions and does not reset a user's saved archive.

`AgentClient` is the event-source boundary for a future authenticated desktop
transport. That work must map the canonical protocol in `FRONTEND_SPEC.md`, retain
stable session identities, provide pairing/reconnect/history/approval semantics,
and store credentials in Keychain. Do not expose the desktop sidecar on all
network interfaces just to make this preview connect.

## Validation

Run core tests on a Mac with Swift 6 or newer:

```sh
swift test --package-path mobile/ios/DroidexCore
```

Build the native app without signing:

```sh
xcodebuild -project mobile/ios/Droidex.xcodeproj -scheme Droidex \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath mobile/ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

For UI tests, select an installed iOS 27 simulator in Xcode and press Command-U,
or use its actual identifier (listed by `xcrun simctl list devices available`):

```sh
xcodebuild -project mobile/ios/Droidex.xcodeproj -scheme Droidex \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -derivedDataPath mobile/ios/DerivedData \
  -resultBundlePath mobile/ios/UITests.xcresult test
```

The initial implementation environment had Linux Swift but no Xcode or iOS SDK.
Core checks do not establish that SwiftUI type-checks, that the simulator tests
pass, or that the layout has been visually verified. Run the native checks before
promoting this preview beyond a draft.

Manually review a small iPhone in portrait and landscape, a large iPhone, iPad
split view/resizing, and the largest accessibility text size. Exercise keyboard
show/hide, reading older messages during streaming, light/dark mode, VoiceOver,
Increase Contrast, Reduce Transparency, Reduce Motion, and physical-device haptics.
Check airplane-mode operation, force-quit/relaunch, stop-then-resend, and delete
while working. This is an interaction prototype, not an App Store release.

## Platform references

- [Xcode SDK requirements](https://developer.apple.com/xcode/system-requirements)
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
- [Materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
- [SensoryFeedback](https://developer.apple.com/documentation/swiftui/sensoryfeedback)
- [Required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
