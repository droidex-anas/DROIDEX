# Canvas first-turn attachment

Base: `d8eec0f441a69eada6f5316e739af54a7d0c51c0` (`canvas/integration`).
Branch: `thread/canvas-first-turn-attachment`. Node: 22.22.3.

## Design as built

`session.create` carries optional `canvas: { canvasId, name?, mutationId }` in both bridge mirrors. `canvasId: null` creates a board; a saved ID attaches that board. The WebSocket boundary validates the intent with the existing Canvas identifier and name schemas, including normalization and mutation-ID bounds.

The composer captures the Design draft before asynchronous folder preparation, names a new board from the visible prompt, and uses its retained `clientRef` as the durable creation mutation ID. Typed and voice starts, including “New chat with this canvas,” use this same session-create route. `SET_PENDING_COMPOSE` receives that captured draft: navigation cannot retarget a submitted request or let it consume a later draft. Unsent `canvasDraft` and submitted `canvasChatRequests` remain separate owners. Submitted requests store only the chat identity needed to open a pane; their obsolete copied canvas target is removed.

The sidecar entry composes project membership and Canvas preparation through `prepareSessionFirstTurn`. Lifecycle registers the session, awaits those commits, revalidates the live session, emits `session.created`, then admits the first prompt. Canvas creation uses `CanvasWorkspace.createCanvas` and its existing durable replay contract; saved boards use `attach`. Canvas summaries are broadcast after the commit. A failed attachment reaches the existing `session.create_failed` path with the original Canvas error message and releases the provisional provider, MCP resources and registry entry.

The existing `attachedCanvasId` lookup now gives the first turn its committed board. `canvasTurnContext.ts` needs no change. `SessionLifecycle.ts` grows only six lines for the callback type and argument; the composition lives in the Canvas owner.

`CanvasChatBootstrap` now only reads the committed attachment, updates the renderer cache and opens its pane. It has no create/attach operation, provisional naming, owed-operation state or mutation retry branch. Explicit pane creation and attaching an existing chat keep their existing retained mutation/target handling; those are current operations with meaningful lost-reply coverage.

## Test audit and intentional edits

The composition owner suite exercises real SessionManager/Lifecycle creation, real Canvas storage and real turn leases with a controlled provider. It protects attachment-before-publication, the first model create using that same board, saved-board targeting, durable replay, project-hook composition, and failed-open cleanup. The previous Project-only lifecycle seam coverage did not cover this wiring. The existing production callback is the seam; no test-only production API was added.

The Canvas chat owner suite tests the actual renderer sender with new/saved intent and no `canvas.createCanvas`. The bridge owner suite adds malformed-intent boundary coverage. The Design store owner adds the preparation/navigation race; its existing request ownership assertions remain intact.

Named edits to existing tests:

- `a design prompt mints a canvas for its chat, and the next prompt mints another` is renamed `explicit pane creation mints a canvas for its chat, and another chat mints another`: all existing assertions remain; explicit pane creation still owns this contract.
- `new chat with this canvas attaches the named canvas and mints nothing` is renamed `attaching an existing chat uses the named canvas and mints nothing`: all assertions remain. New-session targeting is now covered through `session.create` in the added sender test.
- `callers that join an unfinished create share it instead of minting another`: comments and the local `bootstrap` variable now describe pane actions; the same concurrent and settled-result assertions remain.
- `a provisional canvas name is the prompt, trimmed, or nothing`: the same prompt cases and expected name assertions now exercise the public intent builder. The naming helper stays private; no test-only production export remains.
- Every existing test in `useStoreDesignMode.test.ts` uses the updated `send` fixture, which explicitly supplies its captured draft. The submitted-request assertions now expect only `appSessionId`: the obsolete canvas target is removed from the state contract and is covered at the actual `session.create` sender and first-lease boundary. Full request ownership, navigation, failure and settlement assertions remain.
- `a Design home prompt asks for a new canvas and hands it the chat it created` becomes `a Design home send consumes its intent and opens the pane for its own created chat`; its two request-map assertions drop the obsolete `canvasId` field.
- `overlapping design drafts keep their own canvas, whichever reply lands first` becomes `overlapping Design sends open panes for their own chats, whichever reply lands first`; both whole-map assertions retain separate client refs, chat IDs and per-chat settlement, with no copied target.
- `a submitted canvas request survives navigation and the next draft` retains all navigation and request identity assertions; its named request has only `appSessionId`.
- `new chat with this canvas attaches the same canvas; an ordinary new chat attaches none` becomes `new chat with this canvas requests its pane; an ordinary new chat requests none`; the existing whole-request and ordinary-chat assertions use the new pane-only contract. Saved target transmission is asserted in the sender test.
- `a deleted chat cannot leave an attachment waiting for it` becomes `a deleted chat cannot leave a pane request waiting for it`; its deletion assertion is unchanged.
- `bridgeServer.test.ts` adds one boundary test without changing existing assertions. `sessionManagerTestContext.ts` passes the existing production `beforeFirstTurn` option through to the integration harness.

No tests were deleted or newly skipped. Assertion edits are limited to the intentionally removed submitted-request target field; no remaining behavior assertion was weakened. No held-out regression source was inspected or changed. The largest touched suite has 694 physical lines, below the 800 counted-line cap.

Touched TypeScript totals, counting physical lines: production 16,026 → 16,081 (+55); tests/support 1,706 → 1,957 (+251). Existing explicit-create replay, concurrent caller, retargeting and current-attachment tests are retained because they still protect current pane behavior. This was an authoring audit, not a suite-pruning or baseline-coverage audit.

## Verification

All validation commands used Node 22.22.3. Sidecar tests ran serially with `--test-concurrency=1`. Logs were kept in `/tmp/canvas-first-turn-*.log` and `/tmp/canvas-first-turn-validation/` during this thread.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm install` | 0 | Root dependencies installed; lockfile unchanged. |
| `npm ci --prefix sidecar` | 0 | Sidecar dependencies installed; lockfile unchanged. |
| `npm run typecheck` | 0 | Final renderer check. |
| `npm run sidecar:typecheck` | 0 | Final sidecar check; initial exit 2 (TS7022/TS7023) fixed by declaring the composition callback’s `Promise<void>` return type. |
| `npm run electron:check` | 0 | Final Electron check. |
| Focused sidecar command below | 0 | 111 passed, no failures or skips. |
| Focused renderer command below | 0 | 37 passed, no failures or skips. |
| `node --import tsx --import ./src/testing/isolatedTestEnv.ts --test --test-concurrency=1 --test-reporter=spec "src/**/*.test.ts"` (from `sidecar/`) | 0 | 1,125 passed, 2 existing skips, no failures. |
| `npm run test` | 0 | Initial full run: 1,245 renderer/tool tests and 284 Electron tests passed. Subsequent full run: 1,246 renderer/tool tests and 284 Electron tests passed. Delivery-state rerun also exited **0**: 1,246 renderer/tool tests and 284 Electron tests passed. A final mechanical removal of a test-only naming export was verified again in the focused suite; the naming function body is unchanged. |
| `npm run lint` | 0 | Final run: zero errors; 351 warnings in the final tree; no suppressions added. Initial run exited 1 on two `prefer-const` errors in the new integration test; fixed without suppressions. |
| `npm run format:check` | 0 | Final run passed after an intermediate exit 1 flagged the narrowed App predicate; Prettier changed only that wrapping. |
| `npm run docs:check` | 0 | Architecture update passed. |
| `npm run build` | 0 | Final production build passed. |
| `npm run quality:bundle-budgets` | 0 | All unchanged budgets and duplicate-dependency gate passed. |
| `./node_modules/.bin/playwright test --config=playwright.canvas-smoke.config.ts` | 0 | Final built-app run: all 17 passed; earlier run also passed all 17. |
| `git diff --check` | 0 | No whitespace errors. |
| `npm run quality:test-edits -- d8eec0f44` | 0 | Committed-head advisory flags the named Canvas chat and Design store test edits; explanations are above. |
| `git commit -m "Attach Design canvases before the first turn"` | 0 | Husky lint-staged, file-size, tech-debt, renderer/sidecar typechecks and Electron checks all passed. |

Focused commands (sidecar command runs from `sidecar/`):

```sh
node --import tsx --import ./src/testing/isolatedTestEnv.ts --test --test-concurrency=1 --test-reporter=spec src/SessionLifecycle.test.ts src/bridgeServer.test.ts src/canvas/CanvasWorkspace.test.ts src/canvas/canvasSessionCreate.test.ts src/canvas/canvasTurnContext.test.ts src/canvas/schema.test.ts
node --import tsx --test --test-reporter=spec src/components/PromptInput.test.ts src/features/canvas/canvasChats.test.ts src/features/canvas/openCanvasPane.test.ts src/hooks/useStoreDesignMode.test.ts src/lib/commands.test.ts src/lib/lazySurfaces.test.ts
```

The sidecar owner checks cover the lifecycle, bridge boundary, Canvas storage, wire mirrors/schema, turn leases and project-hook composition through the existing session-manager harness. The renderer owner checks cover the sender, composer, Design request ownership, pane opening and lazy App integration.

The full sidecar command above is the required non-held-out serial run. An additional serial CI coverage run also executed the held-out suite without reading its source:

```sh
node --import tsx --import ./src/testing/isolatedTestEnv.ts --test --test-concurrency=1 --experimental-test-coverage --test-coverage-lines=74 --test-coverage-branches=69 --test-coverage-functions=56 --test-reporter=spec "src/**/*.test.ts" "regression/**/*.test.ts"
```

That extra run exited **1**: 1,161 passed, 2 existing skips, and the unchanged `historyPersistenceWorker.test.ts` test `a persistence timeout fails every outstanding call and recreates the worker without a caller waiting` hit its 2,000 ms rejection deadline. Coverage passed all floors: **96.43% lines / 88.16% branches / 88.80% functions**. A focused serial worker rerun exited **1** with three unchanged worker deadline failures (9 passed / 3 failed): the persistence timeout above, `a locked derived search database cannot delay canonical durability` (3,000 ms), and `an asynchronous worker timeout lets the queue retry without a caller waiting` (2,000 ms). The host load average was about 29 during that rerun. These failures are recorded as unresolved environmental verification limits; no test or worker source was changed to hide them.

Renderer CI has a generated-output sensitivity: its existing A/B probe conditionally launches `sidecar/dist/sidecar.mjs`, and Node coverage then counts the generated sidecar chunks. The initial post-build `npm run test:ci` exited **1** despite all 1,246 tests passing: **66.60% lines / 82.37% branches / 52.63% functions**, below the line/function floors. A separate base archive at `d8eec0f44` (excluding held-out source) reproduced that after `npm run build` (exit **0**): base `npm run test:ci` exited **1**, all 1,244 tests passed, coverage **66.60% / 82.49% / 52.62%**. Before building, that same base CI command exited **0** with **84.67% / 84.94% / 77.06%**.

The final current-tree renderer CI rerun uses the normal pre-build state: only this worktree's generated `sidecar/dist` is temporarily moved outside the checkout and restored in `finally`; tracked source, tests, assertions and thresholds are untouched. That CI rerun exited **0**: all 1,246 tests passed, coverage **84.69% lines / 84.99% branches / 77.13% functions**, above all floors and above the pre-build base. After removing the obsolete pane-request target, the delivery-state CI rerun also exited **0** with all 1,246 tests passing and **84.76% / 85.00% / 77.13%** coverage. The final full `npm run test` runs in that same pre-build state before the built output is restored. No coverage floor was changed.

## Bundle

Final rebuilt initial renderer JavaScript: **1,441,752 B**, +445 B from the provided base measurement of 1,441,307 B, leaving **248 B** under the unchanged 1,442,000 B budget. CSS: 102,713 B / 103,200 B. Largest lazy chunk: 691,095 B / 700,000 B. Duplicate dependency scan passes. No bundle budget was changed. The naming/intent helper is kept separate from the lazy pane attachment owner. Removing the obsolete pane-request target saved 54 B from the first implementation build (1,441,806 B).

## Live check

The isolated Electron app used this worktree's production build, a fresh scratch `DROIDEX_USER_DATA_DIR`, and the real Codex provider. A Design-home prompt asked the model to inspect its scope and create one 320 × 200 frame. The bridge capture and stored manifest prove:

- `session.create` sent `canvasId: null` with renderer mutation ID `c-muz3dzuj-0`.
- The renderer issued **zero** `canvas.createCanvas` commands.
- Exactly one canvas exists: `242180ff-bd5a-4fe7-bff3-a3d8473dea72`.
- The pane's `canvas.subscribe` targeted that same ID.
- The model's first `canvas_create` completed on it and produced design `87794361-9c04-4e0e-896c-8a96b9087f67`, named `First turn attachment check`, at 320 × 200.

The live Electron probe saved these behavioral results before trying to capture a screenshot. Its exit was **1** because screenshot capture timed out after the app window had been hidden. Independent assertions against the saved bridge/manifest/activity evidence exited **0**. No final screenshot is claimed. Earlier probes exited **1**: the initial default-provider run did not establish the requested frame, and a provider-menu selection attempt timed out before sending. The final corrected attempt explicitly selected Codex before sending.

The scratch profile is `/var/folders/ct/8ql33dxn0z947_4wt925w72w0000gn/T/canvas-first-turn-live-tpopYo/profile`. The app was closed after the check. The subsequent cleanup removes only unused pane-request target metadata; the intent, pre-turn attachment, model lease and pane read paths checked live are unchanged. The final smoke suite exercises the rebuilt renderer after that cleanup. The installed application and its profile were not updated. The final head hash is delivered with the thread report; no push is performed.

The test-edit advisory reports `canvasChats.test.ts`: 20 removed lines, 5 on assertion lines (the same name expectations now use the public builder); `useStoreDesignMode.test.ts`: 13 removed lines, none on an assertion line (obsolete copied-target properties and names). The intentional changes are named above. The report-only amendment also runs through Husky.
