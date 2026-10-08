# DROIDEX Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, interactive design canvas beside the existing DROIDEX chat, with consistent design systems, source-backed editing and the same tools for every supported harness.

**Architecture:** The sidecar owns canonical source, immutable revisions, layout, attachments and builds. A feature-local renderer board hosts isolated previews and sends typed commands to those same owners. One six-tool local MCP surface gives Droid, Claude Code, Codex and future adapters access without inserting internal instructions into user messages.

**Tech Stack:** Node.js 22, the repository's Electron/React 19/TypeScript stack, existing Tailwind 3, framer-motion, CodeMirror, esbuild and Zod. Use locked versions; review and package any dependency promoted into the runtime.

**Spec:** [DROIDEX Canvas design specification](../specs/2026-10-05-droidex-canvas-design.md). Read it before this plan; it contains both original video links, timestamped observations, product behavior, limits and exclusions.

**Videos:** [V1 — component board and theme selection](</Users/anas/Desktop/Screen Recording 2026-10-05 at 12.10.35 PM.mov>); [V2 — generation, interaction and variants](</Users/anas/Desktop/Screen Recording 2026-10-05 at 12.39.57 PM.mov>). These local recordings are the visual references for implementation, not assets to commit or redistribute.

**Execution:** Work lives in the `droidex-canvas` worktree on the `canvas/integration` branch, cut from `icons/menu-icons` at `1986663486e755a58c83439d35af18f94741a8ff`. Task 1 is a branch and pull request into `canvas/integration`; Tasks 2–12 use the ordered subtask branches below, each with its own pull request into `canvas/integration`, merged only after review. Design, UI/UX and performance work and the reviews are routed to the models the user assigns through DROIDEX projects; this plan does not pick them. Checkboxes below are ticked only when the work is done and verified.

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
2. Two chats/editors change one design or source contains repeated/computed JSX: preserve both authors' work and make edit scope explicit. Tests in Tasks 2 and 8.
3. Disk failure or process death occurs between source write and manifest commit: reopening exposes a complete old or new revision, never a partial one. Tests in Task 2.
4. Generated code loops, escapes its resource boundary or floods messages: chat stays usable, privileged APIs remain unreachable and the preview can be terminated. Runtime gate in Task 1; regressions in Task 3.
5. Native provider replay/search/export bypasses live transcript filtering: internal canaries stay absent while identical user-authored text remains visible. Tests in Task 4 for every provider format.

## File ownership and dependency order

Paths marked “new” are proposed. Inspect existing helpers before introducing them. Keep the named responsibilities even if a small helper belongs beside its sole nontrivial caller.

| Owner | Files | Responsibility |
| --- | --- | --- |
| Durable workspace (Task 2) | New `sidecar/src/canvas/{protocol.ts,schema.ts,CanvasWorkspace.ts,canvasFiles.ts}` | DTOs, boundary validation, mutations, CAS, attachments and atomic persistence |
| Build/runtime (Task 3) | New `sidecar/src/canvas/{CanvasBuilds.ts,compiler.ts,compilerWorker.ts}`; new `src/features/canvas/{previewDocument.ts,previewRuntime.ts}` | Worker compilation, allowed imports/assets, preview contract and stale-build rejection |
| Harness access (Task 4) | New `sidecar/src/canvas/{canvasMcpServer.ts,canvasTurnContext.ts,canvasToolPresentation.ts}` | Six schemas, session/turn scope, compact model context and safe transcript projection |
| Artifacts (Task 6) | New `src/features/canvas/CanvasArtifactCard.tsx`; `src/components/{messageFeedRows.tsx,MessageBody.tsx}`; `sidecar/src/canvas/{canvasToolPresentation.ts,compiler.ts}`; runtime packaging | Inline cards, chart runtime and shared frame presence in ordinary chats |
| Design systems (Task 7) | New `sidecar/src/canvas/designSystems.ts`, `sidecar/src/canvas/presets/`; new `src/features/canvas/DesignSystemPicker.tsx` | Versioned kit content and composer selection |
| Board (Tasks 5, 11) | New `src/features/canvas/{protocol.ts,CanvasWorkspace.tsx,CanvasBoard.tsx,DesignFrame.tsx,DesignPreview.tsx,CanvasToolbar.tsx,CanvasNavigator.tsx,canvasState.ts,canvasGeometry.ts,canvasMotion.ts}` | Projection, gestures, visible previews, selection/navigation and motion |
| Editing/reuse (Tasks 8–10) | New `sidecar/src/canvas/{sourceElements.ts,canvasLibrary.ts,canvasExport.ts}`; new `src/features/canvas/{CanvasInspector.tsx,CanvasSourceEditor.tsx,CanvasVariants.tsx}` | Source mapping, direct edits, source/history UI, variants, local reuse and export |
| Existing seams (Tasks 2–7, 10) | `src/App.tsx`, utility modules, composer/send/store modules; `sidecar/src/SessionManager.ts`, lifecycle/event/history/provider modules; Electron packaging | Focused wiring only; feature behavior stays with its owner |
| Verification (Tasks 1–12) | Focused `*.test.ts` next to the owning modules; `tests/integration/canvas.spec.ts`; `tests/smoke/electronCanvas.smoke.spec.ts`; `playwright.canvas-smoke.config.ts` | Core invariants, actual browser input and actual Electron isolation/packaging |

The frontend may not import sidecar source (`.dependency-cruiser.cjs`). Mirror the small wire DTOs in `src/features/canvas/protocol.ts`, following existing bridge conventions, and assert representative serialized fixtures against both boundaries. Do not add a shared-package framework for this feature.

Dependency order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12**. The first user-visible vertical slice is complete at Task 5; Tasks 8–10 are a second wave that starts only after Tasks 5, 6 and 7 are verified in the running app with all three providers; the requested release is complete only after Task 12. If Task 1 rejects the proposed preview host or the turn-lease binding, revise that boundary before its production task, preserving the product and shared-tool contracts.

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
  designs: DesignRef[];
  elements: ElementRef[];
  designSystem: DesignSystemRef;
};
type CanvasScope = {
  scopeId: string;
  appSessionId: string;
  generation: number;
  canvasId: string | null; // null for an unattached chat's lease (spec §6)
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

Settled by 02a (landed in `sidecar/src/canvas/{protocol.ts,schema.ts}`):

- The canvas identity lives on `CanvasScope`, not `CanvasTurnContext`; the renderer mirrors `CanvasTurnContext` (it travels with queue/steer/send) and never sees `CanvasScope`. `beginCanvasTurn` reads the session's attachment when the turn starts; Task 4 owns what happens when the attachment changed between queueing and execution.
- One identifier charset for canvas/design/revision/mutation IDs: 1–128 chars of `[A-Za-z0-9_-]`. Source paths reject `.`/`..`/empty segments, backslashes, C0/C1 controls, unpaired surrogates and the segments `__proto__`/`constructor`/`prototype`; collisions compare NFC-normalized, case-folded keys across `files` and `deletedPaths`. `canvas_arrange` accepts at most 256 frames and no duplicate `designId`.
- The schema bounds one write (64 files, 1 MiB total, 256 KiB per file). 02b enforces the same count and byte limits against the complete resulting revision, unchanged files included, and refuses to follow or create symlinks under a revision directory. Source trees are `Map`s or null-prototype objects.
- Versions: `layoutVersion` is 0 on create and increments on each accepted arrange; `sequence` is 0 for a new canvas and increments on each committed change; `DesignSystemRef.version` is 1-based, the first saved kit is version 1.
- Invalid arguments map to `invalid_input` or `invalid_source_path` at the dispatch boundary (02c) as spec §8 describes; the workspace itself throws `CanvasError` and never a raw validation error.

## Task 1: Prove the preview host and packaged compiler

**Files:** Inspect `src/components/{AppBlock.tsx,appBlockDocument.ts,appBlockRuntime.ts}`, `electron/{main.cjs,preload.cjs}`, `electron-builder.config.cjs`, `sidecar/package.json`, `.github/workflows/`, `tests/smoke/electronChildSessions.smoke.spec.ts`. Create `tests/smoke/electronCanvas.smoke.spec.ts` and `playwright.canvas-smoke.config.ts`. Own temporary probes outside Git; retain only useful security/runtime regression cases.

**Interfaces:** Consumes the existing Electron launch/profile lifecycle and provider MCP configuration path. Produces a documented decision in spec §6: the one preview-host boundary that passes isolation/recovery, plus the exact compiler/runtime resources required on arm64 and x64. Also proves that each provider can bind Canvas calls to their originating request as required by Task 4. No general-purpose host abstraction or placeholder production API.

- [x] Use a scratch profile through `DROIDEX_USER_DATA_DIR`, hide test windows where existing harness policy requires it, and ensure app/sidecar/compiler processes are cleaned up in `finally`. Do not point destructive probes at the user's running profile.
- [x] Compile and execute this complete representative source using locally bundled dependencies; confirm the button changes in the real Electron preview and capture the cold build time and artifact size.

```tsx
import { useState } from 'react';
export default function Hey() {
  const [done, setDone] = useState(false);
  return <button onClick={() => setDone(true)}>{done ? "You're all set" : 'Get started'}</button>;
}
```

- [ ] Probe unavailable imports, network/fetch/WebSocket, parent DOM/bridge, top navigation, workers, message flooding and capture timeout. Then exercise `while (true) {}` and large allocation/DOM cases under an external watchdog. Assert host responsiveness from a separate process; a timeout inside the frozen renderer cannot prove recovery.
- [x] Use the existing Playwright Electron pattern with this dedicated config; include cleanup assertions for child PIDs. Failure to keep chat and Stop usable blocks the proposed host. Update spec §6 to the one measured replacement before proceeding if required; do not keep both engines.

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
- [x] Probe local MCP discovery and the per-session server + turn-lease binding (spec §6) on all three adapters for primary sessions: a delayed call after turn settlement must be refused and a steer during an active call must keep the original lease. Confirm scopes pin without prepending hidden text to a user message or editing global harness settings. For Codex, measure both the existing dynamic-tools bridge and `thread/start`/`thread/resume` `config.mcp_servers.<name>.url` forwarding against the SDK's stateless Streamable HTTP server. Measured: mutation lease refused on all harnesses; Codex dynamic-tools bridge chosen; stale reads unbound on Droid. Details in spec §6.
- [ ] Prove a Droid child calling through the parent's server lands in the parent's scope with a live reopened `child.open` session. A native Droid `Task` subagent did not discover the probe tools; DROIDEX's own child runtime path is unverified. Owned by Task 4d; variants (Task 9) must not depend on it.
- [x] Measure the compiler two ways in a sidecar worker thread: native `esbuild` (needs `@esbuild/darwin-arm64` and `-x64` packaged unpacked beside `sidecar/dist`, since the sidecar ships as a self-contained bundle in `extraResources`) and `esbuild-wasm` (no native binary, slower cold start). Run Tailwind 3 JIT over the same fixture in the worker and record its cold and warm cost separately. Record cold build time, warm build time, artifact size and packaged size for each; pick one for Task 3 from the numbers.
- [x] Run `npx playwright test --config=playwright.canvas-smoke.config.ts` against the probe and retain measured evidence for Task 3. Record pass/fail per architecture; unavailable hardware is unverified, not passed. Review the focused diff; commit only if execution authorization covers commits.

**Measured evidence (Task 1a, 2026-10-05, Apple M4 / 24,576 MiB, macOS Darwin 25.6.0, arm64, Node 22.22.3, Electron 39.8.10 development build):**

- Latest retained smoke (2026-10-06): **PASS**, 3/3 cases (30.0 s; hardened guest ancestor route, concurrent chat/main samples), with app/sidecar child PIDs gone. Initial smoke as committed: **FAIL**, 120-second timeout during the flood; no final evidence emitted. The retained smoke separates isolation/escapes, isolated-host flood containment and memory exhaustion, with external deadlines and PID cleanup. Readiness and escape-collector races were corrected. Every Electron run used a scratch `DROIDEX_USER_DATA_DIR`; `ELECTRON_RUN_AS_NODE` was removed. Compiler workers/services were supervised outside Git and PIDs checked after shutdown.
- The already-proven opaque-origin `sandbox="allow-scripts"` iframe isolation/escape contract remains: its OS PID differs from the host; CPU spin leaves the host answering; fetch/WebSocket/popup/top navigation/parent DOM/cookie/storage/blob Worker are refused under the preview CSP with `worker-src 'none'`. The retained regression also proves main-process termination of a spinning frame.
- **Direct iframe delivery to chat fails the flood gate.** Each bounded burst sent 200,000 messages plus one completion marker. Instrumented collector: send 787.80 ms, last sampled receipt 10,000 at 16,499.70 ms; no full drain by the 30,042.44 ms cutoff, nine 3-second response deadlines missed, successful sampled round trips 5.06–28.48 ms. Sender-only termination still left the host unable to answer for >30,000 ms. First-field rejection (identity captured once, separate minimal counter): send 485.20 ms; last sampled receipt 40,000 at 24,948.70 ms; no drain by 30,038.47 ms, nine deadlines missed, successful samples 2.05–5.52 ms. Its post-kill observation was interrupted; no recovery pass is claimed.
- Main rate detection + sender termination with an already-deep queue: 200,000 sent in 1,096.90 ms; sustained rate detected at 10,000 messages (>100/s), main used the captured `WebFrameMain.osProcessId` to SIGKILL only the frame. Another 20,000 queued messages were observed after detection (30,000 received at 26,143.70 ms); no drain by 30,015.83 ms, nine 3-second deadlines missed; successful sampled round trips 12.56–335.10 ms. Host response after termination exceeded 30,000 ms. No host `render-process-gone` fired in these observation windows. Electron 39 has no frame-only terminate method; `webContents.forcefullyCrashRenderer()` would kill the chat host, so the sender-only experiment used main-owned OS termination instead.
- **Interim native host (superseded by the final guest decision below):** isolated Electron `WebContentsView` with no preload/Node privileges, containing the sandboxed iframe. First measured run: send 200,000 in 242.30 ms; receive 10,000 / terminate host at 342.90 ms; termination call <1 ms; DROIDEX round trips 1.51–250.23 ms, after termination 318.55 ms. Retained regression runs: send 338.70 / 178.20 / 172.70 / 216.70 ms; terminate at 10,000 received after 465.70 / 243.10 / 243.20 / 294.60 ms; termination calls 0.047 / 0.035 / 0.026 / 0.046 ms; DROIDEX maximum round trips 284.18 / 88.91 / 144.41 / 108.04 ms, after 248.36 / 85.13 / 117.16 / 196.67 ms. Queued remainder is discarded with the preview host, not drained through chat. Host renderer stays alive. Task 3 must bound host-to-chat output and terminate the queue owner from main; early field rejection / sender-only termination are insufficient.
- Interim native-host follow-up regression bounds main-process evaluation externally. All runs sent 200,000 messages, terminated the host at 10,000 received, and had no chat `render-process-gone`; the isolated host crashed as intended. Timing in ms; p95 is nearest-rank and sample counts are small:

| Native-host route / run | Send | 10,000 received | Crash call | Samples | Chat min / max / p95 | Main min / max / p95 | Next chat |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
| Parent, follow-up suite (3/3, 16.6 s) | 393.50 | 558.40 | 0.696 | 7 | 2.47 / 351.94 / 351.94 | 1.79 / 164.76 / 164.76 | 271.50 |
| Top, final suite (3/3, 23.0 s) | 646.10 | 1172.40 | 1.491 | 7 | 3.38 / 2099.39 / 2099.39 | 4.86 / 316.74 / 316.74 | 572.17 |
| Top, focused repeat (1/1, 3.0 s) | 192.20 | 269.70 | 0.035 | 4 | 1.27 / 110.43 / 110.43 | 0.87 / 23.02 / 23.02 | 216.79 |

- Follow-up memory runs retained the same chat PID, observed frame-only death and no chat `render-process-gone`. First: 3,904 MiB reported payload / 2,701.80 MiB externally sampled RSS; death 5,099.48 ms; maximum chat round trip 167.80 ms; next 4.09 ms. Final: 3,520 MiB reported payload / 1,499.09 MiB RSS; death 4,475.88 ms; maximum chat response 270.34 ms; next 7.93 ms. Timings vary with workload; RSS samples do not establish every allocated byte was resident. The later native maximum overlaps nested measurements, so latency comparison alone is not decisive; the measured ancestor bypass below defeats the nested boundary independently.
- **Nested DOM host rejected after follow-up (2026-10-06):** reused the existing `droidex-favicon` scheme, registered before app ready with `standard`, `secure` and `supportFetchAPI`; a scratch-profile-only handler served static HTML at `droidex-favicon://canvas/host`. No production scheme or packaging was changed. Initial separation: chat/intermediate/generated PIDs 34077/34154/34176, intermediate `location.origin` = `droidex-favicon://canvas`. All subsequent measured runs also had three distinct PIDs. A sandboxed intermediate (`allow-scripts allow-same-origin`) served over real loopback HTTP also separated the three processes; generated frames kept only `allow-scripts` and an opaque origin.
- Nested bursts sent exactly 200,000 valid bounded messages; the intermediate forwarded at most one every 1000/60 ms, dropping the rest. No host/frame termination occurred during the stated observation. Two initial scheme runs held at least 2 s: send 268.90 / 780.60 ms; 220 / 275 forwarded messages observed in chat; chat max/p95 2382.70/2382.70 and 2030.58/2030.58 ms (8 / 14 samples); main max/p95 688.42/688.42 and 1560.76/1560.76 ms. DOM removal / SIGKILL call 29.71 / 5.02 ms; both child PIDs gone after 2075.82 / 2085.47 ms; next chat response 7.23 / 3.10 ms. No chat `render-process-gone` fired. Intermediate progress had not reached the first 10,000-message checkpoint at removal.
- Longer nested scheme runs held at least 10 s before recovery, with a deep undrained queue; no chat `render-process-gone`. Timings in ms; p95 uses nearest-rank samples from the external Playwright process. `Received` is the last main-console 10,000-message checkpoint, not the exact count at removal:

| Scheme recovery run | Send | Received / checkpoint ms | Chat forwarded | Chat samples | Chat max / p95 | Main max / p95 | Recovery call | Both PIDs gone | Next chat |
| --- | ---: | --- | ---: | ---: | --- | --- | ---: | ---: | ---: |
| DOM removal 1 | 572.10 | 10,000 / 9538.30 | 552 | 87 | 1679.82 / 52.12 | 1568.58 / 93.84 | 2.57 | 2026.69 | 1.36 |
| SIGKILL 1 | 300.00 | 20,000 / 9755.50 | 577 | 141 | 1538.37 / 2.69 | 167.21 / 2.04 | 2.11 | 2049.88 | 2.96 |
| DOM removal 2 | 346.50 | 10,000 / 5797.50 | 571 | 136 | 1345.50 / 3.22 | 272.76 / 2.76 | 2.59 | 2023.28 | 2.09 |
| SIGKILL 2 | 393.10 | 10,000 / 7074.20 | 567 | 125 | 2568.49 / 3.97 | 332.49 / 2.81 | 1.74 | 2038.94 | 1.40 |

- Final two scheme runs verified at most 60 forwarded messages in every rolling 1-second sender window; chat nevertheless observed up to 149 / 165 arrivals in a rolling second due to delayed delivery (571 / 567 total over 9642.00 / 9624.20 ms between first and last observed arrival). Sender pacing is not a receiver-arrival bound. Full 200,000-message drain was not awaited: removal/kill discarded the remaining intermediate queue after the bounded observation. SIGKILL of the intermediate alone released both child PIDs; DOM removal had similar timing. Recovery measurements include the external command and PID observation, not only the kill syscall.
- Normal HTTP-origin nested control: DOM-removal trial **FAIL**, chat exceeded the 3000 ms external deadline before recovery measurements; finally cleanup released owned processes. SIGKILL trial: send 519.20 ms, last checkpoint 10,000 / 9503.80 ms, chat forwarded 554 over 9467.10 ms between first/last receipt, 85 response samples; chat max/p95 2264.44/6.39 ms, main 1245.48/8.31 ms; kill command 4.08 ms, both child PIDs gone 2071.85 ms, next chat 3.09 ms. No chat `render-process-gone` in the completed control. An earlier scratch custom-scheme setup timed out before readiness because an embedded closing script tag was not escaped; it was corrected before any separation/flood claim. The first HTTP setup used unavailable `require` in the evaluate context and failed before measurement; the corrected control used Node's builtin module access.
- Nested sanity **PASS**: the exact Hey source, bundled with React/bootstrap to 193,971 bytes, changed “Get started” to “You're all set” through two frame locators and its updated label reached chat (2 bounded messages). Generated `parent.document` and `parent.parent.document`, cookie/localStorage and top navigation raised `SecurityError`; fetch rejected, WebSocket errored, popup was null and blob Worker errored. The ordinary nested candidate was rejected; the later guest probe below replaces the interim native host. Scratch nested helpers/specs/output are deleted.
- **Nested ancestor bypass confirmed:** with chat/intermediate/generated PIDs 81285/81319/81322, an opaque generated frame sent 73 `top.postMessage` calls directly to chat. Chat received all 73 over 87.90 ms; intermediate received zero. Thus intermediate sender/payload/rate validation cannot protect chat from a descendant targeting the top window. No 200,000-message ancestor flood was repeated: the direct-chat queue failure was already measured. The ancestor route became part of the retained flood regression; the final guest host below changes its top window to the guest intermediate. The bypass scratch case/output is deleted.
- **Final host: one hardened `<webview>` guest (2026-10-06).** Enabled `webviewTag` only on a scratch probe BrowserWindow loading the real chat build; production Electron code is unchanged. Reused the already-registered standard/secure `droidex-favicon://canvas-webview/host` source in that scratch profile, with a handler refusing other URLs. `will-attach-webview` strips preload and forces Node/subframe Node off, context isolation/sandbox/web security on, guest webviewTag off; guest navigation/new windows are restricted. No guest preload or `sendToHost`: the measured channel is trusted snapshot polling with `webview.executeJavaScript`. Main console checkpoints instrument the flood; that diagnostic channel is not the production bridge. Element polling was exercised for start, Hey and input/escape snapshots; bounded production polling through a deep queue remains Task 3 work. Task 3 must install the owning-window flag, attachment hardening, owned scheme and bounded polling/watchdog contract before accepting generated source.
- Initial guest runs had chat/guest/generated PIDs 11918/11922/11923 and 12338/12341/12342. Every run verified three distinct PIDs. Both sent exactly 200,000 `top.postMessage` messages to the guest, with zero direct chat receipts and no chat `render-process-gone`; no termination occurred for at least 10 seconds. `Received` is the last main-console 10,000-message checkpoint; the remaining queue is discarded during recovery, not fully drained:

| Guest recovery | Send ms | Received / checkpoint ms | Samples | Chat max / p95 ms | Main max / p95 ms | Recovery call ms | Both PIDs gone ms | Next chat ms |
| --- | ---: | --- | ---: | --- | --- | ---: | ---: | ---: |
| DOM `webview.remove()` | 278.90 | 20,000 / 7491.90 | 162 | 1169.32 / 1.90 | 120.08 / 1.73 | 4.69 | 29.24 | 0.91 |
| Main `forcefullyCrashRenderer()` | 280.60 | 20,000 / 7685.60 | 160 | 993.38 / 2.26 | 316.27 / 1.65 | 2.03 | 2037.26 | 1.59 |
| Retained 1 removal | 273.70 | 20,000 / 7353.90 | 164 | 1002.10 / 2.04 | 139.99 / 1.36 | 2.97 | 27.88 | 1.35 |
| Retained 1 crash | 277.00 | 20,000 / 7350.20 | 163 | 758.36 / 1.74 | 430.75 / 1.30 | 0.611 | 2047.45 | 1.74 |
| Retained 2 removal | 274.80 | 20,000 / 7577.10 | 159 | 889.67 / 2.11 | 291.60 / 1.37 | 2.61 | 17.72 | 0.88 |
| Retained 2 crash | 274.60 | 20,000 / 7655.70 | 158 | 1137.52 / 1.85 | 158.82 / 1.23 | 2.29 | 2046.21 | 2.41 |
| Retained 3 removal | 314.10 | 20,000 / 8323.70 | 158 | 581.39 / 2.11 | 614.85 / 1.55 | 2.93 | 16.15 | 0.86 |
| Retained 3 crash | 282.90 | 20,000 / 7803.80 | 160 | 1154.83 / 1.60 | 178.44 / 1.08 | 0.623 | 2048.03 | 2.26 |
| Focused repeat removal | 452.30 | 10,000 / 6277.30 | 139 | 1905.77 / 2.56 | 314.97 / 2.08 | 3.85 | 17.12 | 0.85 |
| Focused repeat crash | 302.20 | 20,000 / 9102.70 | 144 | 1420.56 / 2.04 | 95.81 / 1.59 | 0.689 | 2043.17 | 3.01 |
| Final concurrent removal | 265.80 | 20,000 / 7350.40 | 164 | 1178.53 / 2.42 | 75.62 / 1.61 | 3.48 | 27.99 | 0.88 |
| Final concurrent crash | 276.20 | 20,000 / 7384.10 | 163 | 1219.03 / 2.54 | 79.11 / 1.55 | 0.536 | 2038.26 | 1.63 |

- Earlier guest rows sample chat then main; the final pair starts independent requests concurrently from Playwright. Final PIDs: chat/guest/generated 96651/96653/96654 and 96905/96907/96908. Chat PID remained unchanged, with zero direct messages and no chat `render-process-gone`. Removal destroyed guest webContents; forced crash kept it crashed and emitted guest `render-process-gone` (`reason: killed`, `exitCode: 2`). Actual preferences confirmed every requested unsafe flag was clamped and preload removed. Electron 39's preference inspector is exposed at runtime but omitted from its public type declaration; the test uses a narrow runtime guard, not a production API requirement. An initial supplemental typecheck caught that mismatch; the guarded version passed.
- Retained suite runs passed 3/3 in 30.4 / 31.1 / 30.2 / 30.0 s; focused guest repeat 1/1 in 27.3 s. C1/C3 still exercise the already-proven opaque iframe primitive; Task 3 must repeat CPU/heap watchdogs through its production guest boundary. Their four guest-suite memory controls reported 3,904 MiB payload; observed RSS 2988.23 / 2978.78 / 2858.08 / 2889.88 MiB; frame death 1410.94 / 1400.39 / 1345.14 / 1279.93 ms; maximum chat responses 3.61 / 8.04 / 46.49 / 4.64 ms; next responses 0.59 / 0.64 / 0.91 / 0.54 ms. All retained the chat PID, with no chat `render-process-gone`.
- **Guest DOM composition PASS**, four saved PNGs inspected and deleted: 2000×1400 pixels / 1000×700 CSS / 2× capture scale. Baseline painted guest (100,100)–(300,300), internal 40×40 marker (200,200)–(240,240). Wrapper `translate(40px,30px) scale(0.5)` produced guest (140,130)–(240,230) and 20×20 marker (190,180)–(210,200): content scaled, not merely cropped. The DOM 50%-blue overlay painted above both; decoded PNG colors changed red (234,51,35)→(117,25,140), marker (117,251,76)→(58,125,161). Those are raw profile-encoded pixels, not CSS color values. `overflow:hidden` on a 100×100 parent clipped guest to (100,100)–(200,200), with no marker beyond the clip. No main-owned bounds updates were used for these transformations.
- **Guest input PASS after compositor readiness:** Interact generated counters pointerdown=1, wheel=1; committed transparent Select overlay pointerdown=1, wheel=1, with generated counters unchanged. Fresh Select also got 1/1 with generated 0/0. A transition probe observed `gestureScrollBegin`, `gestureScrollUpdate`, `gestureScrollEnd`, then Select got 1/1 and guest remained 1/1. Initial scratch input cases sent input before committing overlay hit-test state and failed the wheel assertion; waiting for two host animation frames corrected those cases. Mid-active physical trackpad gesture switching remains unverified; Task 5 must own it explicitly.
- **Guest Hey/escapes PASS:** exact source plus React/bootstrap 193,971 bytes; real host mouse click changed “Get started”→“You're all set”, label polled through the guest element API. Button bounds in generated CSS coordinates (0,0), 81.9453125×21.5. Generated parent DOM/cookie/storage/top navigation raised `SecurityError`; fetch rejected, WebSocket/Worker errored, popup null. No guest preload was installed. Visual/input/Hey/escape scratch suite passed 3/3 (10.7 s); flood scratch suite passed 2/2 (26.5 s). All owned Electron/sidecar/guest PIDs were gone after finally cleanup.
- The final guest boundary meets the external 3-second response contract and has maxima comparable to the workload-sensitive native-host runs above, while DOM scaling, clipping and overlays work. Retained C2 uses the guest only and covers DOM removal plus main crash after a 10-second ancestor flood. Deliberately unsafe preload/Node attributes are stripped and actual guest preferences checked. There is no native-view or ordinary-iframe fallback. Canonical source, the compiler recommendation and Task 1b bindings stay as recorded; x64 and packaged execution remain unverified.
- Memory: 64 MiB packed-double array payload blocks allocate until the frame's heap fails, rather than unbounded ArrayBuffer pressure on the whole machine. Final observed payload 3,904 MiB; external `ps` sampling from the Playwright process reached 3,997.33 MiB RSS. Only frame PID died, host PID unchanged, no host `render-process-gone`; the last two retained runs observed death after 1,194.32 / 1,640.62 ms, maximum host round trips 20.64 / 3.34 ms, and next responses 0.70 / 0.94 ms. Earlier integer-array stress runs also preserved the host (worst round trip 596.44 ms), but their allocation counts assumed an 8-byte representation and are not physical memory measurements. The original unbounded typed-array variant was replaced with repeatable natural heap exhaustion and external RSS measurement.
- Hung-frame capture (scratch probe): main-side `webContents.capturePage` returned a nonempty 8,616-byte PNG in 25.52 ms under the 6-second external deadline; host's next response 1.21 ms. This proves a bounded compositor capture, not a fresh frame paint or sleeping-display availability. Exact Hey source compiled offline and its real iframe button changed from “Get started” to “You're all set”; complete executable artifact 193,998 bytes.
- Compiler cold = fresh worker/API/service initialization with warm filesystem caches; five separate warm `build` calls, no persistent esbuild context. Both esbuild variants 0.24.2, MIT; React/React DOM 19.2.7. Final measurements (ms):

| Worker operation | Cold | Five warm runs | Warm median | Artifact bytes |
| --- | ---: | --- | ---: | ---: |
| Native esbuild 0.24.2 | 21.81 | 6.53, 5.17, 6.18, 4.91, 5.29 | 5.29 | 9,425 |
| esbuild-wasm 0.24.2 | 265.14 | 53.44, 44.93, 51.30, 37.79, 52.02 | 51.30 | 9,425 |
| Tailwind 3.4.19 / PostCSS JIT | 99.69 | 10.75, 9.66, 7.94, 8.69, 8.75 | 8.75 | 10,210 CSS |

- Hey has no utility classes: Tailwind measured preflight, not a class-heavy board. Earlier measurements under concurrent probing were native 397.98 / 4.37 ms, WASM 210.89 / 42.23 ms, Tailwind 191.23 / 8.44 ms (cold / warm median); timing is workload-sensitive, not an architecture-wide guarantee.
- **Recommend native esbuild:** approximately 9.7× faster warm in the final sample, and smaller. Resource bytes (uncompressed; worker entry, curated fonts/assets and package/signing overhead excluded):

| Resources | arm64 native | x64 native (size only) | WASM |
| --- | ---: | ---: | ---: |
| Native binary / `esbuild.wasm` | 9,750,242 | 10,432,176 | 11,907,565 |
| API, launcher, manifest, compiler license | 90,297 | 90,297 | 102,491 |
| Common React/runtime/Tailwind/CSS/license assets | 2,498,795 | 2,498,795 | 2,498,795 |
| Total | 12,339,334 | 13,021,268 | 14,508,851 |

- Exact proposed resource paths and constituent sizes are in spec §6. Relocated bundled Tailwind (2,290,150 bytes + 1,451 legal + 7,805 preflight CSS) ran without checkout module resolution; standalone React/DOM/JSX runtime is 193,959 bytes. Unbundled Tailwind/PostCSS dependency closure was 73 resolved package directories / 11,489,922 bytes, so do not ship the whole checkout tree. Native/WASM compiler services were gone after the scratch worker parent's shutdown; worker termination alone is not evidence of production cancellation cleanup.
- Packaging inspection: esbuild is a **devDependency** only; the sidecar's esbuild CLI builds `sidecar/dist` but no runtime compiler; Electron's `extraResources` includes only that directory. None of these compiler assets ships today. No packaging changes were made. Sonatype was unavailable; no security verdict is claimed.
- **arm64 development runtime verified; packaged runtime and x64 execution unverified.** Unsupported-import diagnostics, huge DOM pressure, four-live-preview scale, sleeping-display capture and in-process compiler timeout cleanup remain Task 3/12 work. Unticked compound checklist items above still include those unverified/undelivered portions.
- **Lease binding (Task 1b):** live Droid/Claude/Codex sessions with a scratch per-session probe server. Delayed mutation after Stop (12 s), steer during a pending call, and close/resume replacement during a 15–30 s pending call all refused the stale lease on every harness, create and resume; concurrent sessions never crossed. Stale-read replay returned the newer lease on Droid and Claude from the endpoint alone; Claude binds reads via a session-local `PreToolUse` tool-use ID, Codex via native turn ids, Droid has no turn discriminator. Native Droid `Task` subagent did not discover the tools; DROIDEX `child.open` forwarding unverified live. Codex URL forwarding (flat dotted `config` key) worked on start and resume but is not the chosen path. Nothing from this probe was committed.

## Task 2: Durable workspace and revision-safe commands

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/02a-canvas-contracts`: Define limited Zod contracts in sidecar Canvas `protocol.ts`/`schema.ts` and mirror `src/features/canvas/protocol.ts`.
  Done: One serialized-fixture test passes against both boundaries, including rejected invalid inputs.
- [x] `canvas/02b-canvas-workspace`: Implement `CanvasWorkspace.ts` and `canvasFiles.ts` with atomic commits, CAS and persisted mutation IDs.
  Done: Fault-injection and reopen tests preserve complete heads and reject stale or revoked writes.
- [x] `canvas/02c-canvas-bridge-commands`: Wire `canvas.*` commands/events through sidecar protocol, bridgeServer, droidexPaths and `src/types/bridge.ts`, including attachments and renderer sequence handling.
  Done: Correlated commands persist attachments; duplicate events are ignored and gaps request a snapshot.

**Files:** Create `sidecar/src/canvas/{protocol.ts,schema.ts,CanvasWorkspace.ts,canvasFiles.ts,CanvasWorkspace.test.ts,canvasFiles.test.ts}` and `src/features/canvas/protocol.ts`. Modify `sidecar/src/{protocol.ts,bridgeServer.ts,droidexPaths.ts}` and `src/types/bridge.ts` at their existing command/event boundaries. There is no current `sidecar/src/schema.ts`; Canvas input validation belongs in the new feature schema and its dispatch boundary. Keep all wire consumers in the same change.

**Interfaces:** `CanvasWorkspace.open(directory: string): Promise<CanvasWorkspace>` loads current state. Instance methods: `snapshot(canvasId: string): CanvasSnapshot`, `create(scope: CanvasScope, input: CreateFramesInput): Promise<CanvasFrame[]>`, `write(scope: CanvasScope, input: WriteFilesInput): Promise<WriteReceipt>`, `arrange(scope: CanvasScope, input: ArrangeFramesInput): Promise<CanvasChange>`, `readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles>`, `close(): Promise<void>`. Add `createCanvas(): Promise<CanvasSnapshot>`, `listCanvases(): CanvasSummary[]`, `attach(appSessionId: string, canvasId: string): Promise<void>` and `detach(appSessionId: string): Promise<void>` here; they own explicit attachment persistence. Scope validation is mandatory on mutations; read authorization is enforced at IPC/MCP entry points before calling internal read methods.

Changed by 02b (landed in `sidecar/src/canvas/{CanvasWorkspace.ts,canvasFiles.ts,canvasManifest.ts,canvasError.ts}`):

- `CanvasWorkspace.open(directory: string, deps: CanvasWorkspaceDeps)` takes the two callbacks Task 4 owns, `isScopeActive(scopeId)` and `bindScopeCanvas(scopeId, canvasId)`, plus an optional filesystem seam that defaults to `node:fs/promises` and exists so the fault tests reach the real persistence boundary.
- `create` returns `CreateFramesResult = { canvasId, frames }` instead of `CanvasFrame[]`: an unattached chat's first create mints the canvas it is now attached to, and the frames alone cannot name it. The DTO is mirrored to the renderer.
- `attachedCanvasId(appSessionId): string | null` reads the persisted attachment, which `beginCanvasTurn` needs when a turn starts. Attachments live in the owning canvas's manifest, as spec §7 states, so an unattached create commits the canvas and the attachment in one write; moving a chat between canvases writes two manifests, and a crash between them leaves the chat unattached rather than attached twice.
- `invalid_input` was missing from `CanvasErrorCode` and is now part of it on both sides of the mirror. The workspace reports an unknown canvas, design or revision, a merged revision over its limits, a reused mutation ID and an unsupported seed with that code; a lease that is settled, names a canvas the workspace does not hold, or does not cover a frame reports `scope_expired`; a layout compare-and-swap failure reports `revision_conflict`. Storage failures report `storage_failed` with a recovery sentence and never a path.
- A lease restricted to named designs may change those frames and may not add new ones.
- Mutation receipts track scope liveness and bounded history. Each record carries the `scopeId` that issued it and a sha256 digest of its command's canonical arguments; the same ID with the same digest answers the original result and the same ID with a different digest or a different command is `invalid_input`. A record whose turn scope is still active is never retired, so its retry always finds the receipt. A pane retry can use a retained receipt under a fresh scope while its chat remains attached. Records with inactive scopes give way oldest first past 256; an ID no longer found is treated as a new request. Nothing retires an unsettled record: past 4096 of them on one canvas the ledger refuses the new mutation with `storage_failed` ("too many unsettled mutations") instead, because retiring one would let its retry run a second time. Settled records still give way, so the refusal clears as turns finish or are interrupted.
- A retained arrange keeps only what it acknowledged, `{ sequence, placements: [{ designId, layoutVersion, rect }] }`, which bounds the manifest at a measured 8.37 MiB for the worst legal history (256 records of 256 frames; 18.17 MiB for full frame records). A retried arrange answers the original sequence and the original layout, while a frame's other fields show the current head; the renderer's sequence handling (02c) discards a change older than its projection.

- A manifest write that fails anywhere past its rename may still have landed, so the head on disk is reread before any further commit on that canvas, and the flushes that save still owed are redone: reading a head back proves it is visible, not that it is durable. A canvas whose head cannot be reread, or whose directory entry cannot be flushed, is held damaged until the workspace is reopened, and the original failure is still reported as a failure. A damaged canvas keeps the attachments it has on disk: `attachedCanvasId` still answers with it, so the chat waits for recovery with `storage_failed` on every mutation, including `detach`, rather than being handed a second canvas and ending up attached twice. A commit whose canvas was never created in the first place is the one case that holds nothing back, because there is nothing on disk to recover. `damagedCanvasIds()` lists what the workspace holds but will not serve, both from a damaged load at open and from a failed reread.
- The last lease check runs inside the commit owner with the replacement manifest already written and flushed, immediately before the rename. An unattached chat's canvas binding is filled exactly once, recorded only after the registry callback returns, and only while the lease is still active: a binding the registry refuses has not happened, so the retry that answers the receipt attempts it again, and a lease revoked after publication leaves a complete attached canvas with no binding, since nothing it could authorize is left. A lease minted without a canvas keeps the one its first create made: a later create under it extends that canvas, and it can neither follow its chat to another canvas nor bootstrap a replacement for one the chat has left (`scope_expired`). `create` reads the manifest it extends inside the commit, so concurrent creates place frames in sequence and answer their own retries.
- `close()` resolves once every admitted mutation has settled, staging included; a mutation admitted after it fails with `storage_failed`.
- Canvas storage flushes every directory it creates, leaves before parents, because a file's own flush does not persist the entry its directory holds. That includes the storage root's own entry in the profile directory, flushed when the root is created. Every file is opened with `O_NOFOLLOW` and every directory the writer creates, descends into, or deletes from is checked, so neither a read, a write, nor the staging cleanup on open crosses a link under the root; a linked ancestor marks that canvas damaged. The root and its parent belong to the user's profile and may legitimately be links.
- Source paths collide on their folders as well as their names: `ui/A.tsx` and `UI/B.tsx` address one directory on the filesystems Canvas storage sits on, and one name cannot be both a file and a folder. The rule runs on a write and again against the merged revision.
- `canvasHeads.ts` owns which manifest is current, the damaged set, and the rule that a replacement is durable before it is visible. `canvasFrames.ts` owns turning one `canvas_create` into the designs a commit appends: an identity and any seeded source per frame, prepared before the commit owner runs, and the placement, which is decided against the manifest being extended. `canvasLeases.ts` owns what a turn's lease authorizes and the canvas an unattached lease bootstrapped.
- Build state is a derived cache, so nothing persists it and every frame projects `{ status: 'pending' }` until Task 3 owns the build registry.
- A manifest that fails validation is logged and left untouched on disk, and the workspace opens without that canvas: repairing it here would be a guess, and one damaged board must not keep the others closed. The explicit recovery action spec §7 asks for still belongs to a later task.
- "Emit" in the commit order is the value each mutation returns; broadcasting it as a sequenced `canvas.*` event belongs to 02c, which adds the subscription seam.

Changed by 02c (landed in `sidecar/src/canvas/{canvasBridge.ts,canvasScopes.ts}`, `src/features/canvas/{client.ts,applyCanvasChange.ts,wireValidation.ts}`):

- `CanvasScope` is a union discriminated by `origin`. A `'turn'` lease is the shape above; a `'user'` scope is one pane mutation, authorized by the chat's attachment, and carries neither `generation` nor `context` because it has no turn behind it and names its targets in the request. Inventing a pinned design system for it would be a fabricated default, and the workspace reads neither field. `CanvasScope` is still absent from the renderer mirror.
- `canvasScopes.ts` is the registry behind `CanvasLeaseRegistry`: `register`, `revoke`, `get`, plus the registry's own `isScopeActive`/`bindScopeCanvas`, which are the methods rather than aliases of them. The bridge registers a scope it minted itself for one mutation and revokes it in `finally`; a request naming a canvas its chat is not attached to is `scope_expired` before anything is minted. Task 4 registers each turn's lease in the same place.
- `createCanvas(appSessionId: string)` replaces `createCanvas()`: spec §6 asks explicit Create to commit the canvas and the attachment together, which two commits cannot do. The chat leaves its previous canvas first, so a crash between those writes leaves it unattached rather than attached twice.
- `CanvasWorkspace.changes` is the subscription seam, a `CanvasChangeFeed` published to with each committed `CanvasChange` once the commit lock has moved on and still in sequence. A retried mutation answers its receipt and publishes nothing; `close()` releases the subscribers.
- `bridgeServer` exposes only `broadcast`, so `canvas.change` carries its `canvasId` and the renderer drops a canvas it does not project. The sidecar keeps the set of canvases some client is watching, so an agent's work on a canvas nobody has open is not broadcast at all.
- `canvas.subscribe` is answered by a `canvas.snapshot` event, not a `canvas.result`: the snapshot and the watch are one step. Everything else answers `canvas.result { requestId, ok, reply | error }`, where `CanvasReply` is a union with one kind per command rather than a bag of optional fields. `canvas.list` answers in its own reply; `canvas.summaries` is broadcast after `createCanvas`/`attach`/`detach`/`create`, the commands that change what another window would see.
- `shutdownSidecar` gained a `shutdownCanvas` stage after the sessions, because an agent's Canvas mutation runs under one.
- `requireAttachment` covers every pane mutation, not only a bootstrap lease, and `requireScopedCanvas` calls it, so the workspace's final commit gate refuses a write whose chat detached while that write was still staging its source. A turn lease pinned to a canvas when it was minted still keeps that canvas wherever its chat goes.
- A pane scope's ID is minted by the bridge (`user:<uuid>`), never taken from the request: a `scopeId` the client could name shares the registry with turn leases, and naming a revoked one would revive it. `requestId` correlates a reply and nothing else, and it now shares the canvas identifier rule so the sidecar and the renderer validator hold one 128-character bound.
- `bridgeServer` passes the renderer `pageId` into `onCommand` and exposes `onPageGone(listener)`. Watches are a set per page: a canvas no page has open is not broadcast, one page closing its pane cannot silence another, and a page that reloads or closes takes its watches with it. `canvas.subscribe`/`canvas.unsubscribe` need a page identity, as `voice.start` already does, and a subscribe captures its page before awaiting the workspace so a watch is never installed for a page that left during that await. `Bridge.onReconnected` is the renderer's own notification, fired after every readmitted socket including a same-generation replay resume, because that resume publishes no event of its own; the Canvas client re-watches every board it holds from there, which also closes the changes it missed while the socket was down.
- A change listener that throws loses its change, not the commit and not its siblings.
- The renderer queues changes that arrive while a snapshot is in flight rather than dropping them: a snapshot is taken before they commit. The queue keeps the newest 256, so an overflow shows as the gap that asks for another snapshot. Each board carries a generation that an in-flight request revalidates after every await, so a dropped subscription's late answer cannot roll back the board that replaced it or release its slot.

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
assert.equal((await workspace.readFiles(canvasId, first))['main.tsx'], input.files['main.tsx']);
```

- [ ] Add the Review Focus failure cases: reopen after process termination on either side of the manifest rename; write/rename failure leaves the last head intact; rejected writes do not poison mutation IDs; two concurrent writers accept only one source head; layout updates do not conflict with source writes; revoke a scope during an awaited file write and reject publication. Use controlled promises/filesystem fault injection at the real persistence boundary, not sleeps or source-text assertions.
- [ ] Implement renderer sequence handling: ignore older/duplicate changes; request a new snapshot on a gap. UI optimistic geometry may be transient but reconciles to acknowledged layout versions. Retain source/attachments across provider identity changes and detach chat deletion without deleting canvas files.
- [ ] Run `rtk proxy node --import tsx --test sidecar/src/canvas/CanvasWorkspace.test.ts sidecar/src/canvas/canvasFiles.test.ts`, then app/sidecar typechecks and `npm run quality:boundaries` through RTK. Review data-loss and shutdown paths before considering the task complete.

## Task 3: Incremental compiler and isolated live previews

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/03a-compiler-worker`: Implement `compiler.ts`, `compilerWorker.ts`, initial `designSystems.ts` and `presets/droidex.ts`, with virtual resolution and an import allowlist.
  Done: Fixtures compile working stateful React and reject bad source, unsupported imports and path escapes.
- [x] `canvas/03b-build-queue`: Implement `CanvasBuilds.ts` with two slots, coalescing, a 15 s deadline, `canPublish`, last-working artifacts and persisted outcomes.
  Done: Controlled-promise tests reject stale publication and release every slot and waiter once.
- [x] `canvas/03c-preview-guest-host`: Enable app-window `webviewTag` and §6 attachment hardening, owned privileged scheme/trusted intermediate, `previewDocument.ts`, `previewRuntime.ts` and `DesignPreview.tsx`.
  Done: Bounded pull polling and main-owned watchdog/termination pass Electron smoke through the production boundary.
- [x] `canvas/03d-compiler-packaging`: Promote the sidecar runtime dependency and package `extraResources` under `sidecar/canvas-runtime` per §6 with `ESBUILD_BINARY_PATH`.
  Done: Offline packaged tests verify arm64/x64 resources and a working saved design; run `docs:generate` when scripts change.

**Files:** Create `sidecar/src/canvas/{CanvasBuilds.ts,compiler.ts,compilerWorker.ts,designSystems.ts,CanvasBuilds.test.ts,compiler.test.ts,designSystems.test.ts}`, the initial `sidecar/src/canvas/presets/droidex.ts`, and `src/features/canvas/{previewDocument.ts,previewRuntime.ts,DesignPreview.tsx}`. Modify `sidecar/package.json`, `electron-builder.config.cjs` and the Task 1 runtime test. Change `electron/main.cjs`/preload only for the proven host's narrow needs; generated code receives no preload.

**Interfaces:** `compileDesign(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign>` lives in the compiler worker. `CompileInput = { designId: string; revisionId: string; generation: number; files: SourceFiles; designSystem: DesignSystemRef }`. `CompiledDesign = { artifactId: string; html: string; diagnostics: CanvasDiagnostic[]; elements: SourceElement[] }` uses the Task 2 element DTO; Task 8 adds the instrumentation that populates it. `CanvasBuilds.enqueue(canvasId: string, receipt: WriteReceipt): void` coalesces per-design jobs; `cancelCanvas(canvasId: string): void` and `close(): Promise<void>` own cancellation/cleanup. `DesignPreview` consumes one frame/artifact and reports bounded preview events, never a provider/session object. Establish the `DesignSystem`, `readDesignSystem` and `saveDesignSystem` contracts specified in Task 7 here so compilation and Task 4 theme tools have a working default kit before the picker and additional presets arrive.

Settled by 03a (landed in `sidecar/src/canvas/{compiler.ts,compilerWorker.ts,designBundle.ts,designStylesheet.ts,designSystems.ts,presets/droidex.ts}`):

- `compileDesign` resolves only with a usable artifact. A source failure rejects with `CompileFailedError`, whose `diagnostics` are the safe ones to show; cancellation rejects with `CompileCancelledError`; a dead or terminated worker rejects with `CompilerUnavailableError`. `CompiledDesign.diagnostics` therefore carries warnings only. The signature in this task is unchanged.
- Diagnostic codes are `syntax_error`, `unsupported_import`, `missing_module`, `missing_default_export`, `css_error`, `missing_design_system` and `compile_failed`. A `file` is only ever a design path or `@droidex/design-system/<path>`; anything located outside the virtual tree is logged and reported as `compile_failed`.
- The compiler runs as a forked process, not a worker thread. `esbuild.stop()` kills its service child without exposing it, and libuv reaps a child only through the loop that spawned it, so a terminated worker thread left that service `<defunct>` for the sidecar's whole life on both the graceful and the crash path. A forked compiler is owned and reaped by the sidecar's own loop, and the service it orphans is reparented to init and reaped there. `CompilerWorker` keeps its surface: it starts the compiler on first use, replaces it after a crash so one bad revision cannot disable the session, and `terminate()` is final, so 03b constructs a new client after an overdue-compiler kill. 03b can take the deadline kill from the child's own pid.
- Measured on the same machine as the Task 1 figures (Apple M4, macOS Darwin 25.6.0, arm64, Node 22.22.3). Through the development loader: cold 313–329 ms, warm median 32–36 ms, for both a trivial fixture and the kit's own example. Forking the built entry with no loader: cold 200–265 ms after the first run. The worker-thread model measured 241–257 ms cold and about 30 ms warm on the same fixtures, so a process costs roughly 80 ms of cold start and 4 ms warm, against a service process that is now always reaped.
- For Task 3d: the compiler is forked with `process.execPath`, so a packaged sidecar needs `ELECTRON_RUN_AS_NODE` in the child's environment, and `execArgv` is empty because the compiler picks its own loader.
- The bundler and the stylesheet are separate owners (`designBundle.ts`, `designStylesheet.ts`) because the import allowlist and the Tailwind pipeline share nothing but their inputs. Both live under the worker; nothing else imports them.
- `build:compiler-worker` keeps `esbuild`, `tailwindcss` and `postcss` external, and the worker resolves `react`/`react-dom` from its own directory (`sidecar/src/canvas` in development, `sidecar/dist` once built). Task 3d supplies all five beside `sidecar/dist` and repoints that one directory; nothing else in the worker needs to change. Bundling Tailwind instead fails, because its preflight loader reads `__dirname`.
- The artifact is one HTML document with the stylesheet and the minified bundle inline, mounted into `#canvas-root`, with `data-mode` on `<html>`; both modes' tokens are emitted so switching mode is an attribute change, not a rebuild. `artifactId` is the sha256 of that document.
- CSS is untrusted input that reaches a code loader: Tailwind resolves `@config` against the stylesheet's file location and then requires it, and PostCSS adopts that location from an inline source map. Every loading at-rule (`@config`, `@plugin`, `@import`, `@use`, `@forward`) and every non-`data:` resource reference is refused before PostCSS parses for real, source maps are off, and the Tailwind configuration is passed inline so none is ever read from disk. `unsupported-dynamic-import` and `unsupported-require-call` are esbuild errors, so no module loader survives into an artifact.
- Adding the compiler runtime took the sidecar lockfile audit from 5 findings to 12 (+5 high, +2 moderate), all through the Tailwind 3 graph (braces, chokidar, fast-glob, micromatch, postcss-nested, postcss-selector-parser, tailwindcss). It is the same tree the root `package.json` already carries at the same version. Task 3d owns the dependency review; `sonatype-guide` was unavailable here too.
- A symbolic link anywhere inside Canvas storage is refused, by `canvasFiles.ts` for canvases and by `designSystems.ts` for kits; the storage root itself is configuration, because `DROIDEX_USER_DATA_DIR` is how a second instance relocates it, so a link there is followed by design. Each kit save also flushes its whole directory chain rather than only the entries it created, so one writer never acknowledges a version resting on a directory another writer has not flushed.
- The virtual source tree never touches the real filesystem. esbuild expands a template-literal dynamic import with a static relative prefix into a glob and lists the importer's resolve directory underneath plugins, so every virtual file claims a directory that is never created, and the supported packages are resolved to absolute paths by the plugin rather than through node resolution from a virtual importer. A glob esbuild synthesised is refused like any other non-literal import.
- Indirect `require`, `require.resolve`, `import.meta.resolve`, `new Function` and `globalThis['require']` are runtime behaviour inside the sandboxed preview, not compiler concerns: the allowlist bounds what is bundled and which paths the resolver may touch, and the webview CSP and the no-network boundary own what can be loaded at run time. esbuild's `__require` shim throws in a browser. Task 3c must not put `unsafe-eval` in the preview CSP. A design importing its own `./x.css` stays inside the tree and remains supported.
- CSS resources are reviewed on the parsed value rather than on its text, both as authored and with CSS escapes decoded, and once more over Tailwind's generated CSS, because a utility with an arbitrary value is written in the TSX and appears nowhere else. Only `data:` resources are accepted until Task 7 adds owned image references.

Settled by 03b (landed in `sidecar/src/canvas/{CanvasBuilds.ts,canvasBuildCache.ts,canvasCommits.ts}`):

- `CanvasBuilds` is the only owner of a design's build state. `canvasManifest.ts` projects
  `CanvasFrame.build` from it through the one-method `BuildStates` port, so there is no second copy
  to keep in step, and a design the registry has never heard of is `pending`. `CanvasWorkspace`
  implements `CanvasBuildHost` (`buildTarget`, `readFiles`, `commitBuild`); nothing else reaches in.
- `CANVAS_LIMITS` did not carry the build limits after 02a, so 03b added them where the other
  spec §5 contracts live: `buildSlots: 2` and `buildDeadlineMs: 15_000`. Nothing hard-codes either.
- `write` enqueues inside the commit that makes the revision durable, right after `heads.install`,
  and a `create` whose frame is seeded from a saved revision enqueues there too: both arrive with
  source, so both are built the same way. That is what lets the change each publishes already say
  `pending` or `building` for the new revision instead of the previous revision's `ready` artifact
  (spec §4), and it is why neither publishes a second change of its own.
- **One commit owns an outcome.** A build's result reaches the canvas through `commitBuild`, which
  runs on the workspace's own commit queue beside `write` and `arrange`. Inside that one step, and
  nowhere else: the `canPublish` and lifecycle gate against the head as the commit finds it, the
  outcome file `builds/<revisionId>.json`, the recorded state, the `lastWorkingRevisionId` read
  from that same head, and the published frame. Only the content-addressed
  `builds/<artifactId>.html` is written beforehand; an orphan there is harmless and unreferenced.
- The gate runs again after the outcome file is written, because `cancelCanvas`, `requestRebuilds`
  and `close` all run outside the commit queue and any of them can take the frame while that write
  is in flight. A result that has lost it unlinks the file it just placed and settles silently: the
  replacement's own commit is already behind this one in the queue and writes its own outcome. That
  is the only way a restart cannot be handed an abandoned success.
- **The deadline bounds compilation only.** It starts when the compile does and is released the
  moment the compile settles, so saving and publishing — bounded by storage failure handling like
  every other workspace write — can never be read as an overdue build, and no process is ever ended
  for a build that had already finished.
- Build state is keyed by canvas and design: two manifests may hold the same design ID, and sharing
  one entry would have them share a generation counter and overwrite each other's outcomes.
- `requestRebuilds` holds no sweep mark and may be called on every read. The head decides, never
  the caller's projection: a frame whose revision has moved on since that snapshot is left alone,
  so an old projection cannot erase a current `ready`. Coalescing makes the repeat cheap.
- A `cancelled` frame is rebuilt by the next read of its canvas, the same as a `pending` one: both
  mean nothing has been built for the current revision, and a detach that cancelled a board's
  builds would otherwise leave its frames stuck until Task 5's Retry ships.
- A build transition commits the manifest to take the next change sequence. The renderer drops a
  change whose sequence is at or below its projection (`client.ts`), so an in-memory sequence would
  make build changes invisible; the commit is also where `ready` persists the last-working pointer.
  A commit refused because the workspace is closing is the expected shutdown path and is not logged.
- `PersistedDesign` gained a required `lastWorkingRevisionId` (spec §7). `CANVAS_MANIFEST_VERSION`
  stays 1: Canvas has never shipped, so there is no old manifest to read and no migration to add.
  `failed` reports that pointer; `ready` advances it; nothing else writes it.
- `canPublish` is the plan's predicate verbatim. Its `job` parameter is typed as the three fields it
  reads (`designId`, `revisionId`, `generation`), which `CompileInput` satisfies, so the running job
  can be passed directly. `generation` is a per-design attempt counter owned by this registry.
  Beside the predicate, every publication revalidates the lifecycle after each await: the registry
  is open, the job still holds its slot, and the canvas and frame are still there.
- Diagnostic codes 03a did not need, all produced by the queue rather than the compiler:
  `build_timeout` (the overdue message names `CANVAS_LIMITS.buildDeadlineMs`), `compiler_unavailable`
  (one fixed recovery message, never the worker's own text) and `storage_failed` (canonical source
  that cannot be read, or an artifact that cannot be saved). A failed build keeps at most
  `MAX_BUILD_DIAGNOSTICS` (64) of them, which is also the bound the cache schema enforces.
- Derived cache layout per canvas: `builds/<artifactId>.html` and one outcome per revision at
  `builds/<revisionId>.json` (`{version, designId, revisionId, result}`, revalidated on read).
  Both go through `canvasFiles.ts`'s flushed write-and-rename, `removeTemporaries` now sweeps
  `builds/*.tmp`, and a build superseded while it was saving can leave an orphan entry: spec §7
  keeps derived-cache cleanup bounded and out of this release.
- **The cache never decides whether an outcome is valid; the manifest does.** On restore a `ready`
  outcome is served only when the design's `lastWorkingRevisionId` is that same revision and the
  artifact document is there, and a `failed` one only for the revision the frame currently holds;
  a published `ready` set that pointer in the same commit, so an outcome whose commit never
  happened can never match it however the cleanup of its file went. Taking an abandoned outcome
  file back stays best-effort hygiene rather than something publication correctness rests on.
- The cache keeps only an outcome that is a function of the source: a `ready` build and the
  compiler's own diagnostics. A failure of the attempt rather than the design — `build_timeout`,
  `compiler_unavailable`, `storage_failed` — is live state and is never written, because some of
  them advise restarting DROIDEX and a restart that still showed them would make that a lie; the
  next open leaves the frame `pending` and the sweep retries. `canvasBuildFailures.ts` owns that
  rule beside the codes, so the publication gate needs no knowledge of either.
- `load` reads those outcomes when the workspace opens; anything the manifest does not vouch for
  leaves the frame `pending`, and so does one whose file cannot be read or parsed — a derived cache
  that refuses a read is a miss, never a reason a canvas with readable source fails to open. `requestRebuilds(snapshot)` is the on-demand
  recovery, which any read may call (`canvas.subscribe` today, after it has confirmed the page is
  still there, so a refused subscription schedules nothing). It queues the `pending` and
  `cancelled` frames that still have source, checked against the head. Missing cache is never an
  error.
- Each slot owns its own `CompilerWorker`, forked on that slot's first build, so the second process
  exists only once two builds overlap. An overdue build aborts its signal and then ends its own
  slot's process, which may be wedged inside single-threaded Tailwind where no signal is read; the
  build on the other slot is untouched, and the overdue slot forks a fresh process for its next
  build. A process that dies on its own rejects with `CompilerUnavailableError`, which fails that
  one job as `compiler_unavailable` and nothing else: 03a's client forks a replacement itself, so
  the slot keeps it. Nothing shared means no build is ever blamed for another design's hog.
- `cancelCanvas` drops that canvas's queued jobs, abandons its running ones and reports `cancelled`
  with the revision each was building, so a later reader's sweep asks for the work again. A
  superseded or cancelled compile never flashes `cancelled`: its rejection publishes nothing,
  because the state that replaced it is already the frame's.
- `shutdownCanvas` closes builds before the workspace, so a settling build still reports through the
  workspace and the workspace then waits for that commit. `close()` is idempotent, and it waits for
  the compiler terminations it has already started, including one an overdue build began.
- What 3c and Task 5 consume: `CanvasBuilds.readArtifact(canvasId, artifactId)` returns one ready
  artifact's HTML document or null when the cache has lost it; `frame.build` carries the
  `artifactId` to ask for, the diagnostics to show, and the `lastWorkingRevisionId` whose artifact
  is still on disk; `requestRebuilds` is what a new reader calls. How a preview receives that
  document is 3c's problem.
- A build transition commits only the manifest fields it owns. It records no mutation receipt and
  never touches the retry ledger, because a build is not a mutation and nothing can retry one; a
  commit it cannot make leaves the last-working pointer, the change sequence and the ledger exactly
  as they were on disk, and `canvasHeads.recover` rereads the head so memory follows disk (02b's
  rule). The frame keeps its derived state in memory and the pane reads it on the next snapshot.
- Keeping `CanvasWorkspace.ts` under 500 lines took two extractions, both cohesive owners rather
  than forwarding layers: `canvasCommits.ts` owns admission, one-at-a-time commits and publication
  after the lock moves on, and `canvasFrames.stageRevision` owns the revision tree a write stages,
  beside the `stageFrames` a create already staged there. `canvasBuildCache.ts` likewise owns the
  projection from its own files to a build state (`restoreStates`, `builtState`), which is where
  Task 8's element output belongs too. The slot scheduler was examined as a third owner and
  rejected: its members are all thin accessors over a two-element array, and splitting it from the
  state registry would give one invariant two owners with a callback seam between them.

Settled by 03c (landed in `electron/{canvasPreview.cjs,main.cjs,preload.cjs}` and
`src/features/canvas/{previewDocument.ts,previewRuntime.ts,DesignPreview.tsx}`):

- **The host contract.** `electron/canvasPreview.cjs` owns the guest end-to-end, the way
  `favicons.cjs` owns its scheme, and is free of `require('electron')`. It exports the scheme
  (`droidex-canvas-preview`, `standard` and `secure`, no `supportFetchAPI`), the one URL
  (`droidex-canvas-preview://preview/guest`), the CSP, the document, and the registry of guests main
  attached. `main.cjs` registers the scheme before `app.whenReady`, serves that one URL from the
  default session and answers 403 to every other, sets `webviewTag: true` on the app window only,
  and installs `will-attach-webview`/`did-attach-webview` before the window loads anything.
- **The CSP** is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data:; font-src data:; frame-src about:; connect-src 'none'; worker-src 'none';
  object-src 'none'; base-uri 'none'; form-action 'none'`. It travels as a response header rather
  than a `<meta>`, so no document surgery can drop it, and an `about:srcdoc` frame inherits it
  either way. Inline script and style are allowed because 03a's artifact is one
  inline-everything document; there is no `unsafe-eval`, per 03a's ruling.
- The guest keeps the **default session**. A dedicated in-memory partition was considered and left
  out: `connect-src 'none'` with no fetchable scheme is what bounds the network, the generated frame
  is opaque-origin and has no storage at all, and forcing a partition through
  `will-attach-webview` is not part of the measured decision in spec §6.
- **Who owns what inside the guest.** The intermediate's receiver, its bounded queue, and the
  reporter that runs inside the generated frame are all main-owned literals in
  `canvasPreview.cjs`: everything inside the guest arrives through the privileged scheme under the
  policy that document declares. The renderer owns only the two pull-channel literals in
  `previewDocument.ts`. The reporter is appended to the artifact as a trailing script element
  written with JS escapes, so the compiler's document stays byte-identical to the one its
  `artifactId` names.
- **The pull channel.** `globalThis.__droidexCanvasPreview.start({nonce, designId, revisionId,
  generation, html})` answers `'started'`, `'already_started'` or `'invalid_request'`; `drain()`
  answers one JSON snapshot and throws when the document was never started, which the runtime reads
  as a guest it no longer owns. Payloads are JSON arguments to fixed strings with `<` escaped to
  `\u003c`, so nothing the compiler or a design produced is interpolated as code. `start` validates
  the nonce against `^[0-9a-f]{32}$` because it is the one value embedded in script text.
- **Bounds.** Queue cap 64 events (a full queue drops and counts, never grows); message cap 4,096
  bytes of JSON; 8 diagnostics per message and 512 characters of text each. The renderer refuses a
  snapshot over 64 events or 64 KiB outright rather than trimming it. Poll cadence 100 ms with
  exactly one poll in flight per guest; poll deadline 3,000 ms, above the 1,906 ms a flooding guest
  measured in Task 1, so a guest over it is wedged rather than busy; ready deadline 10,000 ms, since
  the artifact is already built and only generated code that never finishes running takes longer.
- **The watchdog is two paths, both main's.** `canvas-preview-terminate` is a narrow preload IPC
  (`assertMainRenderer`, one safe integer): main ends the guest through the `webContents` it
  attached with `forcefullyCrashRenderer()`, which is synchronous and waits for no guest reply, and
  refuses an ID it never attached. Independently, main ends a guest on that guest's own
  `unresponsive` event with no renderer involved. Crashing the guest takes the generated frame's
  process with it, which is spec §6's requirement that main end the queue owner rather than only the
  generated sender. The renderer's cheap path is still removing the element, measured at 27.99 ms.
- **The event schema** is `ready`, `resize {width, height}`, `diagnostics [{code, message}]`, and the
  `selection {elementId, instancePath}` / `interaction {kind}` shapes Task 8 fills. The intermediate
  rebuilds each event field by field, so no getter, prototype or extra property from generated code
  travels, and `previewRuntime` drops `selection`/`interaction` until Task 8 owns them.
- **`canvas.readArtifact { canvasId, designId, revisionId }` → `{ artifactId, html } | null`** is the
  new bridge command, authorized like `canvas.subscribe` by the page asking rather than by a chat's
  attachment: an artifact is a projection of a canvas any page may watch. `CanvasBuilds.readArtifact`
  is rekeyed from `(canvasId, artifactId)` to `(canvasId, designId, revisionId)` and
  `canvasBuildCache.readRevisionArtifact` resolves it from `builds/<revisionId>.json`. The old shape
  could not serve a fallback at all: a `failed` frame carries `lastWorkingRevisionId` and no
  artifact ID, so one revision-keyed read now serves both a `ready` frame's own revision and a
  `failed` frame's fallback. A missing or superseded entry stays a miss, never an error.
- **Transport.** A realistic artifact was measured rather than assumed: the kit's stateful Hey
  design compiles to 209,305 bytes, and the `canvas.result` event carrying it is 214,401 bytes.
  That is under the batcher's 512 KiB flush threshold, far under the 8 MiB hard client-buffer
  disconnect, and four live previews hold 858 KB of the 32 MiB replay buffer, so no transport change
  was needed. One artifact can briefly put a client over the 512 KiB soft pressure mark, which is a
  reason Task 5's four-slot cap should not fetch four artifacts on one tick.
- **What Task 5 consumes:** `DesignPreview` takes one `canvasId`, one `CanvasFrame`, a
  `readArtifact` reader, an `onRefresh` that re-subscribes (which is what makes the sidecar's
  `requestRebuilds` run), and an optional `onResize(designId, size)`. It reports nothing else
  upward and never a session or provider object. Its Retry is the minimum that works; Task 5 owns
  the real one, the slot allocation, the board transform and the Select-mode overlay.
- **What Task 8 consumes:** the reporter is where a selection or interaction message is produced,
  the intermediate already accepts and bounds both shapes, and `previewRuntime.report` is the one
  switch that has to grow a case.
- **Verification.** The renderer's cadence, deadlines, staleness and validation are `node:test`
  suites with an injected clock and a fake webview whose `executeJavaScript` calls are controlled
  promises (`previewRuntime.test.ts`, `previewDocument.test.ts`); `electron/canvasPreview.test.cjs`
  holds the registry, the refusals and the CSP with fake `webContents`. The Electron smoke runs
  through the production boundary: `[C4]` mounts a deliberately unsafe `<webview>` in the production
  window, asserts the stripped preferences and three processes, starts a really compiled design with
  the production start script, clicks its button with a real pointer event through the guest's own
  widget and sees the resize come back, and watches the intermediate refuse an oversized message, a
  wrong nonce, an unknown shape and a message from the guest's own window while a loopback listener
  stays untouched; `[C5]` wedges a design, keeps polling the guest for 25 answers to show the guest
  is fine, and has main end it through the production IPC, releasing both processes.
  `withNetworkListener` moved into `canvasSmoke.ts` so `[C1]` and `[C4]` share one listener.
- **Not covered.** The board's own composition, transformed input and the Select-mode overlay are
  Task 5's (spec §4), and the smoke drives the guest from page-level scripts because no board exists
  to mount `DesignPreview` yet; the runtime's own deadline arithmetic is therefore proven by its
  unit suite rather than by the smoke.

Settled by 03c's first review cycle (Astra xhigh, adversarial, against `0b370915`):

- **ICE is not a fetch, and `connect-src` never governed it.** The reviewer reached a loopback STUN
  server from the production sandbox and received a datagram. `attach` calls
  `contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`, which closed that datagram path.
  `webrtc 'block'` was added to the CSP at the same time and **was never a second layer**: see the
  second cycle below, where it was removed. `[C6]` measures on a real `udp4` socket beside the stream
  listener, because a TCP-only listener cannot see ICE at all.
- The other non-CSP egress paths were checked in the same probe and all reach nothing: `<a ping>`
  (`ping-to` is a fetch directive, and `default-src 'none'` covers it), `navigator.sendBeacon`
  (`connect-src`), and `<link rel=dns-prefetch|preconnect|prefetch>` (a prefetch is `default-src`,
  and a bare DNS or connect hint carries no request the listener can count). WebTransport is a
  `connect-src` fetch. Speculation rules need a `script-src` nonce or hash this document never
  issues, and they can only name HTTP(S) documents, which `default-src 'none'` already refuses.
- **A design that stops running after it reported `ready` escaped both watchdogs.** The renderer's
  polls measure the intermediate, which stays responsive, and the design is a separate process, so
  neither the poll deadline nor `unresponsive` ever fires. Main now owns the design's liveness:
  `attach` probes `mainFrame.frames[0]` with the literal `'0'` every **2,000 ms** with one probe in
  flight and a **3,000 ms** deadline, and a probe that misses it ends the guest through the same
  `end(...)`. The question is a literal evaluated in the frame, never a heartbeat the design emits:
  that code is the attacker's. Probe timers are released on `render-process-gone`, `destroyed` and
  every `end`.
- **A lost `ready` artifact is the queue's problem, not a button's.** `requestRebuilds` sweeps only
  `pending` and `cancelled` frames, so a `ready` frame whose cached document was removed had nothing
  that would ever ask for it again. `CanvasBuilds.readArtifact` now queues that design when the miss
  is for the revision the head currently holds as `ready`, gated on the head exactly as
  `requestRebuilds` is, and the frame publishes `building` and then `ready` with a new `artifactId` —
  which is the change a mounted preview needs, because `DesignPreview` keys its guest by that ID. A
  miss for a `lastWorkingRevisionId` fallback the frame has moved past queues nothing; rebuilding a
  non-current revision stays Task 5's follow-up. `DesignPreview` lost its Retry control: there is
  nothing left for it to do, and the placeholder says the preview is being built again.
- **The byte caps were counting UTF-16 code units.** An 11,024-byte event and an 80,222-byte
  snapshot passed caps named in bytes. The intermediate and the renderer validator both measure with
  `TextEncoder` now, and the suites assert a four-byte-character string that is under the cap in code
  units and over it in bytes.
- **A mounted fallback names its revision** beside the diagnostics (spec §5), in
  `--droid-text-muted` with no new palette.
- Not reachable without a DOM test harness, and therefore not faked: the renderer's `null`-artifact
  placeholder and the remount a new `artifactId` causes both sit behind an effect that server
  rendering never runs. The sidecar half of that contract — the part that was broken — has its own
  regression, and `PreviewGuestFrame` is tested directly for the fallback label.
- Clicking an `a[ping]` at module scope ends the srcdoc document before the design mounts, so the
  probe does it from an effect instead; measured that way the ping reaches the listener zero times.
Settled by 03c's second review cycle (Astra xhigh, adversarial, against `0790088b`):

- **The CSP `webrtc` directive does not exist.** Chromium never shipped it and logs
  `Unrecognized Content-Security-Policy directive 'webrtc'`, so the first cycle's "both layers" was
  one layer and a comment. It is removed, and the CSP's own docblock now says plainly that it does
  not bound WebRTC at all. Never claim a layer the engine does not implement.
- **TURN over TCP is closed at the socket, in the guest's own session.** UDP was shut but TCP was
  not: the reviewer opened two connections and sent Allocate requests, from an immediate negotiation
  and from a peer created 500 ms before `setLocalDescription`. The guest now attaches into an owned
  in-memory partition (`droidex-canvas-preview`, deliberately not `persist:`), forced from
  `will-attach-webview` rather than trusted from the element, and that session is configured once at
  startup: the owned scheme is served on it — required anyway, since a partitioned guest cannot see
  the default session's handlers — every permission is refused, and `setProxy` points every TCP
  connection at `http://127.0.0.1:1` with `proxyBypassRules: '<-loopback>'`. The bypass rule is the
  whole point: Chromium bypasses a proxy for loopback by default, which is exactly where a probe's
  listener lives. Chromium's P2P TCP sockets resolve through the proxy, so TURN-TCP goes nowhere.
  Measured: pre-fix `connections: 2`, post-fix `0`.
- **Checked egress paths, all zero at a real listener:** ICE over UDP (STUN), ICE over TURN with
  `?transport=tcp` at both of the reviewer's timings, WebTransport, `navigator.sendBeacon`,
  `<link rel=dns-prefetch|preconnect|prefetch>`, and `<a ping>`. Each reports itself through the
  production channel before anything is measured, and the one whose marker could precede its own
  effect — the ping — is additionally checked by the fragment its click leaves on the frame; without
  that the case passed with the click removed. See the third cycle for the host candidate.
- **Clicking an `a[ping]` stops the generated document from running**, even with a fragment `href`,
  and afterwards `frames[0].url` is the intermediate's URL plus the fragment rather than
  `about:srcdoc`. A design that tries that path ends its own preview. It therefore gets its own
  guest in `[C6]`, measured alone, because anything after it in the same document is measuring a
  dead frame.
- **Text fields are display data, so they are cut, not grounds for refusal.** `throw
  Error('界'.repeat(200))` is 200 code units and 600 bytes: it passed a character cap in the
  intermediate and then failed a byte cap in the reader, which refused the snapshot and ended the
  guest over a diagnostic. Both sides now cut to 512 bytes on a code point boundary, so they agree by
  construction and drift cannot terminate a guest. The structural bounds — event count, total
  snapshot bytes, shape, identity — stay strict, because those are what a guest should be ended over.
- **A guest the element reports gone is lost at once.** With a poll in flight, `render-process-gone`
  used to be followed by 2.95 s of silence until the poll deadline. `previewRuntime` now listens for
  `render-process-gone`, `destroyed` and `crashed` on the element and settles `onLost` from them;
  `lose` is idempotent, so the deadline stays as the fallback for a guest that stops answering
  without dying.
- **A re-read is keyed on the build object, not the artifact ID.** The production compiler is
  content-addressed, so a rebuild of identical source lands on the *same* `artifactId` — the first
  cycle's comment claiming a new one was wrong and is corrected. `applyCanvasChange` keeps an
  unchanged frame's identity, so depending the read on `frame.build` reads once per change to this
  design and not once per snapshot, and a batched `building` → `ready` for the same revision is a new
  build object and therefore a new read.
- **A frame with no document says which of the three it is:** being rebuilt (a miss for the revision
  the frame holds as `ready`, which is the read that queued the work), no longer available (a miss
  for a `failed` frame's fallback, which queues nothing), or unreadable (the read threw). Promising a
  rebuild in the second case was a lie.
- The re-read **is** covered, in the renderer rather than in Node: `[C9]` bundles a probe from source
  with the esbuild the sidecar declares, evaluates it in the built app's page, and drives the real
  `DesignPreview` with a `readArtifact` whose identity never changes. It renders `ready` for a
  revision whose document is gone, waits for the miss and its label, then in one task flips the
  artifact to available and renders `building` and `ready` back to back. React commits only the
  second, so the commit carries the same revision and the same `artifactId` the frame already had and
  the build object is the only thing that moved — which is why keying on the artifact ID cannot work.
  With `build` removed from the deps the read count stays at 1 and the label stays; with it, the
  second read lands and the guest mounts. No DOM library and no production export were needed; the
  probe is inline in the spec, and esbuild is resolved from the sidecar's declared copy so the root's
  dependency list is unchanged.

Settled by 03c's third review cycle (Astra xhigh, adversarial, against `7e2c90cb`):

- **`activate` could create a window before the preview session existed.** `app.on('activate')`
  called `createMainWindow()` directly, so a guest could attach into a session that still routed
  `DIRECT` — measured as one TURN-TCP connection and 56 bytes to loopback — and releasing setup then
  made a second window. Two owners now: the security invariant is at the attach point, where
  `will-attach-webview` refuses any guest for a session `canvasPreview.cjs` has not finished
  configuring; and the ordering is one promise in main that every window-creation path
  (`whenReady`, `activate`, the notification open) goes through, so an early click waits for setup
  instead of racing it and `focusMainWindow` no longer creates anything. Readiness is keyed on the
  session object in a `WeakSet`, not a module flag: that is what the configuring produced, and it
  does not leak between tests.
- **Arranging a loaded frame reset its preview.** The re-read was keyed on the build object's
  identity, and an arrange re-sends every frame it touches with a fresh object and an unchanged
  build, so a mounted preview was torn down and its state lost. Object identity is not a signal.
  `generation` — the per-design attempt counter `canvasBuildStates.ts` already keeps monotonic — now
  travels on **every** `CanvasBuildState`, projected by `stateOf`, through both `protocol.ts` mirrors
  and the renderer validator, and `useArtifact` keys on `revisionId` + `generation` + `status` by
  value. Shape: `CanvasBuildState = CanvasBuildOutcome & { generation: number }`, so the union says
  what the build is doing and the intersection says which attempt it belongs to, in one place.
- The three cases triangulate, and no single wrong answer passes all of them: keying on the object
  fails `[C10]` (arrange re-reads), keying on nothing fails `[C9]` (a recovered artifact never
  arrives), and keying on the artifact ID fails `[C9]` too because an identical rebuild is
  content-addressed to the same ID.
- **A restored outcome is attempt zero.** The derived cache does not record a generation, and nothing
  has been built in the session that just opened, so `install` restores on 0 and the first rebuild of
  that design takes 1 — which a mounted preview reads as the move it is. A design the registry has
  never heard of is also `{ status: 'pending', generation: 0 }`.
- **The host-candidate path is not covered, and is no longer claimed.** A hand-built remote passive
  TCP candidate was tried; Chromium refused it (`addIceCandidate` threw) and the positive control
  with the proxy removed produced zero connections, so the probe proved nothing and would have been
  worse than its absence. It is dropped rather than kept as decoration. TURN over `?transport=tcp` at
  both timings already covers dialling a remote TCP endpoint, which is the path that actually
  escaped; a direct host candidate with a real remote peer remains unmeasured here.
- **`[C8]` now checks the intermediate, not just the reader.** The renderer trims an over-long field,
  so restoring the old character-based cut in the intermediate still passed: the case now drains the
  raw `drain()` answer and asserts that snapshot is already within 512 bytes and identical to what
  the reader produced, so the two sides cannot drift apart unnoticed.

Settled by 03c's fourth review cycle (Astra xhigh, adversarial, against `f0ddc906`):

- **`[C2]`'s receipt check was a race, and it is the one thing that keeps the case honest.** The
  retained probe reported guest receipt only at 10,000-message checkpoints, while the poll waited on
  the *sender's* count — which the generated frame reaches in its own process long before the guest
  has drained anything — and then asserted receipt afterwards. Under load the guest had received 1
  message when the window closed, so the assertion failed with nothing wrong in the code. The probe
  now reports the first message immediately as well, and the poll waits on receipt rather than on
  `sent`. Without that fact `direct === 0` would hold just as well for a flood that never happened.
- **The 3,000 ms chat bound was a property of the machine, not of the code, so it is reported rather
  than asserted.** Measured on one Apple M4, the chat's p95 during the flood is 11–34 ms while its
  single worst sample ranges over 1.1–3.3 s: maxima of 1,102 and 1,239 ms on early idle runs
  (matching Task 1's 1,178/1,219), but 3,135 ms on a later idle run and 2,600/3,320 ms under ten busy
  cores. The old bound therefore failed on an idle machine too, and it failed under that load at the
  base commit `243b9ba5`, which is what settles it: the number being asserted was one outlier sample,
  not the chat's responsiveness. Calls made while the flood is in flight now use a 30,000 ms bound that guards against a
  hang, and `[C2]` asserts containment instead: nothing reached the chat, the guest did receive the
  flood, no renderer died, both processes answered repeatedly throughout the window, and both child
  processes were released. The latencies are in the case's own output for whoever wants to compare
  them. Timing belongs to the replay harness, not to a smoke gate (AGENTS.md).
- `[C1]` and `[C3]` were left alone; they were not observed flaking, and widening bounds nobody has
  seen fail would be guessing.

- Adding the repair took `CanvasBuilds.ts` to 514 lines. The two queueing paths were folded into one
  `queueFromHead` (the head rule had been written twice), and `canvasCompilerProcesses.ts` now owns
  the compiler child processes: a slot's process is forked on its first build, ended at most once,
  and every termination is awaited before the registry closes. That is deliberately not the slot
  scheduler 03b examined and rejected — a process outlives the build that ended it, since an overdue
  build's kill is still settling while its slot has taken the next job. `CanvasBuilds.ts` is 490.

Settled by 03d (landed in `sidecar/src/canvas/canvasRuntime.ts`,
`tools/{stage-canvas-runtime.mjs,verifyCanvasRuntime.mjs,canvas-compiler-probe.ts}`,
`electron-builder.config.cjs`, `electron/{main.cjs,sidecar.cjs}`):

- **One owner for "where is the Canvas runtime": the Electron host, through one variable.**
  `electron/main.cjs` derives `resources/sidecar/canvas-runtime` from `process.resourcesPath` when
  `app.isPackaged`, and `electron/sidecar.cjs` passes it as `DROIDEX_CANVAS_RUNTIME_DIR` (deleting
  any ambient value otherwise, like `DROIDEX_HISTORY_DIR`). `canvasRuntime.ts` is the only reader:
  it anchors the compiler's `require` at that directory or, unset, at its own
  (`sidecar/src/canvas` under tsx, `sidecar/dist` built), and derives
  `ESBUILD_BINARY_PATH` as `<dir>/node_modules/@esbuild/<platform>-<arch>/bin/esbuild`. The fork in
  `compiler.ts` states `ELECTRON_RUN_AS_NODE=1` and that binary, and deletes `NODE_PATH` and
  `NODE_OPTIONS`, either of which would let a module or a loader from outside the runtime in. The
  variable is app-private, so both `childEnv` lists strip it from agent children. There is no third
  case and no fallback: a packaged runtime that cannot be loaded fails as `compiler_unavailable`.
- **The boundary is completeness, not interception.** Pointing `require` at the runtime is not a
  sandbox: node resolution is nearest-first but also walks ancestor `node_modules`, `NODE_PATH` and
  the user's own global folders (`~/.node_modules`, `~/.node_libraries`, `$PREFIX/lib/node`), a
  transitive `require` inside a package cannot be intercepted, and esbuild's `generateBinPath()`
  warns and falls back to ordinary resolution when `ESBUILD_BINARY_PATH` names a file that is not
  there. Review cycle 1 measured every consequence: with the checkout above a packaged layout, a
  runtime missing Tailwind, missing React, missing one transitive package (`picocolors`), empty,
  unconfigured, or without its binary all returned `ready` with the normal artifact hash, and
  an inherited `NODE_PATH` alone did it with no ancestor at all.
  So staging writes `canvas-runtime/manifest.json` — every file it placed with its size — and
  `startCanvasRuntime` checks the tree against it once, in the compiler child, before anything is
  loaded and before any request is accepted. **The tree is compared to the manifest, not the
  manifest to the tree.** The root is canonicalised once (so a linked app location still works) and
  then walked: every entry must be a regular file the manifest lists at the staged size, or a
  directory the manifest has files under, and anything else — a symbolic link, an unlisted file, an
  unlisted directory, anything that is not a regular file — refuses the runtime. The binary is
  listed without a size, because signing rewrites it, and must be executable. Finally each of the
  seven specifiers a compile resolves has to land inside `<root>/node_modules`. Any miss and the
  worker answers every request with one curated sentence and logs the first path at fault; nothing
  is ever a diagnostic.
  Walking only the listed paths was not enough, twice over. Cycle 2 replaced a nested dependency
  *directory* with a link to an outside copy — no listed file changed, three outside files resolved,
  `ready`. Cycle 3 then added a `node_modules/tailwindcss/node_modules` link that no listed path
  traverses at all: 227 outside paths, `ready`. Only an account of what is actually in the tree
  closes that, which is why the per-component `lstat` walk was replaced rather than extended.
- **One canonical root for the check, the loader and a design's imports.** The verifier used
  `realpath(runtimeDir)` while the `require` was built from the configured spelling, and the two are
  not interchangeable for node's search paths: cycle 3 configured an `alias/node_modules` link to a
  sound runtime, which made node skip that directory's own packages and resolve esbuild from the
  ancestor checkout — `ready`, 311 outside paths, with the verifier meanwhile resolving esbuild
  inside the runtime. The `require` is now created inside `startCanvasRuntime` from the canonical
  root after the tree check, and it is the same object that resolves the seven specifiers, loads the
  three packages and answers `canvasRuntime().resolve()` for a design's imports. There is no
  module-load-time `createRequire`, so an unverified path is never an anchor at all, and that
  `alias/node_modules` spelling now compiles normally with nothing outside. A relative
  DROIDEX_CANVAS_RUNTIME_DIR is a malformed host rather than a tree to find from the cwd, and is
  refused.
- **One loader, and cleanup is not it.** Cycle 2 also found the other way in: shutdown called
  `stopBundler`, which went through a lazy accessor and loaded esbuild, PostCSS and Tailwind from
  wherever node found them even after startup had refused the runtime — 307 distinct outside module
  paths for a missing Tailwind with an ancestor, 308 for an empty or unconfigured one. The runtime
  is now loaded in exactly one place, `startCanvasRuntime`, after verification; `canvasRuntime()`
  returns what it loaded and `stopCanvasRuntime()` releases only a service that was started. The
  probe asks for a graceful shutdown and requires zero outside resolutions across the whole life of
  every refused worker, which is what the earlier probe missed by killing its children.
  Sizes rather than digests, because the risk is an incomplete or damaged install rather than
  tampering and this runs on every compiler start; the binary carries no size because code signing
  rewrites it while packaging (9,750,242 staged, 9,712,896 shipped).
  The check also refuses a built worker that finds a manifest beside it with nothing configured, so
  a host that loses the variable compiles nothing instead of resolving from a global folder.
  `tools/verifyCanvasRuntime.mjs` reads that manifest for packaged trees in `release:verify:mac`
  and `canvas:probe`. **It enforces the same tree-equals-manifest rule, as a second
  implementation**, because the sidecar bundle may not import a build tool and the tool may not
  depend on tsx. Sharing one implementation across that boundary was the alternative and was
  rejected for those two reasons; drift is held off instead by `canvas:probe`, which puts every
  damaged fixture to both the tool verifier and a real worker and fails if they ever disagree. Cycle
  3 found the tool accepting three trees the worker refused, and cycle 4 two more — a `null` size in
  `manifest.files`, which collided with the tool's own no-size sentinel, and a tree that agrees with
  its regenerated manifest but is short of a package a compile resolves, which the tool never
  resolved. Both are closed and both are fixtures now. **The claim is that the two refuse the same
  trees for every fixture the probe exercises, not for every malformed shape that exists**; the
  tool keeps its release-only checks (licences, Mach-O architecture, the foreign binary's absence)
  and accepts a relative argument, which is tooling input rather than a host setting.
  Cycle 5 then found the last gap of this kind: resolving the seven specifiers says nothing about
  whether the packages behind them can load their own dependencies, and a staging input whose
  `picocolors` was missing one file staged, recorded a faithful manifest, resolved all seven and
  was accepted while the worker refused it. The gate now **loads** esbuild, PostCSS and Tailwind,
  in a child process so a package that throws or hangs cannot take it down and the gate's module
  cache stays clean, with `PATH` the only inherited variable and `Module._resolveFilename` traced so
  that a pinned package reaching outside the root through `require` is refused. **What that proves
  is narrow**: those three packages load through the CommonJS loader from the owned root, and
  nothing they resolve through it lands outside. The trace is not a sandbox — an `import()` uses the
  ESM loader and a `new Worker` has its own, and cycle 6 confirmed neither is seen — and nothing
  here authenticates package contents; the manifest sizes remain the only account of those. The
  timeout kills with SIGKILL, because `spawnSync` sends a catchable SIGTERM and then waits: cycle 6
  held the gate past 65 seconds with a package that handled the signal and kept its loop alive. None of the three starts a process at load and the
  staged binary is named through `ESBUILD_BINARY_PATH`, so esbuild never looks for a platform
  package and the foreign architecture's binary is still only inspected; a sound tree costs about
  120 ms. `npm run canvas:runtime` calls the same gate at the end of staging, so that input now
  fails where it was made.
- **Two things the walk does before it trusts anything, and one it forgives.** The manifest's type
  is proven before it is read: cycle 4 replaced it with a FIFO and both validators blocked in
  `readFileSync` — the worker answered neither compile nor shutdown, and the release gate hung —
  so both `lstat` it and refuse anything that is not a regular file. And a regular `.DS_Store` is
  tolerated anywhere in the tree: the assumption that code signing would refuse one was wrong, the
  app's `CodeResources` omits that name and a signed app with one still verifies strictly, so
  refusing Canvas because a user opened the resource folder in Finder would be a support failure
  rather than a boundary. As a link or a directory it is refused like anything else, and nothing
  else unstaged is tolerated.
- **A damaged runtime is never the design's fault.** esbuild reports a plugin's thrown error as a
  message detail, and 03a's mapping read that detail's `code` as a curated diagnostic code: a
  runtime without React answered a valid design `failed`, with `MODULE_NOT_FOUND` and the
  compiler's own absolute require stack in diagnostics that 3b persists and shows, and a missing
  Tailwind preflight asset arrived as `css_error`. Only the seven codes 03a defined are a
  diagnostic now; anything else esbuild attached, and any stylesheet failure that is not PostCSS's
  own `CssSyntaxError`, is rethrown so the worker reports an unavailable compiler. Invalid design
  CSS still reports `css_error`. `compiler.test.ts`'s diagnostic helper refuses a machine path
  anywhere in any diagnostic field — `/Users/`, `/home/`, `/private/`, `/tmp/`, `/var/`,
  `node_modules` or the repository root, quoted or not — which is where that rule belongs for every
  future case. Cycle 2 caught the first version recognising a slash only after whitespace, so
  `could not open "/Users/…"` passed it; the quoted form is now a case of its own. Cycle 3 noted it
  covered only `CompileFailedError`, so the damaged-runtime test asserts the `unavailable` message
  is the one curated sentence and runs the same rule over it, and the probe requires that sentence
  from every runtime it refuses.
- **A damaged installation is not something a restart repairs, and the renderer is told so.**
  `buildFailure` replaced every unavailable reason with the restart sentence, so cycle 4 found the
  frame advising a restart for a runtime the app had staged wrongly. `CompilerUnavailableError` and
  the worker's `unavailable` response now carry a `reason` — `damaged-runtime` or `lost-compiler` —
  and `buildFailure` picks between the two curated sentences by that reason rather than by reading
  text; no exception text is ever forwarded. Both sentences live in `compiler.ts`.
  `compiler.test.ts` asserts the reason survives the real IPC boundary and `CanvasBuilds.test.ts`
  asserts the sentence the frame publishes for each reason.
  The parent reads that reply as a boundary rather than as its own type. Cycle 5 showed a missing,
  object or invented `reason` passing the cast straight into `CompilerUnavailableError` and landing
  in the renderer's else branch as advice to restart; `compilerResponse` now accepts only the shape
  the protocol defines and anything else is handled as a crash — the process is lost and ended,
  every compile in flight fails as a lost compiler, and the next build forks a replacement.
  `requestId` is checked for its type and nothing more, because a cancelled compile is answered
  after its caller has already been told and `settle` drops it.
- **No tsconfig covered `tools/`**, which is how a `CompilerResponse` the protocol change missed
  survived in `canvas-compiler-probe.ts`: the root config includes `src` only, `tsconfig.node.json`
  is referenced but never built (so `tsc --noEmit` ignores it), and `canvas:probe` runs under tsx,
  which does not typecheck. `sidecar/tsconfig.json` now covers that one file and allows JavaScript,
  which types the plain `.mjs` verifier it calls, so `npm run sidecar:typecheck` sees it. Adding
  `tools` to the root config was the alternative and is not viable: it pulls the sidecar graph in
  under the frontend's options and surfaces ten pre-existing errors the sidecar's own config
  accepts.
- The worker loads `esbuild`, `tailwindcss` and `postcss` through that one anchor instead of
  importing them, so `build:compiler-worker` needs no `--external` flags at all and the bundled
  entry resolves no bare specifier beside `sidecar/dist`. 03a's note that only `react`/`react-dom`
  move is therefore superseded: a bundled ESM external would have resolved from
  `resources/sidecar/node_modules`, which does not exist. `postcss-value-parser` keeps its plain
  import and is bundled: it has no `__dirname` and no native part, so bundling keeps the
  per-declaration CSS resource review free of an accessor. Tailwind's own copy is still staged and
  listed, and the specifier is still checked.
- **As-is copy, pruned of what a compile cannot reach.** `npm run canvas:runtime` stages one
  complete tree per architecture at `sidecar/canvas-runtime/<arch>/node_modules`, closing over
  `dependencies` only and keeping nested duplicates where their dependent reads them, so Tailwind's
  `__dirname` preflight loader and node resolution both work untouched. Dropping esbuild's own
  binary copy, Tailwind's CLI and prebundled `peers`, Tailwind's `src` ESM mirror, and React's
  server/profiling builds takes the staged tree from **36.75 MiB (1,443 files)** to **16.09 MiB
  (902 staged files)** arm64. A dedicated bundle was not built: §6's bundled estimate for arm64 was
  12,339,334 bytes (11.77 MiB), so the as-is copy costs 4,497,134 bytes more and keeps Tailwind's
  preflight loader and node resolution working as installed.
- **Measured packaged resources.** arm64 `resources/sidecar/canvas-runtime`: 903 files,
  16,889,391 bytes (16.11 MiB) — 901 listed files, a 52,923-byte manifest and the binary — with
  `@esbuild/darwin-arm64/bin/esbuild` at 9,712,896 bytes, mode 755, Mach-O arm64 (electron-builder
  re-signs it, so it is 37,346 bytes smaller than the 9,750,242 npm ships). x64: 903 files,
  17,709,603 bytes (16.89 MiB), 52,919-byte manifest, binary 10,533,120 bytes, mode 755, Mach-O
  x86_64. Each app carries only its own architecture's binary, and the packaged tree matches the
  manifest exactly: staging drops the names electron-builder would have dropped (`.gitkeep` among
  them), so nothing is lost between staging and the app.
- **electron-builder drops a copied directory's own top-level `node_modules`** (`createFilter` in
  `app-builder-lib/out/util/filter.js`), which silently produced an app with no Canvas runtime at
  all. The file set therefore names `sidecar/canvas-runtime/${arch}/node_modules` as its source.
  `${arch}` is expanded in a file set's `from` and `to`, so one entry covers both architectures.
- **The cross-architecture binary is fetched against the reviewed lockfile, without npm.** npm
  skips an optional dependency whose cpu does not match, and `npm install --force` pinned only a
  version: review cycle 1 replaced the `darwin-x64` SRI in `sidecar/package-lock.json` with an
  all-zero value and staging still succeeded, with lifecycle scripts permitted and npm writing its
  cache and logs to `HOME`. Staging now fetches the tarball the lockfile resolves, verifies it
  against that lockfile's integrity before extracting, unpacks it into an empty directory inside
  `sidecar/canvas-runtime/.tarballs` and copies only the files found under it, then checks the
  staged binary is executable and this architecture's. A verified tarball is kept, so a repeat
  build is offline: cross-architecture packaging needs the registry once per esbuild version. A
  design compile needs it never.
- **Offline packaged probe, run from inside the produced app, with negatives.** `npm run
  canvas:probe -- release/mac-arm64/DROIDEX.app` forked
  `Contents/Resources/sidecar/dist/compilerWorker.mjs` with `Contents/MacOS/DROIDEX` as `execPath`,
  `ELECTRON_RUN_AS_NODE=1`, the owned runtime and binary, `PATH=/usr/bin:/bin`, an empty `HOME`, and
  `net.connect`/`dns.lookup`/`http(s).request`/`fetch` replaced by throws in the child. It compiled
  the kit's own `Hey.tsx` to artifact
  `64dd3d94797e60278aa967ed683c5f26beac49a31477d1323f6427f3b8b2bd7b` (209,916 bytes) — byte for byte
  the artifact the checkout produces. The probe then verifies the packaged tree through the shared
  manifest reader and damages four copies of the runtime in turn — a transitive package, the
  esbuild binary, Tailwind's preflight, and the variable itself — each with the checkout's own
  `node_modules` symlinked above it, and requires each to compile nothing. Every one of those cases
  returned the normal artifact before this boundary existed.
- **x64 was verified by inspection only, never executed**, on this arm64 machine: the x64 `--dir`
  pack's resource tree, binary architecture, mode and the absence of the arm64 binary were checked
  on disk. `release:verify:mac` makes the same assertions for both architectures and runs the probe
  only for the architecture it is on.
- **Dependency review: 4 prod findings to 12** (`npm --prefix sidecar audit --omit=dev`): before, 3
  moderate + 1 critical, all through `@anthropic-ai/claude-agent-sdk` (`fast-uri`, `hono`,
  `ip-address`, `proxy-addr`). After, +5 high and +2 moderate: `braces` (and `chokidar`,
  `micromatch`, `fast-glob`, `tailwindcss` depending on it) and `postcss-selector-parser` (with
  `postcss-nested`), plus `esbuild <= 0.24.2`. **No non-breaking upgrade removes any of them.**
  3.4.19 is the last Tailwind 3.4; every published `braces` is in range; the
  `postcss-selector-parser` fix is 7.1.6 and Tailwind 3 pins `^6.0.11`; the esbuild fix is 0.25+.
  The esbuild advisory is its development server, which Canvas never starts — it calls `build()`
  with `write: false`. Tailwind 4 is out of scope by instruction. **No Sonatype verdict is
  claimed**: the `sonatype-guide` MCP server refused the configured token (HTTP 401,
  `invalid_token`).



- [ ] Add compile fixtures for working React state, CSS, relative modules, bad TSX, unsupported import and attempts to read outside the virtual tree. Reject undeclared packages, URL imports, Node builtins and filesystem escapes in the resolver. Never invoke generated source in the sidecar process.
- [ ] Implement versioned kit persistence and the initial DROIDEX tokens plus Button/Card primitives using the Task 7 signatures/example. Resolve the pinned `@droidex/design-system` virtual module in the worker now. Test version immutability and a compiled stateful example; Task 7 extends this working owner with the complete presets, picker and image workflow, not a replacement path.
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
- [ ] Install the one proven `<webview>` guest host. Enable `webviewTag` only on the owning window; before renderer startup, harden `will-attach-webview`: allow only owned source, strip preload, disable Node/subframe Node, enable context isolation/sandbox/web security and disable nested guest webviewTag. Restrict guest navigation/new windows. Use bounded one-in-flight trusted snapshot polling through the element API, with main-owned timeout/termination and generation checks. No guest preload or alternate host engine. Install the bounded event schema. Refuse wrong sender/nonce/design/revision/generation, oversized messages and any privileged request. Test actual component clicks with Playwright, plus spoofed messages and blocked network/navigation with Electron. Use the Task 1 external watchdog for hangs.
- [ ] Add offline packaged-app tests that open a saved design, rebuild it and use its button without checkout dependencies. Run focused compiler/build tests, the Electron Canvas smoke and `rtk proxy npm run build`; verify arm64 and x64 resources. Update generated script documentation if scripts change.

## Task 4: One MCP surface, correct provider routing and clean transcripts

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/04a-canvas-turn-scope`: Implement `canvasTurnContext.ts` mint/check/revoke at the §6 lifecycle seams and carry context beside prompt text through send, queue, send-now and steer.
  Done: Tests preserve pinned contexts and reject expired or replaced-provider scopes after awaits.
- [x] `canvas/04b-canvas-mcp-server`: Implement the six tool schemas/descriptions, HTTP resource for Droid/Claude, Codex `inAppServers`, Claude PreToolUse read binding, collision checks and cleanup.
  Done: Extend `codexTools.test.ts`; stale calls, reserved-name collisions and startup failure clean up correctly.
- [x] `canvas/04c-canvas-transcript-projection`: Implement `canvasToolPresentation.ts` and wire its projector through event flow, timeline, native parsers, search and export.
  Done: All three provider canaries stay absent from app-owned surfaces while matching user text remains visible.
- [ ] `canvas/04d-harness-smoke`: Run live discovery/create/write/inspect/resume with cheap models on each harness and retain conformance fixtures.
  Done: Each provider records live scope/routing results; unavailable account access remains explicitly unverified.

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

- [ ] Give Codex the Canvas server through the existing dynamic-tools bridge: add it to the `inAppServers` list in `startLocalMcpServers` so `CodexToolBridge` declares the six tools on `thread/start` and refuses inactive turns as it does today. Bind Claude reads with a session-local `PreToolUse` hook keyed on `claudecode/toolUseId` (spec §6); bind Droid by endpoint and mutation lease only. Nothing touches `~/.codex/config.toml`; assert no credentials appear in argv or logs. Test reserved-name collision and resource cleanup on startup failure, and extend `providers/codex/codexTools.test.ts` with the Canvas declarations and a stale-turn Canvas call.
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

Settled by 04a (landed in `sidecar/src/canvas/{canvasTurnContext.ts,schema.ts,protocol.ts}`,
`sidecar/src/{SessionLifecycle.ts,SessionManager.ts,sessionCompactionExecution.ts,bridgeServer.ts,protocol.ts,index.ts}`
and `src/{types/bridge.ts,lib/commands.ts}`):

- **The interfaces, as the real seams took them.** `CanvasTurns` in `canvasTurnContext.ts`
  composes over the existing `CanvasScopes`; it adds no second registry and keeps only which
  turn and which provider era minted which lease. `beginCanvasTurn(appSessionId, generation,
  context)` became `canvasTurns.beginTurn(appSessionId, context)` returning a
  `CanvasTurnLeases` handle, because the generation is the owner's to assign rather than the
  lifecycle's to pass: the lifecycle has no per-chat provider-era counter, and mirroring one
  into Canvas would give one invariant two owners. The handle is also what a steer joins
  (`addSteer`) and what every settlement path revokes (`revoke`), so a turn's leases are one
  unit. `revokeCanvasScope(scopeId)` has no caller and was not added; `CanvasScopes.revoke`
  stays the primitive underneath, and the pane still uses it for its own user scope.
  `getCanvasScope(scopeId)` is `requireScope(scopeId)`, matching `canvasLeases.ts`'s
  `require*` convention for a lookup that throws `scope_expired`. 04b additionally gets
  `activeScope(appSessionId)`.
- **A lease is registered exactly while it is live, and that is the whole check.** Every
  settlement path revokes, and a provider replacement revokes the chat, so `requireScope` asks
  only whether the registry still holds the scope. A `generation !== current` comparison there
  was written first and removed: nothing can produce a registered turn scope from a past era, so
  the branch was unreachable, and the late-steer bug review found (below) never moved the
  generation. Each new provider era takes the next process-wide generation, while `endSession`
  revokes and deletes its chat record. A stale steer handle checks that its original record is
  still current before minting; the recorded generation remains available for 04b's dispatch
  binding without retaining ended chats.
- **Every turn mints a lease.** A prompt with no pinned context uses empty design and element
  references and `DEFAULT_DESIGN_SYSTEM_REF` from the design-system owner, giving an ordinary
  chat authority over its canvas without opening the pane. A delivered steer with no pinned
  context gets the same default. For an unattached chat the lease starts with `canvasId: null`;
  the workspace's first `canvas_create` fills the binding through the existing
  `CanvasLeases.claim` → `CanvasScopes.bindScopeCanvas` path. A Canvas call outside an active
  turn is still refused with `scope_expired` (spec §6).
- **`allowedDesignIds`** is every design the chips named, whether as a frame or as an element
  inside one, and `'canvas'` only when the prompt pinned neither — which is what
  `CanvasLeases.requireDesigns` already expects (02b). Deriving it from `designs` alone, as the
  first version did, turned a one-element selection into write authority over every design on
  the board.
- **The lease lifecycle, seam by seam.**

  | Seam | Mint | Revoke |
  | --- | --- | --- |
  | `SessionLifecycle.runTurn`, at the streaming transition | the turn's lease, from `prompt.canvasContext` or the default context | — |
  | `SessionLifecycle.steer`, once `session.steer` resolved true | the steer's own lease, through the running turn's handle | — |
  | `subscribeBackgroundEvents`, `onDelegatedTurn(true)`, only when no typed turn runs | the turn's default lease | — |
  | `runTurn`'s `finally`, first statement | — | the turn and its steers, before anything awaits and before the queue advances |
  | `onDelegatedTurn(false)`, only when no typed turn runs | — | the same, for a turn the provider started |
  | `interrupt`, before `await session.interrupt()` | — | the running turn, before the external cleanup await |
  | `sendNow`, before `await session.interrupt()` | — | the turn being stopped to send now |
  | `beginClose` (close, relaunch) | — | every lease the chat holds; its record is removed before the next era |
  | `closeAll`, before its concurrent process kills | — | every captured chat's leases, even if its kill later fails |
  | `sessionCompactionExecution.adoptProvider`, before `oldSession.close()` | — | the same, so the replacement starts a new era |

  Revocation is idempotent everywhere, and a handle reaches only the leases it minted (each
  carries the turn that owns it), so a settlement that lands late cannot revoke a later turn's
  or a replacement's. `closeAll` invalidates its captured chats before its first process-kill
  await; later `beginClose` calls may repeat the idempotent revocation.
- **One owner for `liveSession.canvasTurn`.** Codex starts a delegated turn for any
  `turn/started` whose id differs from the adopted typed one, "however close behind the typed
  one it arrives" (`codexSession.ts`), so `onDelegatedTurn(true)` can fire while a typed turn is
  running. Both halves of that handler are therefore guarded on `liveSession.turnPromise`: the
  typed turn's handle keeps the field, so the delegated turn neither orphans that lease — which
  would leave a dead turn's pinned designs answering `activeScope`, the retargeting §6 forbids —
  nor revokes it mid-turn. `turnPromise` is a sound guard because `runTurn` assigns it with only
  synchronous statements between it and the mint, so no provider notification can land in
  between.
- **A Stop or a Send now the provider refuses** leaves its turn running with no lease, and no
  steer it takes in afterwards leases either. Both revoke before awaiting the interrupt, as spec
  §6 requires; failing closed is the safe direction, and undoing a revoke would give one lease
  two lives.
- **The steer binding rule.** A Canvas call that presents no scope ID binds to the chat's
  newest live lease, which is a pending steer's while the running turn holds a steer the model
  took in. Dispatch carries no steer discriminator on Droid (spec §6), and the newest lease is
  the user's latest instruction for the turn that is running. Every earlier lease stays valid
  and may still be presented by ID, so a call already in flight is answered rather than
  retargeted. Steer delivery captures its original turn handle before awaiting the harness and
  checks the provider and handle again afterward; a result delivered after that turn or provider
  ended cannot lease the next turn, including after compaction keeps the same `LiveSession`.
- **The sidecar queue carries the received context.** `SessionPrompt` is the one shape behind
  `pendingSends`, `steers`, send-now reordering, `relaunch`'s waiting list, post-compaction
  `settleAfterCompaction` and `redeliverQueuedSends`. Reordering and redelivery move that prompt
  without changing its references. `sessionPrompt()` omits the field when none arrived.
- **Renderer handoff to Tasks 5/7b.** `QueuedPrompt` in `src/hooks/useStore.tsx` and its
  delivery/edit/reorder paths do not yet carry `canvasContext`, and the first-turn
  `session.create` goal has no context field. Snapshot the selected design and element chips
  and the current design-system version when composing each request; carry that value through
  queue, edit, reorder, steer, send-now and first-turn create. The disconnected bridge currently
  retains a command object by reference, so capture an immutable value before enqueueing it.
  Add a queue → selection change → delivery regression at the renderer owner. This is renderer
  transport work; 04a preserves references only after the request reaches the sidecar.
- **The boundary.** `session.send` gained `canvasContext?: CanvasTurnContext`; `bridgeServer`
  checks it with `assertCanvasTurnContext` beside its existing `assertValid*` checks, and a
  `CanvasCommandError` now travels as `canvas.<code>` so a refusal keeps its stable code.
  `canvasTurnContextSchema` lives in `schema.ts` with the other boundary parsers, which also
  made `DesignRef`, `ElementRef` and `CanvasTurnContext` Zod-inferred there and re-exported
  from `protocol.ts`; `schema.test.ts`'s mirror check still compares them to the renderer's.
  New §4/§5 limits: 32 pinned designs, 32 pinned elements, and a 512-character instance path,
  never tighter than the 512 bytes a preview clamps a reported path to.
- **The expiry message has one owner.** `EXPIRED_TURN` moved to `canvasError.ts`, which
  `canvasScopes.ts`, `canvasLeases.ts` and `canvasTurnContext.ts` all already import; the first
  two held byte-identical copies of a §8 message the model and the user both read.
- **Nothing is concatenated into the prompt.** `primaryTurn.ts` is untouched: it still streams
  `prompt.text` alone, and no hidden user message is fabricated (spec §9).
- **Wiring.** `SessionManager` takes the lease owner as an option; `sidecar/src/index.ts`
  passes the one the Canvas workspace checks and reads the chat's attachment from the opened
  workspace, so a chat reads as unattached until Canvas storage opens. A harness that opens no
  workspace gets its own owner, so turns mint and revoke there exactly as in production.
- **Verification.** `canvasTurnContext.test.ts` owns the lease contract (pinning, the steer
  rule, era refusal, the unattached binding against a real `CanvasWorkspace`, and the §8
  rejection message). `SessionLifecycle.test.ts` owns the seams through the real lifecycle with
  gated streams: a reordered queue running under each prompt's own references, a delivered
  steer beside the running turn, Stop revoking before the provider is asked to unwind, a
  close/resume replacement revoking the old lease while the redelivered prompt mints under the
  next generation, and a provider-started turn beside a typed one leaving the typed turn's lease
  alone (that last case fails without the `turnPromise` guard). `bridgeServer.test.ts` holds the boundary refusal, and
  `src/lib/commands.test.ts` the renderer pass-through.
- **Not covered.** The pane that composes a context is Task 5's; the six tools, their dispatch
  and the Claude `PreToolUse` read binding are 04b's; transcript projection is 04c's.

## Task 5: Persistent Canvas in the utility pane

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/05a-canvas-pane-and-empty-state`: Add the Canvas pane surface without a utility-picker entry, one programmatic open path `openCanvas({ appSessionId, canvasId, frameId? })`, `CanvasWorkspace.tsx` shell, the all-frames-deleted empty state and atomic attachment bootstrap.
  Done: `canvasState.ts` snapshot/change subscriptions reconcile state; opening the pane creates no design or compiler; Canvas never appears in the utility picker.
- [ ] `canvas/05b-board-geometry-and-gestures`: Implement `canvasGeometry.ts` and tests plus `CanvasBoard.tsx` pan/zoom/fit, pointer capture and transient frame dragging.
  Done: Zoom anchors correctly; drag commits once on release and cancellation restores acknowledged geometry.
- [ ] `canvas/05c-frames-selection-previews`: Implement `DesignFrame.tsx`, Select/Interact, Escape/Enter, multiselect/align/nudge/resize and four live slots with placeholders using `DesignPreview`.
  Done: Running-board transformed input, clipping, ongoing gestures and layout conflicts preserve source and mounted preview state.
- [ ] `canvas/05d-navigator-and-toolbar`: Build virtualized `CanvasNavigator.tsx` search, `CanvasToolbar.tsx`, completed context actions and zoom readout.
  Done: Named/status-labeled controls work in empty/loading/error states and search focuses the requested frame.
- [ ] `canvas/05e-design-mode-and-canvas-header`: Add the Chat | Design product switcher at the sidebar wordmark, the Design home (large composer, example chips, design-system picker, “Your canvases” grid), the canvases sidebar list, new-canvas-per-prompt, “New chat with this canvas” in the docked composer menu, and the expanded board's top row.
  Done: Light/dark inspection and `tests/integration/canvas.spec.ts` verify the switcher, a Design home prompt creating a new canvas and attached chat, pane transitions, real CTA input and persisted attachments.

**Files:** Create `src/features/canvas/{CanvasWorkspace.tsx,CanvasBoard.tsx,DesignFrame.tsx,CanvasToolbar.tsx,CanvasNavigator.tsx,canvasState.ts,canvasGeometry.ts,canvasGeometry.test.ts,canvasState.test.ts}` and `tests/integration/canvas.spec.ts`. Modify `src/lib/{utilityPanel.ts,lazySurfaces.tsx}`, `src/components/utility/{UtilityPane.tsx,utilityToolOptions.ts}`, `src/App.tsx`, `src/hooks/{useStore.tsx,persistedUiPreferences.ts}`, `src/components/Sidebar.tsx` and their existing focused tests. Reuse Task 3 `DesignPreview.tsx`.

**Interfaces:** `CanvasWorkspace` consumes `{ appSessionId: string; canvasId: string | null; isExpanded: boolean }` plus focused bridge callbacks using the existing connection pattern. `applyCanvasChange(snapshot: CanvasSnapshot, change: CanvasChange): CanvasSnapshot` updates the feature-local projection. Geometry exports `screenToCanvas(viewport: Viewport, point: Point): Point`, `zoomAtPoint(viewport: Viewport, point: Point, scale: number): Viewport` and `fitFrames(rects: FrameRect[], viewportSize: Point): Viewport`, with `Point = { x: number; y: number }` and `Viewport = { x: number; y: number; scale: number }`. Frame/source ownership remains in Task 2.

- [ ] Add the Canvas pane as a lazy, expandable singleton surface that is never listed in the utility picker; the only way in is `openCanvas({ appSessionId, canvasId, frameId? })`, called by the artifact card, the agent's first artifact in a chat, and Design mode. Keep only attachment IDs/pane preferences in shared state; viewport/selection/inspector state belong to the Canvas feature. A canvas whose frames were all deleted presents the empty state (“Ask your agent to design something” plus example requests). Bootstrap an empty canvas/attachment atomically on explicit Create or the first `canvas_create`, following the unattached-chat sequence in spec §6: the turn's lease already exists with `canvasId: null`, the first create commits canvas, attachment and the lease's canvas binding together under the workspace commit owner, and a retry with the same mutation ID returns the same canvas and frames. Merely opening the pane does not start a compiler or create a design.
Settled by 05a (landed in `src/features/canvas/{CanvasWorkspace.tsx,canvasState.ts}`, `src/lib/{utilityPanel.ts,lazySurfaces.tsx}`, `src/components/utility/{utilityToolOptions.ts,UtilityToolPicker.tsx}`, `src/App.tsx`, `src/hooks/useStore.tsx`):

- `CanvasWorkspace` takes `onToggleExpanded` and `onAttachmentChange` beside the three props the Interfaces paragraph names. Canvas is an expandable tool, and an expandable pane with no control to expand it is dead wiring, so the pane carries the same `AgentPaneExpand` the agents and side-chat panes use until 05e gives it a header. It reaches the bridge the way the other feature clients do: one module-level `CanvasClient` over the app `bridge`, not callbacks passed from `App`, which cannot import the Canvas chunk without putting it in the entry bundle.
- `canvasState.ts` is the pane's projection and nothing more. Change reconciliation — gaps, duplicates, out-of-order sequences and resync — already has an owner in `client.ts` (02c), which hands subscribers reconciled snapshots, so the reducer guards only what can still reach it: a snapshot for another canvas, and one whose sequence is at or behind the projection already held. `applyCanvasChange` stays `client.ts`'s to call.
- The root store holds `canvasAttachments: Record<string, string | null>`, a missing key meaning nobody has asked. It is not persisted: the manifest owns the attachment, and a localStorage copy could point at a canvas that no longer exists. Its only job is to stop a reopened pane blinking through the empty state; the pane still reads `canvas.attachment` on every mount and the sidecar's answer wins. Deleting or archiving a chat drops its entry.
- An authoritative `SESSION_LIST` prunes both pane and attachment cache for a removed chat. Late Canvas Open and attachment callbacks cannot recreate either entry once that list has removed the chat. `SESSION_CLOSED` retires only the runtime and keeps its pane. The sidecar checks the canonical chat registry before attachment mutations and again at the manifest commit gate; an unknown chat receives `unknown_chat` with a recovery message.
- Explicit Create carries a client-held `mutationId`. The workspace records it with the newly committed manifest and returns that canvas on replay, including when the first reply is lost while its commit is still in flight. The Canvas chunk keeps an unsettled key across pane unmounts, and the pane offers only Retry with that key in its recovery state; an attachment read cannot re-offer Create before the outcome is known.
- `Open saved canvas` lists real canvases through `canvas.list` and attaches with `canvas.attach`; no new bridge command was needed for 05a.
- Canvas is **not** in the utility-tool picker (user decision, 2026-10-06; supersedes spec §4's "Add Canvas to the utility-tool picker", which the user is updating separately). It keeps the tool type, the singleton rule, the expandable pane, the lazy surface and the persisted preference, and it opens programmatically only. `useOpenCanvasPane()` in `src/features/canvas/openCanvasPane.ts` is the single exported way in; it takes `{ appSessionId, canvasId: string | null, frameId? }` and is what an artifact card's Open (06a) and the design entry point will call. Creating an artifact does not open the pane.
- `OPEN_UTILITY_TOOL` takes an optional `appSessionId`, as `CLOSE_UTILITY_TAB` and `UPDATE_UTILITY_TAB` already did, so an opener can name the chat rather than assuming the one on screen. Its Canvas tab carries a named `canvasId` and optional `frameId` as transient targets; `canvasId: null` clears the target and reads the chat attachment. Opening canvas A while the chat is attached to B shows A without changing B's attachment. `openUtilityTool`'s retarget ids share one list. Transient targets are excluded from the raw persisted tab fields.
- Canvas persists and restores with its chat like Review and Files (`isRestoredTool`), because a canvas reconstructs from durable state. It has no keyboard shortcut.
- The empty state follows spec §4: "Ask your agent to design something", three example requests, then Create and Open saved canvas as secondary actions. The examples are working controls, not prose — they dispatch the existing `SEED_COMPOSER`, which seeds the chat's composer without sending, so nothing in `PromptInput.tsx` or `promptSend.ts` was touched. It is the same invitation for a chat with no canvas and for an attached canvas with no designs.
- Nothing assumes one chat per canvas: the renderer's attachment cache is keyed by `appSessionId`, so "New chat with this canvas" leaves the original chat attached and adds a second key for the same canvasId. Nothing reads the map in the other direction.
- Controls on the pane's card use a low-alpha accent tint, not `bg-droid-elevated`: on a dark theme `raisedSurfaceColor` resolves to the elevated rung, so an elevated fill inside a `bg-droid-raised` card leaves buttons looking like plain text. Verified in the running app in both modes.
- Verified directly that opening the pane creates nothing: after opening Canvas on a chat with no attachment in an isolated profile, `<profile>/canvases/` is empty and the pane shows the Create / Open saved canvas state.
- Entry-chunk cost of the registration is +1335 bytes of initial JS (1431743 → 1433078 against a 1434000 budget). 05b–05e have ~900 bytes of headroom and must stay out of the entry chunk.
- The board, frames, gestures, navigator and toolbar are not stubbed. An attached canvas renders a `data-canvas-board` mount point that states what the snapshot holds; `CanvasBoard` replaces it in 05b.

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

- [ ] Verify the measured guest presentation contract (spec §4): board transforms and pane `overflow` position/clip live `<webview>` previews; DOM controls and Select overlays paint above them. Commit overlay/hit-test changes before subsequent input, and handle an ongoing scroll gesture explicitly. Verify pan/zoom/drag, transformed input, pane clipping and four-preview composition in the running board.
- [ ] Implement resize, multiselect, align/distribute and keyboard nudge using layout mutations with expected layout versions. Keep dragging transient and send a final layout commit on pointer release; cancel restores the last acknowledged rect. Test zoomed dragging/resizing and a concurrent remote layout conflict without losing source. Do not write manifest state on every pointer move.
- [ ] Implement Select/Interact and Escape/Enter behavior. The frame header remains the drag handle; preview inputs receive real keyboard events in Interact. Mount at most four visible/active previews; other frames show an existing snapshot or an honest placeholder. Give the interacted frame priority. Releasing a slot may reset that frame's transient component state; retain source and explain the reload on return.
- [ ] Build virtualized Components search/focus, useful empty/loading/error views and the compact frame toolbar. Expose only completed actions at each local milestone; Task 12 requires the complete menu. Use actual design names and statuses as accessible labels, not icon-only discoverability.
- [ ] Add Design mode (spec §4). Turn the `BrandMark` in `Sidebar.tsx`'s brand row into a product switcher: a `bg-droid-raised` popover with Chat and Design, current one checked, keyboard-accessible, the same quiet tone as the Codex app's ChatGPT | Codex switcher. The mode is a persisted sidebar preference, not a `SessionInteractionMode`. In Design mode the sidebar lists canvases (Recent, Favorites, Libraries) and the main area shows the Design home: a large centered composer reusing the existing composer and its model/harness/autonomy controls, a design-system picker chip, example-request chips, and a “Your canvases” grid of thumbnail cards (name, last edit, attached-chat count, search). Sending from Design home creates a new canvas and a new chat attached to it in one commit, then opens the workspace with the spec §4 layout (sidebar, ~360 px docked chat column with Agent / Components / Library tabs, board) through the §4 transition: the home composer travels into the chat column's composer slot as one shared-layout animation (180–220 ms), chips and grid fade out, the prompt is the first message, and the pending frame is already placed and blooming when the board fades in. Opening a card opens that canvas with its most recent attached chat. The chat column header's attached-chats menu lists every chat on this canvas and offers “New chat with this canvas”: a fresh session with fresh context attached to the same canvas, the original chat still attached. The canvas takes a provisional name from the prompt and adopts the first design's name unless the user renamed it.
- [ ] Give the expanded board its own top row. When the board is expanded, `UtilityPane`'s header already owns the window's top row (with `WINDOW_CONTROLS_LEAD_PX` for the traffic lights); replace its tab strip there with a small DROIDEX mark and the canvas name on the left in the same tone and weight as the chat title pill, a `Chat | Canvas` segmented control in the existing soft `bg-droid-elevated` pill style beside it, and rename/Open saved canvas as a popover off the name. Chat returns the pane to its docked width; the composer stays where it is. Zoom readout sits bottom-left and Fit plus Select/Interact bottom-right of the board. No new palette, no second brand; verify light and dark in the running app before polishing.
- [ ] Add integration behavior: create a frame through the real bridge owner, click its CTA, pan/zoom and expand the pane, then confirm the CTA stays changed while its preview remains mounted. Close/reopen the pane and confirm source/geometry survive; preview-local React state may reset by contract. Start a new chat with this canvas and an ordinary new chat and assert their attachments differ as specified.
- [ ] Run focused geometry/state/utility tests and `rtk proxy npx playwright test tests/integration/canvas.spec.ts`. Manually inspect light/dark placement with a real chat, narrow utility pane and expanded board. The working create→build→click→reload flow is milestone one, not the final release.

## Task 6: Canvas artifacts in every chat

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/06a-artifact-card`: Add the inline artifact card at the transcript row boundary from safe Canvas activity, build state and cached thumbnails.
  Done: Light/dark cards have keyboard-accessible Open that focuses the frame; failed calls creating nothing produce no card.
- [x] `canvas/06b-chart-runtime`: Choose one React charting library, record its size/license review and bundle it into the compiler allowlist/runtime like the kit module.
  Done: An offline chart example compiles and renders without a CDN; recharts (MIT) is the default candidate.
- [ ] `canvas/06c-artifact-presence`: Reuse shared frame pending bloom and real activity stages for artifacts created from ordinary chats.
  Done: All three harnesses create/open artifacts without design mode, with identical presence and unchanged passing AppBlock tests; a resumed pre-Canvas Codex thread shows the new-chat guidance instead of a broken artifact.

**Files:** Create `src/features/canvas/CanvasArtifactCard.tsx`. Modify `src/components/messageFeedRows.tsx` and `src/components/MessageBody.tsx` at their transcript row boundary. Extend `CanvasActivity` in `sidecar/src/canvas/canvasToolPresentation.ts` with the card's fields and mirror its bridge payload. Extend the compiler import allowlist and runtime packaging for the chosen chart library; keep chart resources beside the kit module.

**Interfaces:** The card consumes a `CanvasActivity` record plus frame build state and a cached thumbnail, never raw source. The activity supplies safe canvas/frame references and title; build state supplies status. Open opens that canvas through `openCanvas` and focuses that frame. The first artifact in a chat opens the pane docked on its frame; later artifacts only add a card.

- [ ] Let any chat's agent create React + Tailwind components, charts, dashboards and small apps on that chat's canvas through the same six tools and compiler, without design mode. Reuse the Task 5 unattached-chat bootstrap (spec §6): a cancelled or lost first create leaves either no canvas or a complete attached canvas whose frames are `cancelled`, never a half-attached one, and a retry with the same mutation ID returns the original result. Support React only, with no HTML/Markdown/SVG artifact kinds. Codex threads started before Canvas shipped have no Canvas tools on resume; the agent's reply then carries no artifact, and the empty state and the card placeholder tell the user to start a new chat with this canvas.
- [ ] Show an inline card with a live thumbnail from cached capture or an honest placeholder, title, build status and Open. Verify light/dark presentation and keyboard-accessible Open; the first artifact in a chat opens the pane docked on its frame, later ones only add a card, and Open focuses the referenced frame. A failed call that created nothing produces no card.
- [ ] Choose one bundled React charting library in `canvas/06b-chart-runtime` after a recorded size/license review; recharts (MIT) is the default candidate. Add it to the import allowlist and package it like the kit module, without a CDN. A representative chart example must compile and render offline.
- [ ] Reuse pending bloom and real queued/writing/building/ready/failed/cancelled stages as shared frame behavior, identical in ordinary chats. Presence comes from actual events and actors, including reduced-motion and hidden/settled cleanup.
- [ ] Run create/build/Open from an ordinary chat on Droid, Claude Code and Codex. Confirm the existing `/visualize` AppBlock stays exactly as is and its tests are unchanged and passing.
- [ ] Run focused activity/card/row-boundary tests, unchanged AppBlock tests and the offline packaged chart smoke. Inspect light/dark cards and keyboard Open in the running app; record ordinary-chat results separately for all three harnesses.

Settled by 06b (`canvas/06b-chart-runtime`):

- Chose `recharts@3.10.1` ([MIT](https://github.com/recharts/recharts/blob/v3.10.1/LICENSE)) with its React 19 peer `react-is@19.2.7` (MIT). The lock adds 39 package entries: 26 MIT, 11 ISC, one BSD-3-Clause and one MIT AND ISC (`victory-vendor`). Recharts' own npm tarball is 7,452,998 unpacked bytes; staging keeps the ESM files reached by its exports, package metadata and license (1,300,036 bytes), without its CommonJS/UMD/types copies. `victory-vendor` has no top-level license file, so staging retains its README license statement and all 13 vendored library licenses. The Sonatype Guide MCP was unavailable for this review; local `npm audit` reported 13 sidecar findings, none in the 39 added packages.
- A design may import exactly `recharts`; the bundler resolves `recharts/es6/index.js` through `canvasRuntime().resolve()` so esbuild drops unused chart exports. The internal subpath itself is not design-allowlisted. Staging keeps the Node compiler dependency closure and the browser modules reachable from all exports of the supported design imports. Both runtime validators pin the ESM entry, check the complete tree against the manifest, and require the staged license inventory. The arm64 stage has 106 packages, 1,406 physical files and 17,583,281 physical bytes, including the manifest and native esbuild binary. No chart asset is fetched at preview time.
- The real compiler worker produced a 528,747-byte offline bar-chart document, 318,472 bytes above the kit example's 210,275 bytes. The packaged probe compiled the same chart from an isolated copy with no ancestor `node_modules`, refused a runtime missing `victory-vendor` or a nested license in both validators, and recorded zero outside module resolutions. A Playwright smoke compiled the fixture independently, loaded it in the production preview guest and observed three rendered bars. An uncaught chart render error produces a diagnostic and never reports preview readiness. x64 packaging was not exercised in this subtask.

## Task 7: Executable design systems and owned image references

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/07a-design-kits`: Complete the DROIDEX, OpenAI-inspired and Claude-inspired executable kits, virtual modules, primitives, guidance and licensed fonts, retaining the Task 6 chart allowlist entry.
  Done: Every kit/mode compiles its working example offline and passes the focused accessibility/contrast check.
- [ ] `canvas/07b-design-system-picker`: Add the composer picker popover (search, light/dark preview toggle, presets then user kits with two swatches each, “Manage design systems” footer) and removable system/reference chips with persisted future-request selection; wire the image drop/picker path to 07d's `importCanvasImage`.
  Done: A queued request retains its pinned kit version after the user changes selection; the picker matches spec §10 and V3 in light and dark.
- [x] `canvas/07c-canvas-theme-tool`: Complete `canvas_theme` list/read/save/apply and source-owned extraction with provenance.
  Done: Apply uses normal revision/CAS, preserves behavior and reports incompatible mappings without mutating the global kit.
- [ ] `canvas/07d-image-references`: Sidecar and Electron owner for validated image import into owned content-addressed storage, offline `canvas-asset:` serving in the preview host, and kit fonts served once by the host.
  Done: Invalid image/path inputs fail; owned images/fonts render offline without exposing private paths.
- [ ] `canvas/07e-manage-design-systems`: Add the manage dialog from spec §10: Presets and Yours list, New from DESIGN.md or CSS/Tailwind config, Colors / Typography / Spacing & Radius / Shadows detail tabs with light/dark toggle, Export and Save a copy, unmapped-token diagnostics, through the same `readDesignSystem`/`saveDesignSystem` owner as `canvas_theme`.
  Done: A kit authored from a pasted DESIGN.md compiles the starter example with the shared primitives; presets stay read-only; web import is absent.

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

Settled by 07d (`canvas/07d-image-references`):

- Electron main is the file permission boundary. Its picker chooses the path, and its drop API accepts only a native `File` path obtained by preload. Main matches the extension to the PNG/JPEG/WebP content, bounds the file, decodes PNG/JPEG with `nativeImage` and WebP with `@napi-rs/canvas`, then sends the path, SHA-256 digest and dimensions over a private loopback bridge route. The sidecar opens that exact file without following its final link and refuses a changed digest; a renderer WebSocket command or agent tool cannot submit a path. Import failures return a curated code and recovery message without the private path.
- The sidecar stores each accepted image as `canvases/<canvasId>/assets/<sha256>` with a durable metadata record and 10 MiB and 8192 × 8192 limits. Identical bytes return the same asset ID. `canvas.listAssets` recovers IDs after a lost reply or deleted source file. The durable-listing crash/reopen case was not red-run. Canvas deletion in 09d must remove these assets; chat deletion or detachment keeps them with the canvas. Composer picker/drop chips and provider multimodal attachment wiring remain owned by 07b; this branch adds no text path to a prompt.
- `canvas-asset:<assetId>` is the source spelling. The artifact read signs each owned reference for its canvas; main also binds each generated preview frame to its canvas and refuses images owned by other canvases. Fonts are global content-addressed kit resources; any bound frame may request an installed kit font by hash. Main refuses image and font requests from unbound guests and the default session. The guest keeps its opaque origin and network-denied session.
- Asset URLs are canvas-scoped by design, so owned image references survive guest replacement and source revisions.
- The three 07a presets import Inter/Lora WOFF2 source and OFL notices from `presets/fonts/*.json`. The stylesheet writer replaces their kit font data URLs with content-addressed host URLs and saves each font once under the profile; no second font loader is needed.
- Known decode limit: Electron `nativeImage` accepts a PNG missing its final CRC byte. The image is still decoded and bounded, but this is not a complete file-integrity check.

Settled by 07a (`canvas/07a-design-kits`):

- The three built-in version-1 kits are `droidex`, `openai-inspired` and
  `claude-inspired`. The latter two are locally authored interpretations, not official
  presets. Each owns complete matching light/dark token maps, including typography,
  spacing, radius, shadow and motion. App chrome is unchanged.
- `readDesignSystem` returns a detached snapshot of the exact pinned version. Built-ins
  are validated and snapshotted on load; user saves retain the existing atomic immutable
  version contract. Schema validation also refuses unmatched mode token names.
- Shared source primitives are copied into each executable kit: native-prop Button
  (`primary | secondary | quiet`), Input (required visible `label`, optional `hint/error`),
  Card and Badge; controlled Tabs (`label`, `items`, `value`, `onValueChange`) with
  Arrow/Home/End navigation skipping disabled tabs; controlled Dialog (`open`, `onClose`,
  `title`, `children`, optional `returnFocusId`/`fallbackFocusId`) using native modal
  behavior, explicit focus cycling at the preview-frame edge, Escape and enabled,
  visible-destination restoration.
  Full signatures, composition rules and an interactive `Hey.tsx` ship with every kit.
  Universal plus kit guidance stays below 2 KiB, inside the existing 16 KiB limit.
- Each light/dark kit provides translucent `--ds-lift` and `--ds-press` layers for
  control hover and press over its own background; hover-only accent colours are gone.
  The guest stylesheet reserves a stable scrollbar gutter so opening a dialog does
  not move the card, and primitives do not lock `body` scrolling.
- Inter Latin variable is embedded in every kit; Claude-inspired adds Lora Latin variable
  for headings. Unmodified Fontsource 5.3.0 WOFF2 subsets use data URLs and ship their
  SIL OFL files both in the repository and the kit's virtual source files. Provenance is
  in `presets/fonts/README.md`; other scripts use the local font stack.
  The kit source retains those data URLs; 07d's stylesheet writer now serves each
  immutable font once through a preview-host asset URL instead of repeating 64 KB
  of Inter, or 115 KB of Inter plus Lora, in every artifact.
- `lucide-react` is pinned to 0.460.0, the app's existing version. The shared browser
  module graph stages its ESM files, package metadata and ISC licence alongside Recharts;
  unused Lucide CJS is absent. The flat design import allowlist includes `lucide-react`
  and `recharts`, resolving their internal ESM entries through the owned runtime while
  refusing public deep imports. `designStylesheet.ts` already scans the complete
  snapshot with Tailwind 3 and needed no replacement path or dynamic-class guessing.
- Compiler coverage exercises all six kit/mode starters and bounds a single named icon's
  incremental output to 10 KiB. Contrast coverage checks the actual primitive foreground,
  muted, primary, lifted, pressed, badge and error pairs against AA 4.5:1. The staged
  offline probe compiles all six starters and the chart, checks font and Lucide notices,
  and retains both damaged-runtime and resolver-isolation checks. Electron interaction
  checks cover state, disabled controls, tabs, dialog focus cycling, Escape, restoration
  and font load.


Settled by 07c (`thread/canvas-07c-canvas-theme`):

- 04b wires `listDesignSystems()` and the existing `readDesignSystem(ref)` /
  `saveDesignSystem(system)` from `sidecar/src/canvas/designSystems.ts` directly.
  Listing returns presets followed by each user's latest immutable version, with
  `{ id, version, name, kind: 'preset' | 'user', swatches: { light, dark } }`;
  each mode has `{ surface, accent }`. Missing semantic swatches are transparent.
  The bounded summary header publishes atomically with the kit in the same version
  file. There is no second storage tree or metadata index. Preset saves throw
  `preset_read_only`; unavailable pinned versions throw `version_mismatch`.
- The existing MCP apply operation calls `applyDesignSystem(workspace, scope, input)` from
  `sidecar/src/canvas/applyDesignSystem.ts`, where input is
  `{ designId, expectedRevisionId: string | null, system: DesignSystemRef, mutationId }`.
  It returns `{ status: 'applied', receipt: WriteReceipt }` or
  `{ status: 'refused', diagnostics: CanvasDiagnostic[] }`. Authorization, CAS,
  mutation replay and build admission remain in `workspace.write`; its async
  source validator runs after replay/CAS and before any revision is published.
  Missing tokens report `unmapped_token` once per token with a source file/line.
  A missing kit version reports `version_mismatch`. Ordinary scope/CAS/storage
  failures remain `CanvasCommandError` for 04b's shared error boundary. MCP keeps
  its receipt success envelope and payload-free code/message refusal envelope;
  token/CSS diagnostics use `invalid_source`, missing versions use `version_mismatch`.
- The pure extraction helper is `extractDesignSystem(files, { name, sourceCanvasId, from })`
  from `sidecar/src/canvas/extractDesignSystem.ts`, with `from: RevisionRef`.
  `sourceCanvasId` is required because `RevisionRef` contains only design/revision
  IDs. Extraction is not yet an MCP operation or pane action. Its future boundary
  must supply the authorized canvas identity, never a model-selected canvas, and
  read the revision under the original live scope; it must not remint authority.
  MCP-authored saves exclude provenance rather than accepting model claims.
  The result is `{ status: 'extracted', system, diagnostics }` or
  `{ status: 'refused', diagnostics }`. Saving the extracted draft uses the same
  `saveDesignSystem(system)` owner. Provenance is
  `{ sourceCanvasId, revision: from }` on the immutable kit.
- Extraction accepts explicit global CSS tokens (`:root`, `html`, and root
  `data-mode` light/dark selectors), primitive `.ds-*` CSS overrides and dedicated
  modules with explicit named Button/Input/Card/Badge/Tabs/Dialog exports plus
  their owned relative dependencies. Imported kit implementations, inline/scoped
  token interpretations and ambiguous exports are reported instead of inferred.
  Missing primitives use the shared implementations and base styles; required
  tokens use the shared DROIDEX defaults with owned values overlaid in each mode,
  not values inherited from the source canvas's selected kit.
  Missing mode counterparts, competing values and guidance over 16 KiB are refused;
  source-owned `DESIGN.md` guidance is never truncated. No checklist items are ticked.

## Task 8: Element selection, direct edits and source/history UI

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/08a-source-elements`: Implement AST-based `sourceElements.ts` instrumentation with source maps and revision-scoped editability.
  Done: Round-trip tests preserve surrounding source and reject stale, repeated or computed edits honestly.
- [ ] `canvas/08b-element-selection`: Add bounded preview selection events, board overlays and the direct inspector with scoped composer references.
  Done: Scale/scroll mapping is correct; Interact clicks remain intact and ambiguous edits route to the agent.
- [ ] `canvas/08c-source-editor`: Add CodeMirror file editing, Save, diagnostics, dirty state and compare/reapply on CAS conflict.
  Done: Agent updates preserve the local buffer; explicit Save creates a source revision.
- [ ] `canvas/08d-revision-history`: Add canonical revision history/diff, read-only viewing and restore through the normal commit/build path.
  Done: Restore creates a new head, retains later history and reports system version/build status.

**Files:** Create `sidecar/src/canvas/{sourceElements.ts,sourceElements.test.ts}` and `src/features/canvas/{CanvasInspector.tsx,CanvasSourceEditor.tsx}`. Extend `compiler.ts`, preview runtime/event schemas, `CanvasWorkspace.ts`, `canvasMcpServer.ts` and Canvas integration tests.

**Interfaces:** Uses Task 2 `SourceElement`. `instrumentSource(files: SourceFiles, revisionId: string): { files: SourceFiles; elements: SourceElement[] }` produces derived instrumented source without modifying canonical files. `ElementEdit = { element: ElementRef; change: { kind: 'text'; value: string } | { kind: 'token'; property: string; token: string } | { kind: 'image'; assetId: string } }`. `applyElementEdit(files: SourceFiles, elements: SourceElement[], edit: ElementEdit): SourceFiles` returns complete changed files or a typed ambiguity/stale-reference error; the caller commits through `write` with the reference's revision.

Settled by 08a (`sidecar/src/canvas/sourceElements.ts` and the compiler/cache path):

- `instrumentSource` uses TypeScript 5.9.3 from the existing lockfile, bundled into the
  existing owned compiler entry. It derives instrumented files before esbuild; Tailwind still
  scans canonical source. The parser adds about 9.6 MiB to that worker bundle. It is compiled
  application code, with no external parser require/package or extra staging/resolution path.
  TypeScript initializes its Node system using `__filename`; the compiler build binds that to
  Node 22's `import.meta.filename`, so it names the owned worker rather than a checkout module.
  The existing runtime manifest/verifier still owns every external package. The sidecar placement
  was measured first and rejected after dense JSX blocked it for two seconds: the existing
  compiler process and deadline must contain parsing too. Sonatype was unavailable; no dependency
  security verdict is implied.
- Every owned native JSX site carries `data-droidex-element`. IDs hash the revision, complete
  canonical source tree, file and offset; offsets are UTF-16 positions in canonical source.
  The inline insertion map carries canonical content into esbuild's composed artifact map.
  Artifact maps omit source content and replace host runtime paths with opaque runtime names.
  IDs are selection hints, never authorization; callers must still commit edits with the selected
  revision as `expectedRevisionId`.
- `applyElementEdit` returns complete contents of changed paths only. It reparses canonical
  source and checks the selection map before replacing one AST range. `SourceElementError.code`
  distinguishes `stale_reference` (reselect), `ambiguous_element` (ask the agent with the original
  reference), `invalid_source`, and `invalid_edit`. There is one edit per call, no batch API.
- Direct scope is a literal site in the entry's default function/arrow. Other component
  definitions, callbacks/maps, JSX stored in variables/arrays, loops, and children passed through
  custom components are shared. Reused/imported entry components are shared too. JSX spreads,
  spread children, computed or split text, computed class names/styles, duplicate attributes or
  style properties, and `children`/`dangerouslySetInnerHTML`/`srcset` overrides are not directly
  editable. An image inside `picture` is computed because a source alternative can override it. Fragments have no DOM marker; native children in conditional branches keep distinct
  sites. A literal site still requires the requested property to have a supported literal range.
- Text editing supports a single JSX text node or string/no-substitution-template expression,
  plus empty paired tags. Token editing replaces an existing literal `var(--token)` in an
  allowlisted React style property; it does not rewrite utility classes or invent style objects.
  Image editing replaces a literal `img src="canvas-asset:<assetId>"`; the bridge refuses image
  edits until 07d's asset store can verify ownership. The edit boundary checks token membership
  against the pinned kit's mode and CSS declarations before committing.
- Ready build frames and restored snapshots carry the exact element map and up to 64 compiler
  diagnostics. Older outcomes without these fields are cache misses and rebuild; cached ranges
  must fit their canonical file. No historical reader or migration was added. `canvas.editElement`
  resolves the current built map, rejects malformed/stale/computed references with curated codes,
  applies the AST edit in the owned compiler worker, and commits changed source through the
  workspace's normal scope and revision CAS. The edit's original request fingerprint and receipt
  live in the mutation ledger, so a retry returns that receipt before checking the now-stale
  selection; ordinary mutation-history pruning applies. A direct edit forks a compiler worker
  for its request so parsing cannot block the sidecar's main loop; the worker is ended after
  settlement.
  The renderer protocol mirror and inbound validator share this contract; preview selection
  events and inspector behavior remain in 08b.
- Measurements on this arm64 checkout, Node 22: kit example (928 bytes, four sites) first
  instrumentation 8.65 ms, warm median 0.43 ms across 29 runs; 1 MiB of source across four
  maximum-sized files 33.91 ms. These exclude parser module loading and worker startup and
  vary with host load. Exact-column inline maps expand that 1 MiB input to 9,438,320 bytes
  inside the worker; esbuild composes them down to the output locations it emits. A deliberately
  dense 256 KiB file with 65,529 JSX sites took 2.02 seconds in the initial probe. Parsing now
  runs in the deadline-owned compiler process. Above `maxSourceElements: 8192`, the worker
  compiles canonical source, returns an empty map, and reports `selection_unavailable` rather
  than publishing a partial map or failing the preview.
  This independent bound also applies at the worker reply and cache boundaries. These are
  probes, not timing assertions in unit tests.

Settled by 08c (`src/features/canvas/{canvasSourceState.ts,CanvasSourcePanel.tsx,CanvasSourceEditor.tsx,CanvasSourceSlot.tsx}`
and `canvas.readSource`):

- The drawer is not CodeMirror. The repository ships `@codemirror/{state,view,commands,language,lang-markdown}`
  for the composer, but no JavaScript, TypeScript, JSX or CSS grammar, and this plan asks for
  explicit justification before a new grammar dependency. A CodeMirror core editor would
  therefore show a design's `.tsx` and `.css` with no colour at all. The app's code colour is
  `prism-react-renderer`, which already highlights TSX, CSS and JSON in the files pane, so the
  editor is a transparent textarea laid over that highlight: the caret, selection, native undo
  and platform keyboard behaviour come free, Cmd/Ctrl+S saves, Tab indents, and the colour is the
  one shared theme. The Prism theme moved from `FilePreviewPane.tsx` to `src/lib/codeTheme.ts` so
  the two surfaces cannot drift. Lines never wrap: that is what keeps the gutter, the highlight
  and the caret on the same line as a build's diagnostics, and the textarea's own scrolling is
  translated into the single shared scroller so the two layers cannot slide apart. The editor is
  one 190-line file behind a lazy boundary with a six-prop contract, so swapping in CodeMirror
  plus a grammar later is a contained change.
- `canvasSourceState.ts` is a pure reducer and the drawer's only state. Buffers are keyed by frame
  and then by path, so leaving a frame and coming back cannot lose an edit; only closing the
  drawer discards them, and that asks first. A buffer holds the draft, the revision the edit began
  from and the file as it read at that revision. `pendingWrite` is the single place a Save is
  assembled: one write, one `expectedRevisionId`, every dirty path, and null while a conflict is
  open or while a save is in flight.
- A revision that lands while a buffer is dirty never replaces it. If the revision left that file
  alone, only the buffer's base moves, because a Save naming the revision the text was typed on
  would be refused for a change somewhere else in the tree. If the revision changed the file, the
  buffer becomes a conflict carrying that revision's text (or null when it deleted the file) and
  the drawer shows "Updated by agent" with Keep mine and Take theirs. Both texts are held — theirs
  in `files`, the user's in the buffer — until the user picks. Keep mine rebases onto the
  superseding revision so the next Save is accepted instead of rejected again; the agent's text
  stays in its own revision either way. Text typed while a save is in flight stays dirty on top of
  the revision that save produced.
- Diagnostics are placed from the real build result, not re-derived. `buildDiagnostics` returns
  nothing for a build that has not produced any yet, so a `building` frame never shows the last
  failure as current. `placeIssues` pins a diagnostic to a file and a 1-based line only when the
  file is one the frame actually lists: esbuild reports the pinned kit as `@droidex/design-system/...`
  and a failure inside a generated module with no file at all, and both are listed without a place
  rather than landing on the wrong line. `column` is esbuild's 0-based UTF-8 byte offset, so it is
  shown in no caret and used for no mapping.
- `canvas.readSource` is the drawer's read: the renderer had no way to read a revision's files, and
  `CanvasWorkspace.readFiles` already existed for the agent. It is a derived read authorized like
  `canvas.subscribe` by the page asking, bounded by `canvasIdentifierSchema` on all three
  identifiers, it leaves the design's head alone, and `canvasFiles.readRevision` already refuses a
  revision belonging to another design. The renderer's inbound validator bounds the reply at the
  sidecar's own 64 files and 256-character paths.
- `openSourcePanel(designId)` in `canvasState.ts` is the event 5d's toolbar dispatches. The drawer
  follows its frame across every board change and closes only once that frame leaves the board, so
  a rebuild or an arrange cannot strand it on a design that is gone. `CanvasSourceSlot` owns the
  lazy boundary and the two bridge calls, which keeps `CanvasWorkspace.tsx` at 488 lines.
- 08c merged `thread/canvas-05a-canvas-pane` because 08a's base has no Canvas pane: nothing could
  import the drawer, so it could be neither seen in the running app nor measured in the bundle.
  Until the board mounts in 5b, 05a's placeholder plate offers Source per frame; 5c and 5d replace
  that placeholder wholesale.
- Measured: entry 1,433,651 bytes against the 1,434,000 line, largest lazy chunk 691,095, and the
  drawer's own chunks 10,671 (panel) and 2,822 (editor), both lazy. Prism lands in one shared
  chunk, so the duplicate-dependency scan stays clean. CSS is 102,189, which needed
  `initialCssBytes` raised from 101,500 to 103,200: the Canvas pane alone measures 100,978 — 522
  under the old line before the drawer existed — and the drawer's chrome is ~1,350. Trimming its
  one-off utilities to the shared scale recovered 42 bytes, so the raise is the honest accounting,
  and `tools/check-bundle-budgets.mjs` carries it. `reduceCanvasPane` goes from a complexity
  warning of 18 to 22 for the two drawer events, and `isReply` from 17 to 18 for the `source`
  reply; both were already over the advisory line and neither is an error.
- Deferred to 08d and later: revision comparison and the side-by-side diff a conflict could offer
  (the drawer states both sides and keeps them, but does not draw a diff yet), creating, deleting
  or renaming files from the drawer, and a read-only view of an older revision. Nothing autosaves.

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

## Task 9: Variants, local library and durable board undo

**Settled by 09a (sidecar):** `create` copies pinned revision seeds into independent first revisions, persists source canvas/design/revision provenance, and answers mutation retries without adding frames. `placeBeside: { designId }` reserves collision-free two-column rows below the source with the existing 80 px gap; placement uses the live board at commit and never moves existing frames. The bridge validates seeds, placement and the 1–4 count. Current leases authorize one canvas, so cross-canvas seeds are refused. Follow-up turns already pin the returned designs/revisions through `CanvasTurnContext.designs` and `allowedDesignIds`; no additional targets or presence field was added. The renderer popover still needs layout/style/color choices, direction, count (default two), one pinned source revision/system, one creation request and one ordinary composer action targeting the returned designs. Task 04b still needs to expose `seed` and `placeBeside` through `canvas_create` MCP wiring and bind tool calls to the existing turn scope. UI, MCP and end-to-end acceptance remain open; no checklist items are ticked here.

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/09a-variants`: Add pinned layout/style/color variant requests, deterministic adjacent placement and explicit target scopes.
  Done: Idempotent creation leaves the original and siblings independent, including a failed sibling build.
- [ ] `canvas/09b-duplicate-rename-library`: Implement duplicate/rename and searchable immutable local library copies with independent insertion.
  Done: Reuse still works after original-canvas deletion and empty-library guidance explains Add to library.
- [x] `canvas/09c-delete-undo`: Implement persisted frame tombstones, reopen-safe Undo and inverse board geometry with layout CAS.
  Done: Undo restores source/location and surfaces remote-layout conflicts without replaying stale moves.
- [ ] `canvas/09d-saved-canvases-and-deletion`: Add Open saved canvas and explicit whole-canvas deletion with affected attachment disclosure.
  Done: Deletion unlinks attachments and cancels work while preserving independent library items; chat deletion retains canvas source.

**Files:** Create `src/features/canvas/CanvasVariants.tsx` and `sidecar/src/canvas/{canvasLibrary.ts,canvasLibrary.test.ts}`. Extend Task 2 workspace/schema/protocol, Task 5 navigator/toolbar and Task 8 history UI. Add focused cases to `CanvasWorkspace.test.ts` and `tests/integration/canvas.spec.ts`.

**Interfaces:** `LibraryItem = { itemId: string; name: string; sourceCanvasId: string; source: RevisionRef; designSystem: DesignSystemRef }`. `saveLibraryItem(input: Omit<LibraryItem, 'itemId'>): Promise<LibraryItem>` stores an independent immutable copy of source/assets plus revision provenance; `listLibraryItems(query: string): Promise<LibraryItem[]>` returns bounded summaries. Insertion uses `create` with `{ kind: 'library', itemId }` and makes an independent design. Workspace additions: `removeFrames(scope: CanvasScope, mutationId: string, designIds: string[]): Promise<{ undoId: string }>`, `undoRemoval(scope: CanvasScope, mutationId: string, undoId: string): Promise<CanvasChange>`, `renameFrame(scope: CanvasScope, mutationId: string, designId: string, name: string): Promise<CanvasChange>`, and `removeCanvas(canvasId: string): Promise<void>` behind an explicit app deletion action.

Settled by 09c (sidecar workspace and protocol):

- Delete and Undo commit persisted tombstones and retry receipts through the existing scope gate and sequence queue; deleting a frame cancels its build, and Undo restores its revision, name and rect after checking for new or moved occupants under that rect (`layout_conflict` carries the current occupant rect).
- Rename takes `expectedManifestVersion` as a fifth workspace argument and on the bridge input, since the four-argument draft had no caller-supplied CAS token; source, layout and build commits advance that version.
- The last 50 removals retain Undo; retiring an older tombstone drops only its Undo entry. Undo is bounded by count, not time, and survives reopening. Canonical revisions and assets remain until explicit deletion of the owning canvas or library item; derived-cache cleanup never touches source (spec §7).
- `canvas_read` is owned by Task 4 and is absent on this base; `CanvasWorkspace.readFiles` already returns a curated not-found with an Undo hint for a removed frame, which that tool must pass through.

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

## Task 10: Source export, image capture and lifecycle recovery

**Subtasks (one branch and PR each, merged in order):**

- [x] `canvas/10a-source-export`: Export the selected source revision, owned assets, pinned kit source/guidance/examples/fonts/licenses and a buildable project with exact runtime versions to a chosen directory.
  Done: The exported Hey example runs outside checkout; path escapes and overwrite collisions leave existing content intact.
- [x] `canvas/10b-image-capture`: Implement one bounded rendered-revision capture for PNG export and inspect screenshots.
  Done: Timeout/abort/generation-change tests settle independently; unavailable capture returns an honest error.
- [x] `canvas/10c-lifecycle-recovery`: Complete profile isolation and queue/worker/preview/subscription/MCP/waiter shutdown ownership.
  Done: Repeated close is harmless and reused provider handles reject old writes/events; committed source survives failures.

Settled by 10a (`thread/canvas-10a-source-export`):

- Source export reads the immutable revision and its pinned kit version from Canvas storage. It writes the source unchanged under `src/`, all kit files under `design-system/`, guidance and examples under `canvas-export/`, selected mode values under `canvas-export/`, referenced owned images under `assets/`, and embedded kit fonts under `fonts/`. Conversation records and build artifacts are excluded.
- Electron main alone chooses the destination through `showOpenDialog` and calls the sidecar's validated HTTP route with a separate per-sidecar secret. The renderer receives only the result; that secret is stripped from agent and terminal child environments. The ordinary Canvas WebSocket has no export command.
- The export includes a local build/preview script, a README and exact direct dependency versions resolved from the owned Canvas runtime. Generating a complete lockfile would require package resolution at export time, so export does not invoke npm or the network; the README explains that transitive packages resolve during installation. `lucide-react` uses the exact version in the root lockfile until Task 7 stages it in the Canvas runtime. An export requires an empty chosen folder, stages beside it, and publishes the complete project by rename.
- An in-flight export pins an immutable revision and completes as that snapshot even if the whole canvas is deleted; deletion must not cancel it.
- The current integration branch has no Canvas board controls yet. Task 5's board context action must call `exportCanvasSource` from `src/lib/desktop.ts` for its selected revision when that branch lands. The 10a test builds and serves the Hey starter from a temporary directory with local installed packages; it does not exercise a browser render or a packaged runtime.

**Files:** Create `sidecar/src/canvas/{canvasExport.ts,canvasExport.test.ts}`. Extend the existing Electron file-save/capture bridge at its actual owner and Canvas context actions; inspect `electron/main.cjs` and `electron/preload.cjs` before placing code. Extend runtime smoke and workspace/build teardown tests.

**Interfaces:** `exportCanvasSource(canvasId: string, ref: RevisionRef, destinationDirectory: string): Promise<{ filesWritten: number }>` writes only to an explicit user-chosen directory. `captureCanvasImage(canvasId: string, ref: RevisionRef, signal: AbortSignal): Promise<{ mediaType: 'image/png'; bytes: Uint8Array }>` captures the exact rendered revision with a six-second deadline. Both require the authorized host boundary; generated code cannot choose paths or invoke export.

- [ ] Export the selected revision's source tree, owned assets, kit source/tokens/fonts/licenses and a minimal README explaining its locked runtime imports and entry point. Include sufficient build metadata to run that source with the repository's supported toolchain; no private prompts, session logs, credentials or absolute local paths. Refuse overwrite collisions until the user chooses another directory or explicitly confirms replacement through the app's normal file flow.
- [ ] Export PNG through the proven preview host at the frame's CSS size/device scale, bound dimensions and result bytes, and preserve transparent content when present. If capture is unavailable or times out, report it and keep source export available. Do not return a previous revision's thumbnail as a current screenshot.
- [ ] Add inspect screenshot support using the same bounded capture operation; no second capture engine. The model gets a real image or `capture_unavailable`. Test timeout, abort and generation change during capture with controlled promises; source writes and chat completion must settle independently of capture.
- [ ] Validate exported paths/content in a temporary directory and run the exported Hey example outside the app's source checkout. Assert no path escape and no internal canary in exported metadata. Refusing an existing destination file must leave it byte-identical.
- [ ] Complete shutdown/profile isolation: cancel queues before awaiting external cleanup, terminate compiler workers, stop preview hosts/subscriptions, revoke MCP scopes, and release all waiters. Verify repeated close is harmless and a new session with a reused provider handle cannot accept old writes/events. Run failure cases with locked/unavailable capture, not only a visible happy-path window.
- [ ] Run focused export, teardown and runtime tests; manually export a stateful design and confirm PNG and source describe the selected revision. Record capture limitations honestly.

Settled by 10b (`thread/canvas-10b-image-capture`):

- Electron main captures the already attached preview guest through `webContents.capturePage`, after reading that guest's mounted design, revision and mount generation from the trusted intermediate. It captures the guest's CSS rectangle at its device scale, refuses more than 4,096 physical pixels on either edge, 16 million pixels total or 8 MiB of PNG, refuses a display Electron reports as locked, and settles after six seconds. Guest destruction, main's watchdog, renderer abort, a resized or replaced preview and canvas-pane unmount cancel pending work. No generated code, source write or agent turn participates in capture.
- `captureCanvasImage(canvasId, ref, signal)` is the renderer operation over that Electron boundary. A ready preview populates a 32 MiB bounded thumbnail cache keyed by canvas, design and revision; `canvasThumbnailRead` exposes its exact-revision read through the preload bridge. `exportCanvasImage` sends captured PNG bytes to the OS save dialog and writes only its selected path. Unavailable capture returns `capture_unavailable`; a save failure returns `storage_failed`. The kit starter and a transparent design captured in the real Electron host; the starter's 720×720 CSS capture at 2× produced a 1,440×1,440 PNG in 56.02 ms in the final full arm64 smoke.
- This base (`84480d9a`) has no Canvas board/context actions, artifact card or `canvas_inspect` MCP tool yet. Their controls and model screenshot delivery remain with Tasks 05, 06a and 04 respectively; the capture API and cache read are available for those owners. Task 10's checkbox stays open, as source export and lifecycle recovery are separate subtasks.

Settled by 10c (builds/shutdown):

- Shutdown refuses new Canvas commands, revokes turn scopes before session-file reconciliation settles, and starts Canvas cleanup without waiting for sessions or automation persistence.
- Abandoning a compile cancels cooperatively, then uses bounded compiler termination; replacement work never reuses the abandoned child.
- Build close starts compiler termination before draining storage, still waits for its runs, and publishes no late ready outcome.
- Concurrent compiler termination joins one promise that settles on child exit, including the controlled grace-kill path. The worker flushes `stopped` before exiting.
- Failing-first regressions cover held reconciliation/session cleanup, abandoned child ownership, held artifact storage, and acknowledgement versus exit. Storage exclusion, watches, and commit-queue recovery belong to the parallel 10c thread; no Task 10 checkbox is completed here.

Settled by 10c (storage/bridge):

- Physical Canvas roots have one atomic writer lease, including linked roots across profiles; live writers are refused before loading or cleanup, and close, failed open and confirmed process death release ownership.
- Last-pane unsubscribe/page loss cancels pane-only queued and running builds; a live turn on that canvas retains its accepted work, and other panes or canvases keep theirs. Pending subscriptions revalidate their own identity after storage opens, so unsubscribe cannot resurrect a watch or rebuild.
- Closing the commit queue rejects queued and new callers without waiting for active I/O, while still awaiting admitted staging and durable writes. Single commit ownership, flush-before-publish and publication-time CAS remain unchanged.

## Task 11: Motion, accessibility and measured performance

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/11a-canvas-motion`: Implement feature-local motion tokens and truthful bloom, ready reveal and actor presence from real events.
  Done: Busy animation stops offscreen, hidden, settled and under reduced motion; direct input stays immediate.
- [ ] `canvas/11b-keyboard-and-identity`: Preserve mounted frame identity and add roving focus, restoration and concise accessible status announcements.
  Done: Pane/inspector transitions retain state and text inputs keep ordinary editing shortcuts.
- [ ] `canvas/11c-canvas-performance`: Measure the mixed board workload, live slots, close/reopen memory and idle work, then run replay and bundle gates.
  Done: Recorded hardware evidence meets §11 targets; a miss blocks completion until it is fixed or the §11 contract is deliberately revised and recorded. Closed Canvas stays out of startup loading.
- [ ] `canvas/11d-visual-pass`: Compare the running app with both videos and record narrow/expanded light/dark and reduced-motion behavior.
  Done: Observed bloom, reveal, toolbar, variants, anchored zoom and expansion satisfy visual acceptance.

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

## Task 12: Full acceptance, documentation and implementation handoff

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/12a-acceptance-matrix`: Run spec §12 flows on every supported harness, including create, interact, edits, variants, reuse and reload.
  Done: Provider create/resume/close evidence is recorded separately; auth/quota limitations remain unverified.
- [ ] `canvas/12b-repository-gates`: Run the listed Node.js 22 repository checks and include replay plus packaged arm64/x64 evidence.
  Done: Applicable gates pass with existing coverage/suppression policy; later fixes rerun affected checks.
- [ ] `canvas/12c-docs-and-demo`: Document discoverable workflow/limits in architecture, Canvas docs, README and app help; record the product demo.
  Done: Documentation describes implemented behavior and the demo shows real clicks and persisted designs in both pane sizes.
- [ ] `canvas/12d-final-review-and-cleanup`: Review identity, stale work, ownership, controls, privacy and limits; remove scratch artifacts and superseded paths.
  Done: The handoff reports actual checks, measurements, verification rows and remaining limitations without claiming undelivered work.

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

Run `npm run docs:generate` before `docs:check` when script/environment documentation changes. Retain existing coverage thresholds and lint suppressions policy. Include the Task 11 replay evidence and actual packaged arm64/x64 runtime evidence in the handoff; unsigned testing does not authorize a signed release.

- [ ] Document discoverable Canvas entry, one-composer workflow, Select/Interact, shortcuts, supported source/imports, kit versions, direct-edit limits, state reset on revisions/eviction, local storage, export, recovery and the exact privacy guarantee. Link the workflow from README and the in-app empty state/help. Add the honest feature sentence from the spec only after the feature exists.
- [ ] Record a short product demo using both the narrow utility pane and expanded canvas. Demonstrate actual clicks and persisted designs rather than only generation animation. Use the original recordings as reference; do not redistribute them as DROIDEX marketing assets.
- [ ] Self-review the final diff for identity mistakes, stale results, duplicate state, dead old paths, wrappers, oversized modules, unusable controls, prompt leakage and undocumented limits. Remove scratch probes/reports and keep only valuable tests. Do not add compatibility code for the old PR. Keep changed-file descriptions factual and small.
- [ ] Finish with implemented behavior, tests actually exercised, measured performance, provider/platform verification rows and remaining limitations. If a release criterion is unverified or failing, state that explicitly. Commit/push/open PR only when authorized; this plan does not grant that authorization.

## Follow-ups

Noted during execution; not in any task's scope. Each needs its own change and review.

- `tests/smoke/*.ts` and `tests/integration/*.ts` are outside the typed ESLint file set (`eslint.config.js`) and every `tsconfig`. This predates Canvas and covers the existing Electron smokes too. Add a focused test tsconfig and lint coverage for `tests/` as a repository-wide change.
- Canvas storage leaves an empty canvas directory or a stray `.tmp` behind when a bootstrap crashes between `mkdir` and the first manifest rename. Nothing serves or reads it, but `CanvasWorkspace.open` only cleans staging under canvases that have a manifest. Sweep manifest-less canvas directories at open (02b review, accepted as a follow-up).
- The 4096 unsettled-receipt ceiling in `canvasManifest.ts` is enforced and documented but exercised only through a fixture-built ledger, never through real commits. Acceptable while no lease can realistically issue that many mutations; revisit if Task 5 board interactions mint long-lived UI leases.
- `sidecar/src/canvas/CanvasWorkspace.test.ts` sits at 798 effective lines against the 800 cap. The next behavior that needs a workspace-level test must first move an existing contract to its module's owner suite (`canvasHeads`, `canvasLeases`, `canvasFrames`, `canvasManifest`) rather than grow this one.
- `Bridge.send` now returns `false` when the renderer's offline queue holds `MAX_QUEUED_COMMANDS`, and the sidecar holds up to `MAX_HELD_CLIENT_MESSAGES` frames while admitting a socket (02c). Nothing presents a refused command to the user yet, and the 64-frame headroom for live commands sent during admission is not enforced on callers (voice sends freely). Surface refusals in the UI and bound live admission traffic as one bridge-level change.
- The Canvas renderer client logs a failed gap-recovery resync and retries on the next change; it has no error channel. Task 5 surfaces it in the pane.
- A failed frame names the revision it falls back to, but the artifact document for that revision may be gone from the derived cache. The manifest pointer is the truth and survives; `CanvasBuilds.readArtifact` answers `null`, as its contract says, and the frame shows an honest placeholder beside its diagnostics. Rebuilding that revision on demand belongs with Task 5, where the Retry control lives and there is a user action to attach the work to (03b review cycle 1, accepted as a follow-up).

## Plan self-review and handoff checklist

The plan maps every included product requirement to a task in spec §12. Shared types live in Task 2; source mapping, kits, library and export contracts are introduced by their owning tasks. The five Review Focus cases each have an explicit test owner. Task 1 has three explicit feasibility gates: preview-host CPU isolation, the per-session server + turn-lease binding on all three adapters (including Codex forwarding), and the packaged compiler. Each must be resolved before its production boundary is implemented; none is claimed as already verified.

Before execution, re-read the two recordings at their original locations linked in the spec, and inspect the current branch for intervening changes. Use the plan as a sequence of reviewable outcomes, not permission to create unnecessary files or abstractions. Completion means the entire included local workflow works coherently with all three harnesses and the shared Canvas tooling.
