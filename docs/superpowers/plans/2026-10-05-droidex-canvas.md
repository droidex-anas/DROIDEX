# DROIDEX Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, interactive design canvas beside the existing DROIDEX chat, with consistent design systems, source-backed editing and the same tools for every supported harness.

**Architecture:** The sidecar owns canonical source, immutable revisions, layout, attachments and builds. A feature-local renderer board hosts isolated previews and sends typed commands to those same owners. One six-tool local MCP surface gives Droid, Claude Code, Codex and future adapters access without inserting internal instructions into user messages.

**Tech Stack:** Node.js 22, the repository's Electron/React 19/TypeScript stack, existing Tailwind 3, framer-motion, CodeMirror, esbuild and Zod. Use locked versions; review and package any dependency promoted into the runtime.

**Spec:** [DROIDEX Canvas design specification](../specs/2026-10-05-droidex-canvas-design.md). Read it before this plan; it contains both original video links, timestamped observations, product behavior, limits and exclusions.

**Videos:** [V1 — component board and theme selection](</Users/anas/Desktop/Screen Recording 2026-10-05 at 12.10.35 PM.mov>); [V2 — generation, interaction and variants](</Users/anas/Desktop/Screen Recording 2026-10-05 at 12.39.57 PM.mov>). These local recordings are the visual references for implementation, not assets to commit or redistribute.

**Execution:** Work lives in the `droidex-canvas` worktree on the `canvas/integration` branch, cut from `icons/menu-icons` at `1986663486e755a58c83439d35af18f94741a8ff`. Each task is a branch (`canvas/NN-<task>`) and a pull request into `canvas/integration`, merged only after review. Design, UI/UX and performance work and the reviews are routed to the models the user assigns through DROIDEX projects; this plan does not pick them. Checkboxes below are ticked only when the work is done and verified.

## Global Constraints

- Runtime: Node.js 22; existing Electron, React 19, TypeScript, Tailwind 3 and framer-motion toolchains.
- Providers: Factory Droid, Claude Code and Codex must pass the same Canvas contract before release.
- Ownership: the sidecar owns durable Canvas state; renderer state is a projection plus transient interaction state.
- Identity: `canvasId`, `designId`, `revisionId` and revision-scoped `elementId`; never `providerSessionId` as a Canvas owner.
- Source: one canonical React/TypeScript source tree per revision; no parallel editable DOM or design DSL.
- Tool budget: six Canvas MCP tools; no tool per UI button and no second agent runtime.
- Dependencies: no new canvas framework, global harness configuration edits, CDN runtime, per-design dev server or per-design npm install.
- Privacy: internal Canvas guidance and raw Canvas tool payloads must not enter DROIDEX conversation display, searchable history or conversation exports.
- UI: existing `--droid-*` tokens, soft surfaces, working keyboard controls, light/dark verification and reduced-motion support.
- Compatibility: one current contract; no legacy importers, old-PR adapters or silent migrations.
- Scope: implement locally; commits, pushes, PRs, merges and publishing require the user's existing or later authorization.

Preserve unrelated changes. Re-read `AGENTS.md`, `/Users/anas/.codex/RTK.md`, `docs/architecture.md`, scripts and the actual execution branch. Planning inspected `icons/menu-icons` at `1986663486e755a58c83439d35af18f94741a8ff`; `output/` and `tmp/` were already untracked. Do not import the old design-platform PR #69 or reset this checkout. Keep each new production module below 500 lines; extract real owners, not forwarding wrappers. The feature's compiler, board, tool transport and source mapping justify separate modules.

## Review Focus

1. A queued/steered prompt outlives selection or provider replacement: retain the original references and reject stale capability writes, including late async completions. Tests in Tasks 2 and 4.
2. Two chats/editors change one design or source contains repeated/computed JSX: preserve both authors' work and make edit scope explicit. Tests in Tasks 2 and 7.
3. Disk failure or process death occurs between source write and manifest commit: reopening exposes a complete old or new revision, never a partial one. Tests in Task 2.
4. Generated code loops, escapes its resource boundary or floods messages: chat stays usable, privileged APIs remain unreachable and the preview can be terminated. Runtime gate in Task 1; regressions in Task 3.
5. Native provider replay/search/export bypasses live transcript filtering: internal canaries stay absent while identical user-authored text remains visible. Tests in Task 4 for every provider format.

## File ownership and dependency order

Paths marked “new” are proposed. Inspect existing helpers before introducing them. Keep the named responsibilities even if a small helper belongs beside its sole nontrivial caller.

| Owner | Files | Responsibility |
| --- | --- | --- |
| Durable workspace | New `sidecar/src/canvas/{protocol.ts,schema.ts,CanvasWorkspace.ts,canvasFiles.ts}` | DTOs, boundary validation, mutations, CAS, attachments and atomic persistence |
| Build/runtime | New `sidecar/src/canvas/{CanvasBuilds.ts,compiler.ts,compilerWorker.ts}`; new `src/features/canvas/{previewDocument.ts,previewRuntime.ts}` | Worker compilation, allowed imports/assets, preview contract and stale-build rejection |
| Harness access | New `sidecar/src/canvas/{canvasMcpServer.ts,canvasTurnContext.ts,canvasToolPresentation.ts}` | Six schemas, session/turn scope, compact model context and safe transcript projection |
| Design systems | New `sidecar/src/canvas/designSystems.ts`, `sidecar/src/canvas/presets/`; new `src/features/canvas/DesignSystemPicker.tsx` | Versioned kit content and composer selection |
| Board | New `src/features/canvas/{protocol.ts,CanvasWorkspace.tsx,CanvasBoard.tsx,DesignFrame.tsx,DesignPreview.tsx,CanvasToolbar.tsx,CanvasNavigator.tsx,canvasState.ts,canvasGeometry.ts,canvasMotion.ts}` | Projection, gestures, visible previews, selection/navigation and motion |
| Editing/reuse | New `sidecar/src/canvas/{sourceElements.ts,canvasLibrary.ts,canvasExport.ts}`; new `src/features/canvas/{CanvasInspector.tsx,CanvasSourceEditor.tsx,CanvasVariants.tsx}` | Source mapping, direct edits, source/history UI, variants, local reuse and export |
| Existing seams | `src/App.tsx`, utility modules, composer/send/store modules; `sidecar/src/SessionManager.ts`, lifecycle/event/history/provider modules; Electron packaging | Focused wiring only; feature behavior stays with its owner |
| Verification | Focused `*.test.ts` next to the owning modules; `tests/integration/canvas.spec.ts`; `tests/smoke/electronCanvas.smoke.spec.ts`; `playwright.canvas-smoke.config.ts` | Core invariants, actual browser input and actual Electron isolation/packaging |

The frontend may not import sidecar source (`.dependency-cruiser.cjs`). Mirror the small wire DTOs in `src/features/canvas/protocol.ts`, following existing bridge conventions, and assert representative serialized fixtures against both boundaries. Do not add a shared-package framework for this feature.

Dependency order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**. The first user-visible vertical slice is complete at Task 5; Tasks 7–9 are a second wave that starts only after Tasks 5 and 6 are verified in the running app with all three providers; the requested release is complete only after Task 11. If Task 1 rejects the proposed preview host or the turn-lease binding, revise that boundary before its production task, preserving the product and shared-tool contracts.

## Boundary contracts to establish in Task 2

These are proposed names and shapes, not claims about existing exports. Keep schema and types together in meaning; prefer Zod-inferred sidecar input types rather than independently maintained validation interfaces. Model all variants exhaustively.

```ts
type DesignSystemRef = { id: string; version: number; mode: 'light' | 'dark' };
type DesignRef = { designId: string; revisionId: string | null };
type RevisionRef = { designId: string; revisionId: string };
type CanvasSeed =
  | { kind: 'revision'; canvasId: string; revision: RevisionRef }
  | { kind: 'library'; itemId: string };
type ElementRef = { designId: string; revisionId: string; elementId: string; instancePath: string };
type CanvasTurnContext = {
  canvasId: string;
  designs: DesignRef[];
  elements: ElementRef[];
  designSystem: DesignSystemRef;
};
type CanvasScope = {
  scopeId: string;
  appSessionId: string;
  generation: number;
  context: CanvasTurnContext;
  allowedDesignIds: string[] | 'canvas';
};
type FrameRect = { x: number; y: number; width: number; height: number };
type SourceFiles = Record<string, string>;
type CanvasDiagnostic = {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
};
type SourceElement = {
  elementId: string; file: string; start: number; end: number;
  tagName: string; editability: 'literal' | 'computed' | 'shared';
};
type CanvasBuildState =
  | { status: 'pending' }
  | { status: 'building'; revisionId: string; generation: number }
  | { status: 'ready'; revisionId: string; artifactId: string }
  | { status: 'failed'; revisionId: string; diagnostics: CanvasDiagnostic[]; lastWorkingRevisionId: string | null }
  | { status: 'cancelled'; revisionId: string | null };
type CanvasFrame = {
  designId: string;
  name: string;
  rect: FrameRect;
  layoutVersion: number;
  revisionId: string | null;
  designSystem: DesignSystemRef;
  build: CanvasBuildState;
};
type CanvasSnapshot = { canvasId: string; sequence: number; frames: CanvasFrame[] };
type CanvasSummary = { canvasId: string; name: string; updatedAt: number; designCount: number };
type CreateFramesInput = {
  mutationId: string;
  frames: Array<{ name: string; width: number; height: number; designSystem: DesignSystemRef; seed?: CanvasSeed }>;
};
type WriteFilesInput = {
  mutationId: string;
  designId: string;
  expectedRevisionId: string | null;
  files: SourceFiles;
  deletedPaths: string[];
  designSystem?: DesignSystemRef;
};
type ArrangeFramesInput = {
  mutationId: string;
  frames: Array<{ designId: string; expectedLayoutVersion: number; rect: FrameRect }>;
};
type WriteReceipt = { designId: string; revisionId: string; sequence: number };
type CanvasChange = { canvasId: string; sequence: number; frames: CanvasFrame[]; removedDesignIds: string[] };
```

`revisionId: null` means a reserved frame with no source; `RevisionRef` requires actual source. Omitted `WriteFilesInput.designSystem` preserves the revision's system; an explicit value pins the new revision to that system. Add the explicit `assetId`/file selector types in their owning tasks. IDs are opaque strings validated at input; no path concatenation from unchecked IDs. All numeric coordinates must be finite; dimensions are positive and capped at 8192 CSS pixels. A change sequence orders renderer projections; it is not the source CAS token.

## Task 1: Prove the preview host and packaged compiler

**Files:** Inspect `src/components/{AppBlock.tsx,appBlockDocument.ts,appBlockRuntime.ts}`, `electron/{main.cjs,preload.cjs}`, `electron-builder.config.cjs`, `sidecar/package.json`, `.github/workflows/`, `tests/smoke/electronChildSessions.smoke.spec.ts`. Create `tests/smoke/electronCanvas.smoke.spec.ts` and `playwright.canvas-smoke.config.ts`. Own temporary probes outside Git; retain only useful security/runtime regression cases.

**Interfaces:** Consumes the existing Electron launch/profile lifecycle and provider MCP configuration path. Produces a documented decision in spec §6: the one preview-host boundary that passes isolation/recovery, plus the exact compiler/runtime resources required on arm64 and x64. Also proves that each provider can bind Canvas calls to their originating request as required by Task 4. No general-purpose host abstraction or placeholder production API.

- [ ] Use a scratch profile through `DROIDEX_USER_DATA_DIR`, hide test windows where existing harness policy requires it, and ensure app/sidecar/compiler processes are cleaned up in `finally`. Do not point destructive probes at the user's running profile.
- [ ] Compile and execute this complete representative source using locally bundled dependencies; confirm the button changes in the real Electron preview and capture the cold build time and artifact size.

```tsx
import { useState } from 'react';
export default function Hey() {
  const [done, setDone] = useState(false);
  return <button onClick={() => setDone(true)}>{done ? "You're all set" : 'Get started'}</button>;
}
```

- [ ] Probe unavailable imports, network/fetch/WebSocket, parent DOM/bridge, top navigation, workers, message flooding and capture timeout. Then exercise `while (true) {}` and large allocation/DOM cases under an external watchdog. Assert host responsiveness from a separate process; a timeout inside the frozen renderer cannot prove recovery.
- [ ] Use the existing Playwright Electron pattern with this dedicated config; include cleanup assertions for child PIDs. Failure to keep chat and Stop usable blocks the proposed host. Update spec §6 to the one measured replacement before proceeding if required; do not keep both engines.

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/smoke',
  testMatch: 'electronCanvas.smoke.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
```

- [ ] Verify the locked compiler version and its native binary requirements against packaging. Use `sonatype-guide` before selecting/promoting dependencies; its service was unavailable during planning, so no dependency security verdict is implied. Package the compiler worker, correct architecture binary, React/runtime/CSS assets and licensed fonts explicitly. Do not rely on checkout `node_modules` or a CDN.
- [ ] Probe local MCP discovery and the per-session server + turn-lease binding (spec §6) on all three adapters: a delayed call after turn settlement must be refused, a steer during an active call must keep the original lease, and a Droid child calling through the parent's server must land in the parent's scope. Confirm scopes pin without prepending hidden text to a user message or editing global harness settings. For Codex, forward the session's server configs through `thread/start`/`thread/resume` `config.mcp_servers.<name>.url` and confirm its client speaks to the SDK's stateless Streamable HTTP server (`sessionIdGenerator: undefined`, unauthenticated loopback); if it does not, the Canvas server needs its own small stateful transport and this plan records that. This is a transport feasibility gate, not permission to add a second tool surface.
- [ ] Measure the compiler two ways in a sidecar worker thread: native `esbuild` (needs `@esbuild/darwin-arm64` and `-x64` packaged unpacked beside `sidecar/dist`, since the sidecar ships as a self-contained bundle in `extraResources`) and `esbuild-wasm` (no native binary, slower cold start). Run Tailwind 3 JIT over the same fixture in the worker and record its cold and warm cost separately. Record cold build time, warm build time, artifact size and packaged size for each; pick one for Task 3 from the numbers.
- [ ] Run `rtk proxy npx playwright test --config=playwright.canvas-smoke.config.ts` against the probe and retain measured evidence for Task 3. Record pass/fail per architecture; unavailable hardware is unverified, not passed. Review the focused diff; commit only if execution authorization covers commits.

## Task 2: Durable workspace and revision-safe commands

**Files:** Create `sidecar/src/canvas/{protocol.ts,schema.ts,CanvasWorkspace.ts,canvasFiles.ts,CanvasWorkspace.test.ts,canvasFiles.test.ts}` and `src/features/canvas/protocol.ts`. Modify `sidecar/src/{protocol.ts,bridgeServer.ts,droidexPaths.ts}` and `src/types/bridge.ts` at their existing command/event boundaries. There is no current `sidecar/src/schema.ts`; Canvas input validation belongs in the new feature schema and its dispatch boundary. Keep all wire consumers in the same change.

**Interfaces:** `CanvasWorkspace.open(directory: string): Promise<CanvasWorkspace>` loads current state. Instance methods: `snapshot(canvasId: string): CanvasSnapshot`, `create(scope: CanvasScope, input: CreateFramesInput): Promise<CanvasFrame[]>`, `write(scope: CanvasScope, input: WriteFilesInput): Promise<WriteReceipt>`, `arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange>`, `readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles>`, `close(): Promise<void>`. Add `createCanvas(): Promise<CanvasSnapshot>`, `listCanvases(): CanvasSummary[]`, `attach(appSessionId: string, canvasId: string): Promise<void>` and `detach(appSessionId: string): Promise<void>` here; they own explicit attachment persistence. Scope validation is mandatory on mutations; read authorization is enforced at IPC/MCP entry points before calling internal read methods.

- [ ] Define current-schema parsers and mirrored wire DTOs from the contract above. Define `canvas.*` client commands for snapshot/subscription/create/write/arrange/attachment and matching sequenced snapshot/change/error responses. Reuse the bridge's request correlation convention. Validate path traversal, absolute paths, NUL, symlinks, case-colliding file names, file-count/byte limits and finite geometry at this boundary.
- [ ] Implement immutable complete source trees and one atomic manifest pointer. The commit order is: validate scope/CAS → write temporary revision → flush source/metadata → rename revision → revalidate scope/CAS under the serialized workspace commit owner → atomically replace and flush manifest → emit/ack. An expired scope may leave an orphan temporary revision but must never publish it. Never serialize compiler work inside the commit lock.
- [ ] Exercise actual temporary-directory persistence through `open/create/write/readFiles`; keep fixture construction in the owning test file. The regression's critical assertions are:

```ts
const [frame] = await workspace.create(scope, {
  mutationId: 'create-hey',
  frames: [{ name: 'Hey', width: 720, height: 720, designSystem: scope.context.designSystem }],
});
assert.ok(frame);
const input = {
  mutationId: 'write-hey', designId: frame.designId, expectedRevisionId: null,
  files: { 'main.tsx': 'export default function Hey(){return <h1>Hey</h1>}' }, deletedPaths: [],
};
const first = await workspace.write(scope, input);
assert.deepEqual(await workspace.write(scope, input), first);
await assert.rejects(workspace.write(scope, { ...input, mutationId: 'stale-write' }), { code: 'revision_conflict' });
assert.equal((await workspace.readFiles(scope.context.canvasId, first))['main.tsx'], input.files['main.tsx']);
```

- [ ] Add the Review Focus failure cases: reopen after process termination on either side of the manifest rename; write/rename failure leaves the last head intact; rejected writes do not poison mutation IDs; two concurrent writers accept only one source head; layout updates do not conflict with source writes; revoke a scope during an awaited file write and reject publication. Use controlled promises/filesystem fault injection at the real persistence boundary, not sleeps or source-text assertions.
- [ ] Implement renderer sequence handling: ignore older/duplicate changes; request a new snapshot on a gap. UI optimistic geometry may be transient but reconciles to acknowledged layout versions. Retain source/attachments across provider identity changes and detach chat deletion without deleting canvas files.
- [ ] Run `rtk proxy node --import tsx --test sidecar/src/canvas/CanvasWorkspace.test.ts sidecar/src/canvas/canvasFiles.test.ts`, then app/sidecar typechecks and `npm run quality:boundaries` through RTK. Review data-loss and shutdown paths before considering the task complete.

## Task 3: Incremental compiler and isolated live previews

**Files:** Create `sidecar/src/canvas/{CanvasBuilds.ts,compiler.ts,compilerWorker.ts,designSystems.ts,CanvasBuilds.test.ts,compiler.test.ts,designSystems.test.ts}`, the initial `sidecar/src/canvas/presets/droidex.ts`, and `src/features/canvas/{previewDocument.ts,previewRuntime.ts,DesignPreview.tsx}`. Modify `sidecar/package.json`, `electron-builder.config.cjs` and the Task 1 runtime test. Change `electron/main.cjs`/preload only for the proven host's narrow needs; generated code receives no preload.

**Interfaces:** `compileDesign(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign>` lives in the compiler worker. `CompileInput = { designId: string; revisionId: string; generation: number; files: SourceFiles; designSystem: DesignSystemRef }`. `CompiledDesign = { artifactId: string; html: string; diagnostics: CanvasDiagnostic[]; elements: SourceElement[] }` uses the Task 2 element DTO; Task 7 adds the instrumentation that populates it. `CanvasBuilds.enqueue(canvasId: string, receipt: WriteReceipt): void` coalesces per-design jobs; `cancelCanvas(canvasId: string): void` and `close(): Promise<void>` own cancellation/cleanup. `DesignPreview` consumes one frame/artifact and reports bounded preview events, never a provider/session object. Establish the `DesignSystem`, `readDesignSystem` and `saveDesignSystem` contracts specified in Task 6 here so compilation and Task 4 theme tools have a working default kit before the picker and additional presets arrive.

- [ ] Add compile fixtures for working React state, CSS, relative modules, bad TSX, unsupported import and attempts to read outside the virtual tree. Reject undeclared packages, URL imports, Node builtins and filesystem escapes in the resolver. Never invoke generated source in the sidecar process.
- [ ] Implement versioned kit persistence and the initial DROIDEX tokens plus Button/Card primitives using the Task 6 signatures/example. Resolve the pinned `@droidex/design-system` virtual module in the worker now. Test version immutability and a compiled stateful example; Task 6 extends this working owner with the complete presets, picker and image workflow, not a replacement path.
- [ ] Build in a worker with two global slots, per-design coalescing and a 15-second deadline; terminate an overdue worker and release its slot. Save complete source before scheduling. Source submission returns a revision receipt; `canvas_read/inspect` and UI events report the eventual build state without holding a provider tool call open indefinitely.
- [ ] Pin the result to captured identity, revision and generation. The narrow publication predicate is:

```ts
const canPublish = (frame: CanvasFrame, job: CompileInput): boolean =>
  frame.revisionId === job.revisionId &&
  frame.build.status === 'building' &&
  frame.build.generation === job.generation;
```

Also require the owning lifecycle to remain active after each await; this predicate alone does not replace scope checks. Use a controlled compiler promise to finish an older job after a newer one, delete a design mid-build and close/reopen a session mid-build. Assert no stale publication and exactly one settlement/slot release.

- [ ] Keep the last working artifact when a new revision fails; display its revision plus current diagnostics. Persist source and build outcome so restart reconstructs a useful state. Rebuild missing derived artifacts on demand from canonical revisions; this is current-state cache recovery, not compatibility support.
- [ ] Install the proven isolated preview host and bounded event schema. Refuse wrong sender/nonce/design/revision/generation, oversized messages and any privileged request. Test actual component clicks with Playwright, plus spoofed messages and blocked network/navigation with Electron. Use the Task 1 external watchdog for hangs.
- [ ] Add offline packaged-app tests that open a saved design, rebuild it and use its button without checkout dependencies. Run focused compiler/build tests, the Electron Canvas smoke and `rtk proxy npm run build`; verify arm64 and x64 resources. Update generated script documentation if scripts change.

## Task 4: One MCP surface, correct provider routing and clean transcripts

**Files:** Create `sidecar/src/canvas/{canvasMcpServer.ts,canvasTurnContext.ts,canvasToolPresentation.ts,canvasMcpServer.test.ts,canvasTurnContext.test.ts,canvasToolPresentation.test.ts}`. Modify `sidecar/src/{SessionManager.ts,SessionLifecycle.ts,SessionEventFlow.ts,SessionTimeline.ts,timelineTranscripts.ts,sessionTranscriptParser.ts,sessionSearch.ts,protocol.ts}`, `sidecar/src/providers/{session.ts,primaryTurn.ts,ProviderTranscriptFile.ts}`, `sidecar/src/providers/codex/{CodexProvider.ts,codexSession.ts,appServer.ts}`, `src/{types/bridge.ts,lib/promptSend.ts}`, and owning queue/send/steer callers. Extend existing `SessionManager.mcp.test.ts`, race/queued-delivery tests, native-parser tests and `providers/codex/appServer.test.ts`.

**Interfaces:** `CanvasTurnContext` travels beside visible prompt text, never concatenated into it. `beginCanvasTurn(appSessionId: string, generation: number, context: CanvasTurnContext): CanvasScope`, `revokeCanvasScope(scopeId: string): void`, and `getCanvasScope(scopeId: string): CanvasScope` own immutable leases. `createCanvasMcpServer` follows the existing local MCP resource return/close convention; its six schemas call the Task 2 owner. `CanvasActivity = { toolUseId: string; action: 'create' | 'write' | 'inspect' | 'arrange' | 'theme'; designIds: string[]; state: 'running' | 'completed' | 'failed'; message: string }` is the only Canvas tool presentation payload retained in DROIDEX transcripts.

- [ ] Pin selection and system in the send command and every queued prompt representation. Activate a lease only when that request executes. Preserve separate immutable contexts for steering requests instead of overwriting the context of in-flight tools. `canvas_read` returns the appropriate scope reference and bounded context; subsequent mutations must present that scope ID. Dispatch is bound by the per-session server plus the turn generation captured in the lease (spec §6), so a call carrying an old lease, or arriving when no turn is active, is refused with `scope_expired`; do not infer ownership from “latest selected chat.”
- [ ] Register exactly `canvas_read`, `canvas_create`, `canvas_write`, `canvas_inspect`, `canvas_arrange`, `canvas_theme` with strict input schemas and concise descriptions. List metadata cheaply; load compiler/theme content only on demand. The short universal instruction is:

```text
Use the attached canvas and pinned references returned by canvas_read.
Read the selected design system before creating or restyling a design.
Create named frames, submit complete working files, then inspect the result.
Preserve unrelated frames and cite revision IDs when updating existing work.
```

This belongs in tool guidance, never in a fabricated user message. Tool descriptions plus selected-kit content are sufficient; do not build a prompt-pack service.

- [ ] Forward local MCP configuration through Codex create and resume into its app-server thread via the `config` override on `thread/start`/`thread/resume` (`mcp_servers.<name>.url` for the SDK's loopback HTTP servers; stdio configs map to `command`/`args`/`env`). Preserve inherited CLI/account configuration and unrelated MCP servers; nothing touches `~/.codex/config.toml`. Assert no credentials appear in argv or logs. Test reserved-name collision and resource cleanup on startup failure, and extend `providers/codex/appServer.test.ts` with the thread parameters actually sent.
- [ ] Extend each adapter's normalized tool provenance enough to identify the reserved Canvas server and correlated tool-use ID. Project Canvas tool starts/deltas/results before DROIDEX transcript persistence, emission and indexing; suppress raw JSON/source chunks, not just final results. Retain semantic start/completion/error rows and safe target references. Apply the same projector when reading provider-native transcripts and conversation exports after restart.
- [ ] Add a privacy canary using the real event/parser/index/export entry points. The essential assertions, repeated for Droid/Claude/Codex fixtures, are:

```ts
const canary = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
assert.equal(providerPrompt.text, userText);
assert.ok(modelToolResult.includes(canary));
assert.equal(liveTranscriptText.includes(canary), false);
assert.equal(replayedTranscriptText.includes(canary), false);
assert.equal(searchableHistoryText.includes(canary), false);
assert.equal(conversationExportText.includes(canary), false);
assert.ok(userAuthoredCanaryTranscript.includes(canary));
```

These variables are outputs collected by the owning existing harness fixtures, not production convenience exports. Include split tool-argument deltas, failed/cancelled calls, native-file replay and an assistant tool error that embeds a raw result. Do not assert that provider-owned logs or arbitrary model prose can never contain instructions.

- [ ] Exercise queue→selection-change→send, steer with different selected frames, retry after lost mutation response, provider replacement during a pending write, child scope escape and close during server startup. Verify one shared tool schema and stable canvas IDs across create/resume for all providers. Future providers must pass this same suite through their existing adapter boundary.
- [ ] Run focused MCP/context/presentation/native-parser/race tests and both typechecks. Perform a real tool-discovery/create/write/inspect/resume smoke for each already authorized harness account using a low-cost available model. If account access or paid smoke authorization is missing, keep the deterministic fixtures and report the live provider row unverified; never mark the release gate passed from mocks alone.

## Task 5: Persistent Canvas in the utility pane

**Files:** Create `src/features/canvas/{CanvasWorkspace.tsx,CanvasBoard.tsx,DesignFrame.tsx,CanvasToolbar.tsx,CanvasNavigator.tsx,canvasState.ts,canvasGeometry.ts,canvasGeometry.test.ts,canvasState.test.ts}` and `tests/integration/canvas.spec.ts`. Modify `src/lib/{utilityPanel.ts,lazySurfaces.tsx}`, `src/components/utility/{UtilityPane.tsx,utilityToolOptions.ts}`, `src/App.tsx`, `src/hooks/{useStore.tsx,persistedUiPreferences.ts}` and their existing focused tests. Reuse Task 3 `DesignPreview.tsx`.

**Interfaces:** `CanvasWorkspace` consumes `{ appSessionId: string; canvasId: string | null; isExpanded: boolean }` plus focused bridge callbacks using the existing connection pattern. `applyCanvasChange(snapshot: CanvasSnapshot, change: CanvasChange): CanvasSnapshot` updates the feature-local projection. Geometry exports `screenToCanvas(viewport: Viewport, point: Point): Point`, `zoomAtPoint(viewport: Viewport, point: Point, scale: number): Viewport` and `fitFrames(rects: FrameRect[], viewportSize: Point): Viewport`, with `Point = { x: number; y: number }` and `Viewport = { x: number; y: number; scale: number }`. Frame/source ownership remains in Task 2.

- [ ] Add Canvas to the utility-tool type, picker, singleton handling, expandable tools and lazy surfaces. Keep only attachment IDs/pane preferences in shared state; viewport/selection/inspector state belong to the Canvas feature. Opening Canvas without an attachment presents the empty state with Create and Open saved canvas. Bootstrap an empty canvas/attachment atomically on explicit Create or the first `canvas_create`, then mint its scope; retries of that first request must reuse the same canvas. Merely opening the pane does not start a compiler or create a design.
- [ ] Implement background pan, wheel/pinch zoom, Fit/focus and frame dragging with pointer capture. Use one world-to-screen transform. Clamp zoom to 0.1–4 and retain the world point under the cursor:

```ts
export function zoomAtPoint(viewport: Viewport, point: Point, requestedScale: number): Viewport {
  const scale = Math.min(4, Math.max(0.1, requestedScale));
  const anchor = screenToCanvas(viewport, point);
  return { x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale };
}

const before = { x: 80, y: -20, scale: 0.8 };
const pointer = { x: 300, y: 240 };
assert.deepEqual(screenToCanvas(zoomAtPoint(before, pointer, 1.6), pointer), screenToCanvas(before, pointer));
```

- [ ] Implement resize, multiselect, align/distribute and keyboard nudge using layout mutations with expected layout versions. Keep dragging transient and send a final layout commit on pointer release; cancel restores the last acknowledged rect. Test zoomed dragging/resizing and a concurrent remote layout conflict without losing source. Do not write manifest state on every pointer move.
- [ ] Implement Select/Interact and Escape/Enter behavior. The frame header remains the drag handle; preview inputs receive real keyboard events in Interact. Mount at most four visible/active previews; other frames show an existing snapshot or an honest placeholder. Give the interacted frame priority. Releasing a slot may reset that frame's transient component state; retain source and explain the reload on return.
- [ ] Build virtualized Components search/focus, useful empty/loading/error views and the compact frame toolbar. Expose only completed actions at each local milestone; Task 11 requires the complete menu. Use actual design names and statuses as accessible labels, not icon-only discoverability.
- [ ] Give the expanded board its own top row. When the Canvas tab is expanded, `UtilityPane`'s header already owns the window's top row (with `WINDOW_CONTROLS_LEAD_PX` for the traffic lights); replace its tab strip there with a small DROIDEX mark and “Canvas” wordmark on the left in the same tone and weight as the chat title pill, a `Chat | Canvas` segmented control in the existing soft `bg-droid-elevated` pill style beside it, and the canvas picker (name, saved canvases, Create) as a popover off the wordmark. Chat returns the pane to its docked width; the composer stays where it is. Zoom readout sits bottom-left and Fit plus Select/Interact bottom-right of the board. No new palette, no second brand; verify light and dark in the running app before polishing.
- [ ] Add integration behavior: create a frame through the real bridge owner, click its CTA, pan/zoom and expand the pane, then confirm the CTA stays changed while its preview remains mounted. Close/reopen the pane and confirm source/geometry survive; preview-local React state may reset by contract. Start a new chat with this canvas and an ordinary new chat and assert their attachments differ as specified.
- [ ] Run focused geometry/state/utility tests and `rtk proxy npx playwright test tests/integration/canvas.spec.ts`. Manually inspect light/dark placement with a real chat, narrow utility pane and expanded board. The working create→build→click→reload flow is milestone one, not the final release.

## Task 6: Executable design systems and owned image references

**Files:** Extend Task 3 `sidecar/src/canvas/{designSystems.ts,designSystems.test.ts}` and `sidecar/src/canvas/presets/droidex.ts`; create `sidecar/src/canvas/presets/{openai-inspired.ts,claude-inspired.ts}` and `src/features/canvas/DesignSystemPicker.tsx`. Extend compiler virtual modules, Canvas storage/schema and existing composer attachment/reference code in `src/components/PromptInput.tsx`, `src/lib/promptSend.ts` and its callers. Extract cohesive composer UI if needed instead of growing its existing monolith.

**Interfaces:** `DesignSystem = { id: string; version: number; name: string; modes: Record<'light' | 'dark', Record<string, string>>; files: SourceFiles; guidance: string; examples: SourceFiles }`. `readDesignSystem(ref: DesignSystemRef): Promise<DesignSystem>` returns exactly that pinned version. `saveDesignSystem(system: DesignSystem): Promise<DesignSystemRef>` validates and saves a new immutable version. `OwnedAsset = { assetId: string; mediaType: string; byteLength: number; width: number; height: number }`; `importCanvasImage(canvasId: string, filePath: string): Promise<OwnedAsset>` runs only behind the app's file-picker/drop permission boundary. Tools/previews receive asset IDs, never arbitrary file-read authority.

- [ ] Author the three kits in spec §10 using locally available/licensed fonts, semantic tokens and a compact set of Button/Input/Card/Badge/Tabs/Dialog primitives. Use the existing app theme only for DROIDEX kit inspiration; do not change chrome colors to match a design. Include working focus, disabled, hover, selection and dialog keyboard behavior.
- [ ] Resolve `@droidex/design-system` to the pinned kit in the virtual compiler. Explicitly allow `react`, compiler-emitted `react/jsx-runtime`, `react-dom/client`, `lucide-react` and this kit module; disallow all other package imports until deliberately supported. Bundle only used icon/component code. Run Tailwind 3 over the complete source snapshot, with no dynamic partial-class guessing.
- [ ] Keep universal guidance short and kit guidance at most 16 KiB. Provide a complete good starter example using the same API as generated code:

```tsx
import { useState } from 'react';
import { Button, Card } from '@droidex/design-system';
export default function Hey() {
  const [done, setDone] = useState(false);
  return <Card><h1>Hey, welcome in.</h1><p>A small place to start something good.</p>
    <Button onClick={() => setDone(true)} disabled={done}>{done ? "You're all set" : 'Get started'}</Button>
  </Card>;
}
```

The actual primitives must export those signatures and use pinned kit tokens. Do not ship examples with decorative buttons that have no action.

- [ ] Add the picker beside the existing composer controls and removable selection/system chips. Default to the DROIDEX kit; persist the user's explicit selection for future requests. Test that request A queued under kit version 1 stays pinned when the user selects version 2 before A executes.
- [ ] Implement `canvas_theme` list/read/save/apply. Applying to one existing design uses a normal source revision/CAS with a new system reference and preserves behavior. A version mismatch or unsupported token mapping returns diagnostics; never mutate the global kit to restyle one design. Extract only source-owned tokens/primitives into a new user kit with provenance.
- [ ] Import images through the real file/drop path, enforce 10 MiB/image and decoded dimension limits of 8192 × 8192, reject SVG/script-bearing formats for the initial image-import contract, and accept PNG/JPEG/WebP after content validation. Save once by content ID; preview URLs expose only that asset and render offline. Feed the provider bounded existing multimodal attachments without appending internal asset paths to user text.
- [ ] Test executable examples in every kit/mode, one meaningful accessibility/contrast check against the token pairs actually used, immutable kit version pinning and invalid image/path inputs. Run focused tests plus the actual Electron offline image/font smoke; inspect all three kits visually. Do not call an inspired kit an official OpenAI/Claude preset.

## Task 7: Element selection, direct edits and source/history UI

**Files:** Create `sidecar/src/canvas/{sourceElements.ts,sourceElements.test.ts}` and `src/features/canvas/{CanvasInspector.tsx,CanvasSourceEditor.tsx}`. Extend `compiler.ts`, preview runtime/event schemas, `CanvasWorkspace.ts`, `canvasMcpServer.ts` and Canvas integration tests.

**Interfaces:** Uses Task 2 `SourceElement`. `instrumentSource(files: SourceFiles, revisionId: string): { files: SourceFiles; elements: SourceElement[] }` produces derived instrumented source without modifying canonical files. `ElementEdit = { element: ElementRef; change: { kind: 'text'; value: string } | { kind: 'token'; property: string; token: string } | { kind: 'image'; assetId: string } }`. `applyElementEdit(files: SourceFiles, elements: SourceElement[], edit: ElementEdit): SourceFiles` returns complete changed files or a typed ambiguity/stale-reference error; the caller commits through `write` with the reference's revision.

- [ ] Use the TypeScript parser already present in the build toolchain for an AST-based source transform. Package the needed parser in the worker after dependency/bundle review. Instrument owned native JSX elements, preserve source maps and mark computed/shared sites honestly. Avoid regex rewriting or mandatory model-authored IDs. IDs live within a revision; reject a selection from another revision and ask the user to reselect.
- [ ] Have the preview report element bounds, source element ID and runtime instance path when selection mode requests it. Validate the event as untrusted; no arbitrary DOM/property evaluation RPC. Render overlays in board coordinates with correct scale/scroll conversion. Selection does not hijack clicks while in Interact.
- [ ] Add a focused round-trip regression whose meaningful contract is source preservation:

```ts
const files = { 'main.tsx': 'export default function App(){return <h1>Hello</h1>}' };
const mapped = instrumentSource(files, 'r1');
const heading = mapped.elements.find((element) => element.tagName === 'h1');
assert.ok(heading);
const changed = applyElementEdit(files, mapped.elements, {
  element: { designId: 'heading', revisionId: 'r1', elementId: heading.elementId, instancePath: '0' },
  change: { kind: 'text', value: 'Welcome' },
});
assert.equal(changed['main.tsx'], 'export default function App(){return <h1>Welcome</h1>}');
```

Also cover escaping `<`, `&`, quotes and Unicode without changing surrounding source. One regression should show that a repeated/computed node produces a scoped agent-edit request instead of silently rewriting a shared definition.

- [ ] Implement the small direct inspector: literal text, supported token choices and owned image replacement. When editing a computed/shared element, show its scope and attach the selected element/revision chip to the existing composer. Do not expose controls that can only mutate the preview DOM.
- [ ] Reuse CodeMirror core for file editing with Save, diagnostics and visible dirty state. Reuse available syntax tooling; a new grammar dependency requires explicit justification. Preserve local buffer edits on agent-update CAS conflict and offer compare/reapply. Saving creates a revision; do not autosave every keystroke into history.
- [ ] Implement history list and diff using canonical revision files. Viewing a revision is read-only; Restore copies it into a new head through the normal commit/build path, retaining all later history. Include system version and build status in the revision summary.
- [ ] Verify literal edit→source→build→reload, ambiguous selection, a remote agent edit while the source drawer is dirty, stale element IDs, repeated instances, and restore-as-new-revision. Run focused source-element/workspace tests and the real click/edit flow in Electron; source and rendered result must agree.

## Task 8: Variants, local library and durable board undo

**Files:** Create `src/features/canvas/CanvasVariants.tsx` and `sidecar/src/canvas/{canvasLibrary.ts,canvasLibrary.test.ts}`. Extend Task 2 workspace/schema/protocol, Task 5 navigator/toolbar and Task 7 history UI. Add focused cases to `CanvasWorkspace.test.ts` and `tests/integration/canvas.spec.ts`.

**Interfaces:** `LibraryItem = { itemId: string; name: string; sourceCanvasId: string; source: RevisionRef; designSystem: DesignSystemRef }`. `saveLibraryItem(input: Omit<LibraryItem, 'itemId'>): Promise<LibraryItem>` stores an independent immutable copy of source/assets plus revision provenance; `listLibraryItems(query: string): Promise<LibraryItem[]>` returns bounded summaries. Insertion uses `create` with `{ kind: 'library', itemId }` and makes an independent design. Workspace additions: `removeFrames(scope: CanvasScope, mutationId: string, designIds: string[]): Promise<{ undoId: string }>`, `undoRemoval(scope: CanvasScope, mutationId: string, undoId: string): Promise<CanvasChange>`, `renameFrame(scope: CanvasScope, mutationId: string, designId: string, name: string): Promise<CanvasChange>`, and `removeCanvas(canvasId: string): Promise<void>` behind an explicit app deletion action.

- [ ] Implement a variants popover with layout/style/color choices, user direction and count 1–4 (default two). Capture the original revision/system once, reserve all sibling frames through one idempotent `create`, then submit one user-requested action through the current composer/session machinery with those explicit targets. This action is ordinary user intent, not hidden system text.
- [ ] Place variants adjacent to their source with collision-free deterministic spacing. Never move the source or existing user-arranged frames. Child agents may be assigned separate frame scopes when the current harness supports them; sequential generation remains a complete supported flow. Derive presence from actual actors and mutations.
- [ ] Protect the core behavior with the real workspace API:

```ts
const original = await workspace.readFiles(canvasId, sourceRef);
const variants = await workspace.create(scope, {
  mutationId: 'two-variants',
  frames: [
    { name: 'Hey · layout', width: 720, height: 720, seed: { kind: 'revision', canvasId, revision: sourceRef }, designSystem },
    { name: 'Hey · color', width: 720, height: 720, seed: { kind: 'revision', canvasId, revision: sourceRef }, designSystem },
  ],
});
assert.equal(new Set(variants.map((frame) => frame.designId)).size, 2);
assert.deepEqual(await workspace.readFiles(canvasId, sourceRef), original);
```

Then write to one returned variant and assert the source and other variant remain byte-identical. Fail one build and verify the other can finish. Retry creation with the same mutation ID and assert no extra frames.

- [ ] Implement duplicate, rename, add to library, searchable library and insert independent copy. Library storage under `<droidexUserDataDir()>/canvas-library/` owns its immutable source/asset copy; source IDs are provenance, not a dependency on the original canvas continuing to exist. Test reuse after deletion of the original canvas. Empty library copy explains Add to library. Do not build a marketplace or cloud sync.
- [ ] Implement delete/Undo using persisted tombstones and source references, including reopening before Undo. Board layout undo uses inverse geometry with expected layout versions; if another writer changed a target, surface a conflict rather than blindly replaying an old move. Keep source-editor undo separate from board undo and revisions.
- [ ] Add Open saved canvas and explicit whole-canvas deletion in the canvas picker. Show affected chat attachments before deleting a canvas; unlink those attachments and cancel its work before removing its owned source. Preserve independently saved library items. Never treat chat deletion or closing a pane as whole-canvas deletion.
- [ ] Run library/workspace tests and the V2-style integration flow: original above two pending variants, independent completion, working CTAs, searchable focus, library insertion, new chat retaining the board and reload after deletion/undo. Inspect the floating menu in narrow/expanded layouts.

## Task 9: Source export, image capture and lifecycle recovery

**Files:** Create `sidecar/src/canvas/{canvasExport.ts,canvasExport.test.ts}`. Extend the existing Electron file-save/capture bridge at its actual owner and Canvas context actions; inspect `electron/main.cjs` and `electron/preload.cjs` before placing code. Extend runtime smoke and workspace/build teardown tests.

**Interfaces:** `exportCanvasSource(canvasId: string, ref: RevisionRef, destinationDirectory: string): Promise<{ filesWritten: number }>` writes only to an explicit user-chosen directory. `captureCanvasImage(canvasId: string, ref: RevisionRef, signal: AbortSignal): Promise<{ mediaType: 'image/png'; bytes: Uint8Array }>` captures the exact rendered revision with a six-second deadline. Both require the authorized host boundary; generated code cannot choose paths or invoke export.

- [ ] Export the selected revision's source tree, owned assets, kit source/tokens/fonts/licenses and a minimal README explaining its locked runtime imports and entry point. Include sufficient build metadata to run that source with the repository's supported toolchain; no private prompts, session logs, credentials or absolute local paths. Refuse overwrite collisions until the user chooses another directory or explicitly confirms replacement through the app's normal file flow.
- [ ] Export PNG through the proven preview host at the frame's CSS size/device scale, bound dimensions and result bytes, and preserve transparent content when present. If capture is unavailable or times out, report it and keep source export available. Do not return a previous revision's thumbnail as a current screenshot.
- [ ] Add inspect screenshot support using the same bounded capture operation; no second capture engine. The model gets a real image or `capture_unavailable`. Test timeout, abort and generation change during capture with controlled promises; source writes and chat completion must settle independently of capture.
- [ ] Validate exported paths/content in a temporary directory and run the exported Hey example outside the app's source checkout. Assert no path escape and no internal canary in exported metadata. Refusing an existing destination file must leave it byte-identical.
- [ ] Complete shutdown/profile isolation: cancel queues before awaiting external cleanup, terminate compiler workers, stop preview hosts/subscriptions, revoke MCP scopes, and release all waiters. Verify repeated close is harmless and a new session with a reused provider handle cannot accept old writes/events. Run failure cases with locked/unavailable capture, not only a visible happy-path window.
- [ ] Run focused export, teardown and runtime tests; manually export a stateful design and confirm PNG and source describe the selected revision. Record capture limitations honestly.

## Task 10: Motion, accessibility and measured performance

**Files:** Create `src/features/canvas/canvasMotion.ts`. Refine board/frame/toolbar/inspector/navigator/preview components, existing `src/lib/theme.ts` only where chrome tokens genuinely need adjustment, and `tests/integration/canvas.spec.ts`. Extend the existing GUI benchmark/replay tooling at `tools/gui-bench-run.ts` and `sidecar/src/perf/` only with useful Canvas workloads; keep generated reports under `reports/`.

**Interfaces:** Export one immutable `canvasMotion` token object; components use reduced-motion preference to choose immediate/static behavior. No animation manager or duplicate per-component motion constants. Existing replay gates remain authoritative for chat/runtime regressions; the real Electron GUI workload measures board interaction.

- [ ] Implement the proposed timings from spec §11 in one place:

```ts
export const canvasMotion = {
  focusMs: 220,
  paneMs: 200,
  popoverMs: 120,
  frameArrivalMs: 180,
  readyMs: 120,
  presenceMs: 140,
  busyLoopMs: 1600,
  ease: [0.22, 1, 0.36, 1],
};
```

Direct pointer input bypasses easing. First ready content crossfades without a manufactured delay. Busy/presence animation stops when offscreen, hidden, settled or reduced-motion is enabled. Use actual build/tool events for labels and targets; no fake “verification” or wandering cursors.

- [ ] Preserve frame identity and mounted preview state during expand, selection and inspector transitions. Apply only a first-use fit before the user navigates. Add keyboard roving/focus behavior for toolbar/menu/list, focus restoration after dialogs and concise status announcements; test text inputs retain their ordinary editing shortcuts.
- [ ] Seed 50 mixed frames and run a repeatable drag→zoom→focus→interact→resize→variants sequence on recorded hardware. Log p95 frame time, main-thread long tasks, live-preview count, memory after close/reopen and idle animation work. Require four-or-fewer live previews, no idle Canvas loop and targets from spec §11; investigate misses rather than hiding them with a larger budget.
- [ ] Run `rtk proxy npm run perf:replay -- --scenario idle`, then `streaming`, `multi-agent` and `session-switch`; compare with `origin/main` using existing `perf:compare`, `perf:report` and `perf:gates`. Run `quality:bundle-budgets` and compare startup/lazy chunk size. Canvas closed must not load the compiler, kit source or preview bundle into the renderer's startup path.
- [ ] Watch both supplied videos alongside the local app. Check pending bloom, ready reveal, toolbar positioning, variant placement, cursor-anchored zoom and pane expansion. Record the app in light and dark plus reduced motion. Visual acceptance is actual observed behavior, not a passing build or an animation screenshot.

## Task 11: Full acceptance, documentation and implementation handoff

**Files:** Update `docs/architecture.md`, create `docs/canvas.md`, update `README.md`, `docs/generated/project-reference.md` only via its generator when scripts change, and the existing release-note location used by the execution branch. Extend the Task 5 integration and Task 1 Electron smoke only for uncovered meaningful behavior.

**Interfaces:** User documentation describes the implemented command/preview/source/privacy contracts. The provider conformance table records Droid, Claude Code, Codex create/resume/close results separately. No new feature API.

- [ ] Run the complete spec §12 acceptance matrix. Repeat the reference Hey request and component-gallery request with each supported harness. Capture create→working CTA→direct edit→code edit→two variants→library→new chat→reload. Record any authentication/quota limitation as unverified; never replace live-provider evidence with claims based on one provider.
- [ ] Run these real repository gates under Node.js 22, prefixed with `rtk proxy`. Re-run only affected checks after later fixes; do not add tests just to inflate coverage.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run sidecar:typecheck
npm run electron:check
npm run test
npm --prefix sidecar run test
npm run test:ci
npm --prefix sidecar run test:ci
npm run quality:boundaries
npm run quality:file-size
npm run quality:tech-debt
npm run quality:bundle-budgets
npm run docs:check
npm run build
npx playwright test tests/integration/canvas.spec.ts
npx playwright test --config=playwright.canvas-smoke.config.ts
```

Run `npm run docs:generate` before `docs:check` when script/environment documentation changes. Retain existing coverage thresholds and lint suppressions policy. Include the Task 10 replay evidence and actual packaged arm64/x64 runtime evidence in the handoff; unsigned testing does not authorize a signed release.

- [ ] Document discoverable Canvas entry, one-composer workflow, Select/Interact, shortcuts, supported source/imports, kit versions, direct-edit limits, state reset on revisions/eviction, local storage, export, recovery and the exact privacy guarantee. Link the workflow from README and the in-app empty state/help. Add the honest feature sentence from the spec only after the feature exists.
- [ ] Record a short product demo using both the narrow utility pane and expanded canvas. Demonstrate actual clicks and persisted designs rather than only generation animation. Use the original recordings as reference; do not redistribute them as DROIDEX marketing assets.
- [ ] Self-review the final diff for identity mistakes, stale results, duplicate state, dead old paths, wrappers, oversized modules, unusable controls, prompt leakage and undocumented limits. Remove scratch probes/reports and keep only valuable tests. Do not add compatibility code for the old PR. Keep changed-file descriptions factual and small.
- [ ] Finish with implemented behavior, tests actually exercised, measured performance, provider/platform verification rows and remaining limitations. If a release criterion is unverified or failing, state that explicitly. Commit/push/open PR only when authorized; this plan does not grant that authorization.

## Plan self-review and handoff checklist

The plan maps every included product requirement to a task in spec §12. Shared types live in Task 2; source mapping, kits, library and export contracts are introduced by their owning tasks. The five Review Focus cases each have an explicit test owner. Task 1 has three explicit feasibility gates: preview-host CPU isolation, the per-session server + turn-lease binding on all three adapters (including Codex forwarding), and the packaged compiler. Each must be resolved before its production boundary is implemented; none is claimed as already verified.

Before execution, re-read the two recordings at their original locations linked in the spec, and inspect the current branch for intervening changes. Use the plan as a sequence of reviewable outcomes, not permission to create unnecessary files or abstractions. Completion means the entire included local workflow works coherently with all three harnesses and the shared Canvas tooling.
