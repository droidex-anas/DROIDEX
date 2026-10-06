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
- Retries are retained per lease, not per count. Each record carries the `scopeId` that issued it and a sha256 digest of its command's canonical arguments; the same ID with the same digest answers the original result and the same ID with a different digest or a different command is `invalid_input`. A record whose scope is still active is never retired, so a retry under a live lease always finds its receipt; records whose scope has settled give way oldest first past 256. There is no list of retired IDs: once a lease is gone nothing can retry under it, so an ID that is no longer found is executed as the new request it now is. Nothing retires an unsettled record: past 4096 of them on one canvas the ledger refuses the new mutation with `storage_failed` ("too many unsettled mutations") instead, because retiring one would let its retry run a second time. Settled records still give way, so the refusal clears as turns finish or are interrupted.
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
- [ ] `canvas/03b-build-queue`: Implement `CanvasBuilds.ts` with two slots, coalescing, a 15 s deadline, `canPublish`, last-working artifacts and persisted outcomes.
  Done: Controlled-promise tests reject stale publication and release every slot and waiter once.
- [ ] `canvas/03c-preview-guest-host`: Enable app-window `webviewTag` and §6 attachment hardening, owned privileged scheme/trusted intermediate, `previewDocument.ts`, `previewRuntime.ts` and `DesignPreview.tsx`.
  Done: Bounded pull polling and main-owned watchdog/termination pass Electron smoke through the production boundary.
- [ ] `canvas/03d-compiler-packaging`: Promote the sidecar runtime dependency and package `extraResources` under `sidecar/canvas-runtime` per §6 with `ESBUILD_BINARY_PATH`.
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
- `load` reads those outcomes when the workspace opens; anything the manifest does not vouch for
  leaves the frame `pending`. `requestRebuilds(snapshot)` is the on-demand
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

- [ ] `canvas/04a-canvas-turn-scope`: Implement `canvasTurnContext.ts` mint/check/revoke at the §6 lifecycle seams and carry context beside prompt text through send, queue, send-now and steer.
  Done: Tests preserve pinned contexts and reject expired or replaced-provider scopes after awaits.
- [ ] `canvas/04b-canvas-mcp-server`: Implement the six tool schemas/descriptions, HTTP resource for Droid/Claude, Codex `inAppServers`, Claude PreToolUse read binding, collision checks and cleanup.
  Done: Extend `codexTools.test.ts`; stale calls, reserved-name collisions and startup failure clean up correctly.
- [ ] `canvas/04c-canvas-transcript-projection`: Implement `canvasToolPresentation.ts` and wire its projector through event flow, timeline, native parsers, search and export.
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

## Task 5: Persistent Canvas in the utility pane

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/05a-canvas-pane-and-empty-state`: Add utility-tool type/picker/lazy surface, `CanvasWorkspace.tsx` shell, Create/Open saved canvas empty state and atomic attachment bootstrap.
  Done: `canvasState.ts` snapshot/change subscriptions reconcile state; opening an empty pane creates no design or compiler.
- [ ] `canvas/05b-board-geometry-and-gestures`: Implement `canvasGeometry.ts` and tests plus `CanvasBoard.tsx` pan/zoom/fit, pointer capture and transient frame dragging.
  Done: Zoom anchors correctly; drag commits once on release and cancellation restores acknowledged geometry.
- [ ] `canvas/05c-frames-selection-previews`: Implement `DesignFrame.tsx`, Select/Interact, Escape/Enter, multiselect/align/nudge/resize and four live slots with placeholders using `DesignPreview`.
  Done: Running-board transformed input, clipping, ongoing gestures and layout conflicts preserve source and mounted preview state.
- [ ] `canvas/05d-navigator-and-toolbar`: Build virtualized `CanvasNavigator.tsx` search, `CanvasToolbar.tsx`, completed context actions and zoom readout.
  Done: Named/status-labeled controls work in empty/loading/error states and search focuses the requested frame.
- [ ] `canvas/05e-full-canvas-header`: Add the DROIDEX mark, Canvas wordmark, Chat | Canvas segmented control and canvas picker popover in the expanded header.
  Done: Light/dark inspection and `tests/integration/canvas.spec.ts` verify pane transitions, real CTA input and persisted attachments.

**Files:** Create `src/features/canvas/{CanvasWorkspace.tsx,CanvasBoard.tsx,DesignFrame.tsx,CanvasToolbar.tsx,CanvasNavigator.tsx,canvasState.ts,canvasGeometry.ts,canvasGeometry.test.ts,canvasState.test.ts}` and `tests/integration/canvas.spec.ts`. Modify `src/lib/{utilityPanel.ts,lazySurfaces.tsx}`, `src/components/utility/{UtilityPane.tsx,utilityToolOptions.ts}`, `src/App.tsx`, `src/hooks/{useStore.tsx,persistedUiPreferences.ts}` and their existing focused tests. Reuse Task 3 `DesignPreview.tsx`.

**Interfaces:** `CanvasWorkspace` consumes `{ appSessionId: string; canvasId: string | null; isExpanded: boolean }` plus focused bridge callbacks using the existing connection pattern. `applyCanvasChange(snapshot: CanvasSnapshot, change: CanvasChange): CanvasSnapshot` updates the feature-local projection. Geometry exports `screenToCanvas(viewport: Viewport, point: Point): Point`, `zoomAtPoint(viewport: Viewport, point: Point, scale: number): Viewport` and `fitFrames(rects: FrameRect[], viewportSize: Point): Viewport`, with `Point = { x: number; y: number }` and `Viewport = { x: number; y: number; scale: number }`. Frame/source ownership remains in Task 2.

- [ ] Add Canvas to the utility-tool type, picker, singleton handling, expandable tools and lazy surfaces. Keep only attachment IDs/pane preferences in shared state; viewport/selection/inspector state belong to the Canvas feature. Opening Canvas without an attachment presents the empty state with Create and Open saved canvas. Bootstrap an empty canvas/attachment atomically on explicit Create or the first `canvas_create`, following the unattached-chat sequence in spec §6: the turn's lease already exists with `canvasId: null`, the first create commits canvas, attachment and the lease's canvas binding together under the workspace commit owner, and a retry with the same mutation ID returns the same canvas and frames. Merely opening the pane does not start a compiler or create a design.
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
- [ ] Give the expanded board its own top row. When the Canvas tab is expanded, `UtilityPane`'s header already owns the window's top row (with `WINDOW_CONTROLS_LEAD_PX` for the traffic lights); replace its tab strip there with a small DROIDEX mark and “Canvas” wordmark on the left in the same tone and weight as the chat title pill, a `Chat | Canvas` segmented control in the existing soft `bg-droid-elevated` pill style beside it, and the canvas picker (name, saved canvases, Create) as a popover off the wordmark. Chat returns the pane to its docked width; the composer stays where it is. Zoom readout sits bottom-left and Fit plus Select/Interact bottom-right of the board. No new palette, no second brand; verify light and dark in the running app before polishing.
- [ ] Add integration behavior: create a frame through the real bridge owner, click its CTA, pan/zoom and expand the pane, then confirm the CTA stays changed while its preview remains mounted. Close/reopen the pane and confirm source/geometry survive; preview-local React state may reset by contract. Start a new chat with this canvas and an ordinary new chat and assert their attachments differ as specified.
- [ ] Run focused geometry/state/utility tests and `rtk proxy npx playwright test tests/integration/canvas.spec.ts`. Manually inspect light/dark placement with a real chat, narrow utility pane and expanded board. The working create→build→click→reload flow is milestone one, not the final release.

## Task 6: Canvas artifacts in every chat

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/06a-artifact-card`: Add the inline artifact card at the transcript row boundary from safe Canvas activity, build state and cached thumbnails.
  Done: Light/dark cards have keyboard-accessible Open that focuses the frame; failed calls creating nothing produce no card.
- [ ] `canvas/06b-chart-runtime`: Choose one React charting library, record its size/license review and bundle it into the compiler allowlist/runtime like the kit module.
  Done: An offline chart example compiles and renders without a CDN; recharts (MIT) is the default candidate.
- [ ] `canvas/06c-artifact-presence`: Reuse shared frame pending bloom and real activity stages for artifacts created from ordinary chats.
  Done: All three harnesses create/open artifacts without design mode, with identical presence and unchanged passing AppBlock tests; a resumed pre-Canvas Codex thread shows the new-chat guidance instead of a broken artifact.

**Files:** Create `src/features/canvas/CanvasArtifactCard.tsx`. Modify `src/components/messageFeedRows.tsx` and `src/components/MessageBody.tsx` at their transcript row boundary. Extend `CanvasActivity` in `sidecar/src/canvas/canvasToolPresentation.ts` with the card's fields and mirror its bridge payload. Extend the compiler import allowlist and runtime packaging for the chosen chart library; keep chart resources beside the kit module.

**Interfaces:** The card consumes a `CanvasActivity` record plus frame build state and a cached thumbnail, never raw source. The activity supplies safe canvas/frame references and title; build state supplies status. Open attaches/opens that canvas through the existing pane path and focuses that frame. Creating an artifact does not open the pane.

- [ ] Let any chat's agent create React + Tailwind components, charts, dashboards and small apps on that chat's canvas through the same six tools and compiler, without design mode. Reuse the Task 5 unattached-chat bootstrap (spec §6): a cancelled or lost first create leaves either no canvas or a complete attached canvas whose frames are `cancelled`, never a half-attached one, and a retry with the same mutation ID returns the original result. Support React only, with no HTML/Markdown/SVG artifact kinds. Codex threads started before Canvas shipped have no Canvas tools on resume; the agent's reply then carries no artifact, and the empty state and the card placeholder tell the user to start a new chat with this canvas.
- [ ] Show an inline card with a live thumbnail from cached capture or an honest placeholder, title, build status and Open. Verify light/dark presentation and keyboard-accessible Open; the pane opens only on Open and focuses the referenced frame. A failed call that created nothing produces no card.
- [ ] Choose one bundled React charting library in `canvas/06b-chart-runtime` after a recorded size/license review; recharts (MIT) is the default candidate. Add it to the import allowlist and package it like the kit module, without a CDN. A representative chart example must compile and render offline.
- [ ] Reuse pending bloom and real queued/writing/building/ready/failed/cancelled stages as shared frame behavior, identical in ordinary chats. Presence comes from actual events and actors, including reduced-motion and hidden/settled cleanup.
- [ ] Run create/build/Open from an ordinary chat on Droid, Claude Code and Codex. Confirm the existing `/visualize` AppBlock stays exactly as is and its tests are unchanged and passing.
- [ ] Run focused activity/card/row-boundary tests, unchanged AppBlock tests and the offline packaged chart smoke. Inspect light/dark cards and keyboard Open in the running app; record ordinary-chat results separately for all three harnesses.

## Task 7: Executable design systems and owned image references

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/07a-design-kits`: Complete the DROIDEX, OpenAI-inspired and Claude-inspired executable kits, virtual modules, primitives, guidance and licensed fonts, retaining the Task 6 chart allowlist entry.
  Done: Every kit/mode compiles its working example offline and passes the focused accessibility/contrast check.
- [ ] `canvas/07b-design-system-picker`: Add the composer picker and removable system/reference chips with persisted future-request selection.
  Done: A queued request retains its pinned kit version after the user changes selection.
- [ ] `canvas/07c-canvas-theme-tool`: Complete `canvas_theme` list/read/save/apply and source-owned extraction with provenance.
  Done: Apply uses normal revision/CAS, preserves behavior and reports incompatible mappings without mutating the global kit.
- [ ] `canvas/07d-image-references`: Import validated images through existing picker/drop and multimodal paths into owned content-addressed storage.
  Done: Invalid image/path inputs fail; owned images/fonts render offline without exposing private paths.

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

## Task 8: Element selection, direct edits and source/history UI

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/08a-source-elements`: Implement AST-based `sourceElements.ts` instrumentation with source maps and revision-scoped editability.
  Done: Round-trip tests preserve surrounding source and reject stale, repeated or computed edits honestly.
- [ ] `canvas/08b-element-selection`: Add bounded preview selection events, board overlays and the direct inspector with scoped composer references.
  Done: Scale/scroll mapping is correct; Interact clicks remain intact and ambiguous edits route to the agent.
- [ ] `canvas/08c-source-editor`: Add CodeMirror file editing, Save, diagnostics, dirty state and compare/reapply on CAS conflict.
  Done: Agent updates preserve the local buffer; explicit Save creates a source revision.
- [ ] `canvas/08d-revision-history`: Add canonical revision history/diff, read-only viewing and restore through the normal commit/build path.
  Done: Restore creates a new head, retains later history and reports system version/build status.

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

## Task 9: Variants, local library and durable board undo

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/09a-variants`: Add pinned layout/style/color variant requests, deterministic adjacent placement and explicit target scopes.
  Done: Idempotent creation leaves the original and siblings independent, including a failed sibling build.
- [ ] `canvas/09b-duplicate-rename-library`: Implement duplicate/rename and searchable immutable local library copies with independent insertion.
  Done: Reuse still works after original-canvas deletion and empty-library guidance explains Add to library.
- [ ] `canvas/09c-delete-undo`: Implement persisted frame tombstones, reopen-safe Undo and inverse board geometry with layout CAS.
  Done: Undo restores source/location and surfaces remote-layout conflicts without replaying stale moves.
- [ ] `canvas/09d-saved-canvases-and-deletion`: Add Open saved canvas and explicit whole-canvas deletion with affected attachment disclosure.
  Done: Deletion unlinks attachments and cancels work while preserving independent library items; chat deletion retains canvas source.

**Files:** Create `src/features/canvas/CanvasVariants.tsx` and `sidecar/src/canvas/{canvasLibrary.ts,canvasLibrary.test.ts}`. Extend Task 2 workspace/schema/protocol, Task 5 navigator/toolbar and Task 8 history UI. Add focused cases to `CanvasWorkspace.test.ts` and `tests/integration/canvas.spec.ts`.

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

## Task 10: Source export, image capture and lifecycle recovery

**Subtasks (one branch and PR each, merged in order):**

- [ ] `canvas/10a-source-export`: Export the selected source revision, owned assets, kit/fonts/licenses and minimal locked-runtime README to a chosen directory.
  Done: The exported Hey example runs outside checkout; path escapes and overwrite collisions leave existing content intact.
- [ ] `canvas/10b-image-capture`: Implement one bounded rendered-revision capture for PNG export and inspect screenshots.
  Done: Timeout/abort/generation-change tests settle independently; unavailable capture returns an honest error.
- [ ] `canvas/10c-lifecycle-recovery`: Complete profile isolation and queue/worker/preview/subscription/MCP/waiter shutdown ownership.
  Done: Repeated close is harmless and reused provider handles reject old writes/events; committed source survives failures.

**Files:** Create `sidecar/src/canvas/{canvasExport.ts,canvasExport.test.ts}`. Extend the existing Electron file-save/capture bridge at its actual owner and Canvas context actions; inspect `electron/main.cjs` and `electron/preload.cjs` before placing code. Extend runtime smoke and workspace/build teardown tests.

**Interfaces:** `exportCanvasSource(canvasId: string, ref: RevisionRef, destinationDirectory: string): Promise<{ filesWritten: number }>` writes only to an explicit user-chosen directory. `captureCanvasImage(canvasId: string, ref: RevisionRef, signal: AbortSignal): Promise<{ mediaType: 'image/png'; bytes: Uint8Array }>` captures the exact rendered revision with a six-second deadline. Both require the authorized host boundary; generated code cannot choose paths or invoke export.

- [ ] Export the selected revision's source tree, owned assets, kit source/tokens/fonts/licenses and a minimal README explaining its locked runtime imports and entry point. Include sufficient build metadata to run that source with the repository's supported toolchain; no private prompts, session logs, credentials or absolute local paths. Refuse overwrite collisions until the user chooses another directory or explicitly confirms replacement through the app's normal file flow.
- [ ] Export PNG through the proven preview host at the frame's CSS size/device scale, bound dimensions and result bytes, and preserve transparent content when present. If capture is unavailable or times out, report it and keep source export available. Do not return a previous revision's thumbnail as a current screenshot.
- [ ] Add inspect screenshot support using the same bounded capture operation; no second capture engine. The model gets a real image or `capture_unavailable`. Test timeout, abort and generation change during capture with controlled promises; source writes and chat completion must settle independently of capture.
- [ ] Validate exported paths/content in a temporary directory and run the exported Hey example outside the app's source checkout. Assert no path escape and no internal canary in exported metadata. Refusing an existing destination file must leave it byte-identical.
- [ ] Complete shutdown/profile isolation: cancel queues before awaiting external cleanup, terminate compiler workers, stop preview hosts/subscriptions, revoke MCP scopes, and release all waiters. Verify repeated close is harmless and a new session with a reused provider handle cannot accept old writes/events. Run failure cases with locked/unavailable capture, not only a visible happy-path window.
- [ ] Run focused export, teardown and runtime tests; manually export a stateful design and confirm PNG and source describe the selected revision. Record capture limitations honestly.

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
