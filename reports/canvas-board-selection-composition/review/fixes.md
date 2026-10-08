# Canvas board scoped review fixes

Base: `0badb5ef908b9e7216257cdd9988e5606fa8cf87`, branch
`thread/canvas-board-selection-composition`. The three P2 findings are fixed in
one coherent renderer change. No merge, rebase, push, dependency change, budget
change, or edits to sidecar source, App.tsx, or useStore.tsx.

## Reproductions and fixes

The before/after Chromium probe bundled the production CanvasBoard, DesignFrame,
DesignPreview and previewRuntime with esbuild, on a secure intercepted local
origin. It rendered a real building frame, controlled the artifact read, and
supplied a webview element fake that echoed the actual instance identity and
withheld the real pull channel's ready event. Both authoritative probe runs
exited 0 with zero page errors. It did not replace renderPreview with null.

| Finding | Before at task HEAD | After |
| --- | --- | --- |
| Header and overlay double-click | Both remained Select, selected `[a]`, interacted null. | Both enter Interact, selected `[a]`, interacted `a`; no arrange write. |
| Escape from Interact control | Remained Interact without refocusing. | Returns to Select, retaining `[a]`; input and contenteditable shortcuts remain isolated. |
| Building slot / ready fade | `bloom=false`, static Building placard=true, ready fade=true at allocation. Mounting guest already opaque. | `bloom=true`, static placard=false, fade=false; artifact loading remains honest; mounting guest opacity 0 with no transition, actual ready event reveals it with 120 ms crossfade. Reduced motion has no bloom animation or fade duration. |

1. **Click recognition and real drags.** useBoardGestures waits for four
   board-local pixels of movement before capturing a frame press on the root.
   Clicks retain the actual header/overlay target. Window pointer movement and
   release remain hook-owned so an uncaptured press leaving the board cannot
   strand a gesture. A captured drag still follows the full origin delta, is
   coalesced once per animation frame, and commits through the original CAS owner.

2. **Owned exit.** Escape reaches mode/selection from any board-owned control,
   while inputs, contenteditable elements and textboxes keep their shortcuts.
   Gesture cancellation still consumes its Escape before mode changes. The
   interacted frame offers a visible, native keyboard button, “Return to Select”,
   following the guest in tab order; activation retains selection and focuses
   the board. It sits below the preview so headers retain their full drag target
   at low zoom. Guest Escape continues to belong to the guest, including its
   inputs/dialogs; Tab supplies the renderer-owned exit boundary.

3. **Build and guest readiness.** Queued/building frames retain their own bloom
   and do not mount a preview subtree. Ready builds and failure placards claim
   the four slots; initial failures retain their diagnostic text and failed
   revisions retain the named older working preview. PreviewGuestFrame owns the
   crossfade from its actual runtime phase, over its loading placard, with no
   timer or artificial delay. The allocation-time PreviewSlot fade is deleted.
   Slot selection is derived during render, retaining the existing priority and
   release policy. Workspace mode reset also occurs during render when the
   watched canvas changes. False ownership and touched task-handoff banners are
   removed.

## Native and preservation evidence

The isolated Electron probe uses the existing withCanvasHost fixture, production
main/preload, real compiler artifact, real DesignPreview and a real webview. Main
confirmed guest 2 held focus. Normal Tab reached Return to Select; Enter produced
`{mode: select, selectedFrameIds: [a], interactedFrameId: null}` with Design board
focused. One guest remained attached across the mode round trip. Light and dark
board chrome were inspected from actual screenshots.

Final native probe after moving the return button below the preview: exit 0,
with the same focused-guest/tab/selection/retention result. Both final screenshots
show the working counter at Clicks 1 and the quiet return control in light/dark.

All 13 retained board smoke cases passed, including Space/window and external
focus cleanup, Escape-cancelled re-drag, per-frame CAS holds, obsolete refusal
suppression, pointer anchoring and wheel units, Fit's quiet-window suppression,
control shortcut isolation, four-slot retention and the compositor overlay flip.
The full native smoke also passed guest sandbox/termination, image capture,
artifact recovery and arrange-without-remount contracts. Native input and guest
identity did not require a bridge/protocol change. The independent review's P3
sidecar file-cap/reconciliation item remains outside this pass.

## Named test edits

- CanvasBoard.test.ts: replaced its null renderPreview stub with production
  DesignPreview and an artifact-reader fake; retained every existing assertion.
  Extended “a frame with nothing built shows its real stage and never invents
  one” to protect initial-failure diagnostics. Added “a slot with a building
  preview retains the bloom until a working revision exists”, exercising real
  DesignFrame + DesignPreview. This failed on pre-fix code at the bloom assertion.
- DesignPreview.test.ts: “a zoomed preview submits its untransformed layout
  viewport for capture” supplies the new motion import in its existing VM
  fixture. Its capture assertions are unchanged.
- electronCanvasBoard.smoke.spec.ts: **“Interact gives the pointer to the
  preview and two Escapes undo mode then selection” removes the header refocus
  before Escape**. It failed before the fix at the expected Select assertion.
  No existing assertion was weakened or removed.
- New smoke cases: “double-clicking a header or Select overlay enters Interact
  without arranging”; “Escape on the mode control exits Interact and the frame
  offers a keyboard return”; “a building slot blooms and only a ready guest
  crossfades, with reduced motion immediate”. The first two failed before the
  fix at their expected mode assertions. The readiness case uses the production
  preview/runtime with a controlled webview transport; its fake does not implement
  the crossfade. CSS completion uses a browser assertion, not a unit-test sleep.
- CanvasBoardHarness.tsx: default preview fixtures are ready builds; a building
  fixture can publish readiness, and its guest option renders actual DesignPreview.

Test-audit authoring gate: these protect uncovered browser targeting, focused
exit/editor isolation, and pending-to-ready presentation. The old SSR null stub
and header-refocus smoke hid them. They use existing production boundaries and
runners, with no test-only production exports. No tests were deleted or skipped.
Production files: 1,727 → 1,774 physical lines across the five changed owners;
tests/support: 976 → 1,187 across four changed files. Every changed production
file is below 500 lines; the board smoke is below its 800 counted-line cap.

## Commands and actual results

Commands used Node 22.22.3 after
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`; shell commands ran through RTK.
Repeated attempts are included below rather than relabelled as green.

| Command / context | Exit | Actual result |
| --- | --- | --- |
| `node --version` | 0 | v22.22.3 |
| Initial Chromium probe on about:blank | 0 | Logged unavailable crypto.randomUUID; rerun on a secure intercepted origin supplied the authoritative zero-error baseline. |
| Chromium production probe, before and after (temporary `.mjs`) | 0 / 0 | Evidence above; final rerun also 0. |
| `node --import tsx --test src/features/canvas/CanvasBoard.test.ts`, before fix | 1 | 6 pass, bloom regression fails as intended. |
| Board smoke grep for double-click, mode-control Escape and the edited Interact smoke, before fix | 1 | All 3 fail at the reported mode assertions. |
| `npm run typecheck`, first implementation | 2 | Removed pointerId argument was unused; corrected its signature. |
| `npm run typecheck`, corrected implementation | 0 | Passed. Husky repeats it for the commit. |
| Focused CanvasBoard.test.ts + DesignPreview.test.ts, `node --import tsx --test --test-reporter=spec` | 0 | 11 pass; both focused runs passed. |
| `node --import tsx --test --test-reporter=spec 'src/features/canvas/*.test.ts'` | 0 | 102 pass. Existing Canvas reload-timeout diagnostic remains. |
| Same Canvas suites with `--test-concurrency=1`, after failure-placard preservation | 0 | 102 pass, including the added initial-failure diagnostic assertion. |
| `npm run lint`, initial / final | 1 / 0 | One shorthand void-handler lint error corrected; final 0 errors / 350 baseline warnings. |
| Focused eslint on all changed code/test files | 0 | 0 errors; harness TSX has the existing no-matching-config warning. |
| `npm run format:check` | 0 | All three runs passed. Changed files also formatted with Prettier (exit 0). |
| `npm run build` | 0 | Both runs passed renderer, sidecar builds and Electron syntax checks. |
| `npm run quality:bundle-budgets` | 1 | Both runs: entry JS 1,434,314 B, 314 B over 1,434,000. Exactly 0 B growth from task HEAD. CSS 101,229 B, unchanged and under 101,500. Budget untouched. |
| Board smoke file, first post-fix run | 1 | 15 pass; readiness test used the JS clock for CSS completion. Corrected to browser CSS assertion. |
| `./node_modules/.bin/playwright test --config=playwright.canvas-smoke.config.ts` | 0 | 32 pass, including all 16 board cases and real Electron guest suites. |
| Board smoke grep for the four changed contracts after moving the exit below the preview | 0 | 4 pass. |
| Native probe first `.ts` attempt | 1 | Temporary probe was outside an ESM package; renamed `.mts`. |
| Native probe using guest.sendInputEvent for Tab | 1 | Probe did not traverse the renderer boundary; normal page keyboard Tab succeeded. |
| Native `.mts` probe using normal keyboard input | 0 | Two successful runs: real focused guest → Tab → return button → Enter → Select; guest retained. |
| Final native `.mts` probe after footer placement, run alone | 0 | Same focused guest → Tab → return → Enter → Select; guest retained; both final screenshots inspected. |
| Native probe while clean CI was saturating the machine | 1 | Existing host-ready fixture deadline (3 s) expired; no production change to the deadline. |
| `npm run test:ci`, built task checkout | 1 | 1,233 pass / 0 fail, but coverage 68.12% lines / 82.64% branches / 53.36% functions; generated sidecar/dist bundles appeared in coverage. |
| `npm run test:ci`, clean-artifact baseline 0badb5ef9 | 0 | 1,232 pass / 0 fail; 84.65% lines / 85.16% branches / 76.60% functions. |
| `npm run test:ci`, same clean validation checkout with the exact 9 changed files copied in | 0 | 1,233 pass / 0 fail; 84.66% lines / 85.16% branches / 76.55% functions, above every unchanged floor. |
| `git diff --check` | 0 | Passed. |
| `npm run quality:test-edits -- 0badb5ef9` | 0 | Committed comparison flags one removed non-assertion line each in CanvasBoard.test.ts (null preview stub) and electronCanvasBoard.smoke.spec.ts (header refocus). Both intended edits are named above; zero assertion removals or skip additions. |
| Explicit `git add` for the ignored report, without / with `-f` | 1 / 0 | Ordinary add reports the ignored directory; the user-requested evidence file is force-staged. |
| Husky commit | 0 | ESLint/Prettier tasks, file-size, tech-debt, renderer/sidecar typechecks and Electron checks completed. All existing hooks remain enabled; lint-staged uses its supported --no-stash flag via a temporary npm script shell. The shell only adds that flag to the existing lint-staged command and delegates every other command unchanged. lint-staged's automatic re-staging reports the ignored reports directory even for this indexed path; the requested report is explicitly force-staged and present in the commit. The report amendment uses the same hooks. |

The clean baseline and fixed-source CI use an owned detached temporary checkout
with the same dependencies and no generated runtime bundles. No coverage threshold
was reduced. The built-checkout coverage result is recorded explicitly; avoid
mixing generated runtime coverage with renderer source coverage when reproducing
CI. The owned temporary validation checkout and probes were removed after recording
the final evidence. The unchanged entry budget failure remains an integration
follow-up; this pass does not resolve it.
