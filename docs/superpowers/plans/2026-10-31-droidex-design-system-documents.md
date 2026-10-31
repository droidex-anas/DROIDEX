# DROIDEX Design System Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan slice by slice. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn design systems into documents the agent writes and the user reads and edits, opened full width in the canvas area: a cover, notes, editable tokens, live component previews and demos, kit images, agent proposals and a create-from-this-project flow.

**Architecture:** The sidecar's `designSystems.ts` stays the one owner of kits. A kit version becomes an ordered document (cover, sections, files, examples) from which token modes and agent guidance are derived. The renderer gets a document view that replaces the board inside the existing canvas tab, a new picker and chip, and a draft model; previews reuse the compiler, the preview host and the four live slots. `canvas_theme` keeps its four operations and saves changes or proposals through the same owner.

**Tech stack:** Unchanged: Node.js 22, Electron, React 19, TypeScript, Tailwind 3, Zod, esbuild. No new dependencies.

**Spec:** [DROIDEX design system documents](../specs/2026-10-31-droidex-design-system-documents.md). Read it first; section numbers below (§n) refer to it. The parent [Canvas spec](../specs/2026-10-05-droidex-canvas-design.md) and [Canvas plan](./2026-10-05-droidex-canvas.md) still govern everything this does not change.

**References:** `/Users/anas/Documents/droid-control/.worktrees/droidex-canvas/reports/design-system-reference/` f001–f011 and `bug-screenshot.png`. Low-fidelity layouts: `reports/design-system-spec/` (git-ignored).

**Execution:** An integration branch `canvas/ds-documents` cut from `origin/main` when work starts. Every slice below is one branch and one pull request into it, reviewed by GPT-6.1 Sol at `xhigh` (CLAUDE.md) before merge. The integration branch goes to `main` only after slice 3a. Up to three Opus threads run at once; the lanes are drawn so that concurrent slices own disjoint files, and the few shared dispatch points are named. Checkboxes are ticked only when the work is done and verified.

## Global constraints

- `AGENTS.md` applies in full: one owner per concern, no wrappers, no shims beyond the one approved converter (§15), files under 500 lines, tests only where they protect behaviour.
- The sidecar owns kits, versions, proposals, captures and kit images. The renderer holds projections, the draft and transient UI state.
- One wire contract, changed with all its consumers in one commit: `sidecar/src/canvas/protocol.ts` and `src/features/canvas/protocol.ts`, plus `src/features/canvas/wireValidation.ts`; transcript activity in `src/types/bridge.ts` and `src/lib/bridgeWireValidation.ts`.
- `docs/design-system/` is the UI specification. Build with `src/components/ui/` primitives; tokens only; tone and space, not lines; `npm run quality:design-tokens` must not rise. Check light and dark in the running app.
- Seven Canvas MCP tools; no new tool. No hidden prompt text; nothing from a document reaches transcript, history, search or export.
- Preview guests: the opaque origin and network-denied session stay; a new `kit` binding may load only kit fonts and kit images.
- Remote: nothing new. Design and the document stay hidden there.

## Decisions

The owner settled the spec's open questions on 2026-10-31 (spec, Decisions):

1. v1.6 kits convert on read (§15); 1a owns `designSystemConversion.ts`.
2. Every agent change to an existing kit is a proposal (§11).
3. Choices follow the latest version (§9).
4. Kit images and Assets ship, last and cuttable (slice 2d). If 2d is cut, the cover menu has no Replace with image.
5. The composer chip opens the chosen kit's document where the chat has a canvas area, and the picker on the Design home (§9); 1c builds it.

## Slices, lanes and integration order

Sizes are changed lines including tests: **S** under 300, **M** 300–800, **L** 800–1500. Writers default to Opus, as the lead asked; the sidecar-only slices (1a, 2c) are the ones to hand to GPT-6.1 Sol (`task --write --effort high`) if Claude usage runs short.

| Slice | Lane | Size | Starts after | Owns (new files in **bold**) |
| --- | --- | --- | --- | --- |
| 0a contract | one thread | S | — | **`sidecar/src/canvas/designSystemDocument.ts`**, **`src/features/canvas/designSystemDocument{Protocol,Validation}.ts`**, `CanvasError` and `canvasActivity` fields, fixture |
| 1a sidecar documents | thread 1 | L | 0a | `designSystems.ts`, **`designSystemConversion.ts`**, `designSystemCommands.ts`, its §14 commands end to end, `presets/*`, every `modes`/`guidance` consumer |
| 1b document view | thread 2 | L | 0a | `src/features/canvas/systemDocument/*` |
| 1c navigation, picker, chip | thread 3 | M | 0a | **`systemDocument/DesignSystemDocument.tsx`** (stub), `utilityPanel.ts`, `openCanvasPane.ts`, `useStore.tsx` (action fields), `App.tsx` (expansion), `CanvasWorkspace.tsx`, picker files, `designSystemChoices.ts`, Manage dialog deletions |
| 2a previews, cover, demos | thread 1 | L | 1a; renderer half after 1b | **`kitPreviews.ts`**, **`kitCaptures.ts`**, compiler input, Electron preview binding, `systemDocument/{DocumentPreview,DocumentCover}.tsx`, `KitThumbnail.tsx` |
| 2b agent authoring | thread 2 | M–L | 1a and 1b | `canvasMcpServer.ts`, **`designSystemChanges.ts`**, **`designSystemProposals.ts`**, `canvasToolPresentation.ts`, `designSessionGuidance.ts`, transcript activity, **`systemDocument/ProposalLine.tsx`**, **`KitChip.tsx`** |
| 2c project flow and adherence | thread 3 | M | 1a; wiring after 2b | **`designSystemProject.ts`**, `designSystemImport.ts`, `designSystemAdherence.ts`, `canvasDiagnostics.ts`, `designSystemBrief.ts`, `NewDesignSystemMenu.tsx` (one item) |
| 2d kit images and Assets | first free thread | M | 2a | **`kitAssets.ts`**, `canvasImageRoute.ts`, Electron image import and asset serving, **`systemDocument/AssetsSection.tsx`**, cover Replace |
| 3a acceptance | one thread | S–M | all | smoke test, docs, visual pass |

Integration order: **0a → 1a → 1c → 1b → 2a → 2b → 2c → 2d → 3a**. Within a wave, a slice that finishes early merges early as long as it follows this order relative to the slices it shares a file with. Shared points, kept to a few lines each: `designSystemCommands.ts` gets new cases from 1a, 2a and 2b (each adds its own `case` lines; the later one rebases), and so do the files every command passes through (both `protocol.ts`, `canvasCommandSchema.ts`, `wireValidation.ts`, `designSystemRequests.ts`); `CanvasWorkspace.tsx` is 1c's alone; `DesignSystemDocument.tsx` is a stub from 1c, then 1b's, then 2b adds the proposal wiring after 1b merges; `canvasMcpServer.ts` is 2b's, and 2c adds the `from: { project }` branch after 2b merges.

Three threads at a time: wave 1 runs 1a, 1b and 1c together. Thread 1 moves to 2a when 1a merges (its sidecar and Electron half needs only 1a), thread 3 moves to 2c when 1c merges, thread 2 moves to 2b when 1b merges. Whichever thread finishes first takes 2d, then 3a.

## Slice 0a: the contract

Branch `canvas/ds-0a-contract`. One thread, short, merged before anything else starts.

Done: Both boundaries accept the same serialized DROIDEX preset document fixture and refuse the limit cases in §2; typechecks pass in renderer and sidecar.

The §14 commands, replies and the `designSystemsChanged` event are not in 0a. A command added to `CanvasCommand` needs its `canvasCommandSchema.ts` entry and a case in the exhaustive bridge switches, so each one lands with the slice that answers it (1a, 2a, 2b), together with its reply validation and its `designSystemRequests.ts` method. The stub view lands with 1c, which mounts it; an unmounted file fails `quality:deadcode`.

**Files:** create `sidecar/src/canvas/designSystemDocument.ts` (+ test), `sidecar/src/testing/droidexDocument.ts` (the fixture), `src/features/canvas/designSystemDocumentProtocol.ts` (the renderer mirror), `src/features/canvas/designSystemDocumentValidation.ts` (+ test: the same fixture and limit cases at both boundaries); move the token name and value rules from `designSystems.ts` into the new module and reuse the renderer's in `wireValidation.ts`; `latestVersion` in both `protocol.ts` and `wireValidation.ts`; `designSystem` on canvas activity in `canvasToolPresentation.ts`, `src/types/bridge.ts` and `src/lib/bridgeWireValidation.ts` (+ test).

**Interfaces:**

```ts
// sidecar/src/canvas/designSystemDocument.ts
export const documentSectionsSchema: z.ZodType<DocumentSection[]>; // §2 rules on sections alone
export function kitModes(sections: DocumentSection[]): { light: Record<string, string>; dark: Record<string, string> };
export function kitGuidance(name: string, sections: DocumentSection[]): string;
export const CANONICAL_SECTION_ORDER: readonly DocumentSection['kind'][];
export function insertSection(sections: DocumentSection[], section: DocumentSection): DocumentSection[]; // canonical insertion, §2
export const tokenNameSchema, tokenValueSchema; // moved from designSystems.ts
```

`DOCUMENT_LIMITS` stays module-private until 1a needs the limits that span a whole version (examples 64 KiB each and 512 KiB together, the 256 KiB document, the cover counted among the 24 previews). `designSystemSchema` in `designSystems.ts` is not touched here; 1a swaps `modes`/`guidance` for `cover`/`sections`.

- [x] Write the Zod schema and types from §2 with the limits table; ids, labels and token names unique; one section per token kind, components and assets.
- [x] `kitModes` and `kitGuidance` as pure functions; `kitGuidance` output follows §2's order and omits tokens without notes.
- [x] `latestVersion?: number` on `CanvasError` beside `currentRect`, accepted only with `revision_conflict`. `designSystem?: { id: string; version: number; status: 'saved' | 'proposed' | 'applied' }` on canvas activity in `canvasToolPresentation.ts`, `src/types/bridge.ts` and `src/lib/bridgeWireValidation.ts`.
- [x] A fixture of the DROIDEX preset as a document (hand-written, small) asserted against `documentSectionsSchema` in `designSystemDocument.test.ts` and against both boundaries in `designSystemDocumentValidation.test.ts`.
- [x] Tests: limit refusals at both boundaries (129 tokens, duplicate label, duplicate token across sections, two colour sections, preview wider than 1440 px; a preview naming a missing example is 1a's) and `kitModes` for both token shapes.

## Slice 1a: sidecar documents and storage

Branch `canvas/ds-1a-sidecar-documents`. Thread 1.

Done: Every built-in and saved kit reads as a document; all six preset kit/mode starters and every preset preview and cover compile; a v1.6 kit file opens as a document and its pinned frame builds unchanged; the renderer commands of §14 for read, save, versions, restore and delete answer with CAS and replay; `designSystemsChanged` fires.

**Files:** `sidecar/src/canvas/designSystems.ts` (stays under 500 lines: the schema now imports `documentSectionsSchema`); the commands below and `designSystemsChanged` in both `protocol.ts`, `canvasCommandSchema.ts`, `wireValidation.ts` (replies checked with `isDocumentSections`) and `designSystemRequests.ts`; `latestVersion` carried by `CanvasCommandError`, `canvasFailure` in `canvasBridge.ts` and `CanvasRequestError`; create `sidecar/src/canvas/designSystemConversion.ts` (+ test cases in `designSystems.test.ts`), `designSystemCommands.ts` (+ test), `presets/{auto,droidex,openai-inspired,claude-inspired,primitives,starter,styles}.ts`, and every reader of `modes` or `guidance`: `compilerWorker.ts`, `designStylesheet.ts`, `designSystemBrief.ts` (guidance from `kitGuidance`; token grouping is 2c's), `applyDesignSystem.ts`, `designSystemExport.ts`, `designSystemImport.ts`, `extractDesignSystem.ts`, `designSystemTokens.ts`, `designSystemAdherence.ts` (read through `kitModes` only; its rules are 2c's), `canvasExport.ts`, and their tests (`styleEdits.test.ts`, `extractDesignSystem.test.ts`, `designSystemCommands.test.ts`, `designSystems.test.ts`).

**Interfaces:** `DesignSystem` as in §2. `saveDesignSystem(system, { mutationId, baseVersion: number | null, savedBy, beforePublish? })`, where `baseVersion: null` creates v1, refuses with the existing `revision_conflict` code when `baseVersion + 1` exists, carrying `latestVersion` (added to `CanvasError` in 0a). `listDesignSystemVersions(id): Promise<{ version; savedAt; savedBy }[]>`. `setDesignSystemDeleted(id, deleted)`. `readDesignSystem(ref)` unchanged, also for tombstoned kits. `buildDocument({ tokens, guidance?, examples? })`: the canonical-order builder that import, extraction, the converter and presets share.

- [x] Replace `modes` and `guidance` in `designSystemSchema` with `cover` and `sections`; refine: every preview and the cover name an existing example; `kitGuidance` at most `maxGuidanceBytes`, the message naming the largest note.
- [x] Add §2's natural-key rules to `documentSectionsSchema` and `isDocumentSections`: preview titles and asset names unique in the document, preview ids `cover` and `typography` refused.
- [x] Summary header: add `savedAt`, `savedBy`, `cover`; swatches from `kitModes`. Base-version CAS and `revision_conflict` with `latestVersion`. Versions listing from headers. Tombstone file: lists skip it, reads do not.
- [x] `buildDocument` and its use in `designSystemImport.ts` (DESIGN.md prose becomes `design.md`) and `extractDesignSystem.ts`. Contract tokens land in their canonical sections by name; unknown names in Other tokens.
- [x] Presets as documents: split each preset's guidance into notes (`1-rules.md`, `2-feel.md`, a components note per primitive replacing the universal primitive notes), token groups (Surfaces, Text, Accent, Status, Interaction; type sizes and families; spacing; radius; shadows; motion), one preview per shared primitive showing its states, one demo (a settings panel for DROIDEX, a pricing card for OpenAI-inspired, a reading view for Claude-inspired) and a hand-written `examples/cover.tsx` per preset at 1200 × 480 (wordmark, mark and hero composition with the kit's primitives and tokens; no images). Auto gets sections for its neutral tokens and no cover; the picker never opens its document.
- [x] `designSystemConversion.ts`: the v1.6 `{ modes, guidance }` version file to a document (§15), called only from the version reader, with the removal condition in its header comment.
- [x] Commands: `canvas.readDesignSystem` (document projection without source, `latestVersion`, `proposal: null` until 2b), `canvas.saveDesignSystem` (files and examples from the base), `canvas.listDesignSystemVersions`, `canvas.restoreDesignSystemVersion`, `canvas.setDesignSystemDeleted`; `copyDesignSystem` and `importDesignSystem` return documents; `designSystemsChanged` after each write. User saves set note authors (§2).
- [x] Export: `notes/<label>`, `document.json`, derived `DESIGN.md` and `modes.css`.
- [x] Tests (extend the owner suites): CAS conflict writes nothing; replay by mutation ID; tombstoned kit hidden from lists and still readable; v1.6 file converts and its pinned frame compiles (`compiler.test.ts`); every preset preview and cover compiles in both modes; note authors set by saver, not input.

## Slice 1b: the document view

Branch `canvas/ds-1b-document-view`. Thread 2. Develops against the 0a fixture until 1a merges, then against the real commands.

Done: §5 and §6 work for a user kit and a preset in the running app, light and dark: nav, search, cover and preview placeholders, notes, all token kinds with specimens, usage-note popovers, inline edits, unsaved marks and save bar, ⌘S, Discard, conflict handling, version history and restore, Duplicate, Export, Delete with Undo, Use in this canvas.

**Files:** all under `src/features/canvas/systemDocument/`: `DesignSystemDocument.tsx` (replaces the 1c stub), `DocumentHeader.tsx`, `DocumentNav.tsx`, `NoteCard.tsx`, `TokenTable.tsx`, `TokenNotePopover.tsx`, `SaveBar.tsx`, `VersionMenu.tsx`, `DocumentMenu.tsx`, `useDesignSystemDocument.ts`, `documentDraft.ts` (+ `documentDraft.test.ts`), `documentSearch.ts`, `specimenStyle.ts`, and placeholders `DocumentPreview.tsx` and `DocumentCover.tsx` (a titled tile at the item's aspect; 2a fills them). Reuse `PreviewModeToggle.tsx`, `menuRows.tsx`, the `Toaster` for Undo and `NewDesignSystemForm.tsx` untouched.

**Interfaces:**

```ts
// documentDraft.ts: the one owner of unsaved edits, kept per kit id for the app session
interface DocumentDraft { base: DesignSystemDocumentView; name: string; cover: Cover | null; sections: Section[] }
type DraftChange = { kind: 'setToken'; ... } | { kind: 'removeItem'; ... } | ...; // UI edits only
function applyDraftChange(draft: DocumentDraft, change: DraftChange): DocumentDraft;
function draftDiff(base: Section[], next: Section[]): Map<string /* item id */, 'added' | 'changed' | 'removed'>;
function useDocumentDraft(id: string): [DocumentDraft | null, (change: DraftChange) => void, () => void /* discard */];
```

`draftDiff` is written so 2b can pass a proposal's sections as `next` and get the same marks.

- [ ] Layout per §5: header row, sticky nav (folds into a Sections menu under ~960 px), document column, page edge space-8, sections space-8, notes at the 672 reading measure.
- [ ] Notes (rendered with the transcript's existing markdown renderer), token tables (`tbody` dividers only), specimens through `specimenStyle.ts` (`CSS.supports` per kind and no `url(`), Other tokens explanation, provenance line under the cover.
- [ ] Draft editing per §6, keyboard first: Enter/blur keep, Escape reverts, Escape with nothing open calls `onBack`, ⌘S saves. Removed items struck through with Undo.
- [ ] Save, conflict (Discard mine / Save over vN), version menu, read-only older version with Restore, Duplicate, Export (existing host action), Delete with Undo toast, Use in this canvas (calls `chooseDesignSystem` with the toggle's mode), presets read-only.
- [ ] Refresh on `designSystemsChanged` for the open kit; a draft is never replaced by a refresh.
- [ ] Tests: `documentDraft.test.ts` (apply, diff, discard, a refresh does not drop the draft). Everything else is verified in the running app, light and dark, with a user kit and each preset.

## Slice 1c: navigation, picker and chip

Branch `canvas/ds-1c-navigation-picker`. Thread 3.

Done: The picker matches §9 (search, Auto, Recent, Presets, Yours, Open, New submenu) in light and dark; Open shows the document in place of the board in Design and expands the pane in an ordinary chat; the composer chip opens the chosen kit's document where the chat has a canvas area and the picker on the Design home, under Auto and for an unavailable kit, and its chevron opens the picker everywhere; any frame target returns to the board with viewport and selection kept; the Manage dialog and its entry points are gone; choices follow the latest version and a queued request keeps its pin.

**Files:** create the stub `src/features/canvas/systemDocument/DesignSystemDocument.tsx` (`{ appSessionId: string; canvasKey: string; system: { id: string; version?: number }; onBack(): void }`, rendering the kit's id and a Back button, nothing else; 1b replaces it), `src/lib/utilityPanel.ts` (target keys `designSystemId`, `designSystemVersion`; in its open path a frame or canvas target clears the document target), `src/features/canvas/openCanvasPane.ts` (`designSystem?` on the target), `src/hooks/useStore.tsx` (the new fields on the `OPEN_UTILITY_TOOL` action), `src/App.tsx` (expansion is App state, `expandedPaneAppSessionId`: expand when the active canvas tab gains a document target in an ordinary chat), `src/features/canvas/CanvasWorkspace.tsx` (ready body: lazy `DesignSystemDocument` when the tab has `designSystemId`, else the board; keep the workspace mounted), `DesignSystemPicker.tsx`, `designSystemPickerRows.ts` (+ test), create `NewDesignSystemMenu.tsx`, `NewDesignSystemDialog.tsx` (560 px, wraps `NewDesignSystemForm`), `KitThumbnail.tsx` (swatches now, cover capture in 2a), `designSystemChoices.ts` (+ test). Delete `useManageDesignSystems.tsx`, `DesignSystemsDialog.tsx`, `DesignSystemList.tsx` (its `KitSwatches` moves into `KitThumbnail.tsx`), `DesignSystemDetail.tsx`, `DesignSystemTokens.tsx`, `designSystemTokenTabs.ts`, `useDesignSystems.ts`, and the dialog parts of `designSystemsState.ts` (+ test), keeping `sameKit` and `KitList` where the picker uses them; remove the entries in `CanvasMenu.tsx` and `DesignColumnHeader.tsx`.

**Interfaces:** `followLatest(summaries: DesignSystemSummary[]): void` and `forgetDesignSystem(id): { restore(): void }` in `designSystemChoices.ts`; `recentDesignSystems(limit = 3): DesignSystemChoice[]` derived from the store's insertion order (no second record).

- [x] Utility tab targets; `useStoreUtilityPanel.test.ts` covers: a document target retargets the one canvas tab and a frame target clears it. Check the expansion from a docked ordinary chat in the running app.
- [x] Workspace body swap without remounting the projection; release board previews while the document shows; Back restores viewport and selection from `canvasState`.
- [x] Picker per §9 at 320 px with the existing `Popover`; row Open (trailing ghost button and Right Arrow), absent on the Design home (`NEW_CANVAS_KEY`) and for Auto; New submenu (From DESIGN.md…, From CSS or Tailwind config…; 2c adds From this project). The new dialog chooses the created kit and opens it where a canvas area exists.
- [x] Composer chip per §9 with `KitThumbnail`: the chip opens the document through `useOpenCanvasPane` when `canvasKey` is a real canvas and a kit is chosen and saved, otherwise the picker; the trailing chevron always opens the picker. Fix the faint light-mode swatches noted in 7b's follow-ups (to-do e4631db1).
- [ ] Choices follow latest on `designSystemsChanged` and after a save; delete forgets with Undo; existing test that a queued request keeps its pinned version still passes unchanged.
- [x] Delete the Manage dialog chain and run `npm run quality:deadcode` to confirm nothing dangles.

## Slice 2a: previews, cover and demos

Branch `canvas/ds-2a-kit-previews`. Thread 1. The sidecar and Electron half starts when 1a merges; the renderer half after 1b merges.

Done: Component previews, demos and the cover render live through the kit in both modes with at most four guests, released ones show captures; draft token edits show in live previews before saving; a kit-bound guest cannot load a canvas image; the picker and chip show cover thumbnails.

**Files:** create `sidecar/src/canvas/kitPreviews.ts` (+ test) and `kitCaptures.ts` (+ test, following `canvasCovers.ts`); `readKitPreview`, `saveKitCapture`, `readKitCapture` and their replies in both `protocol.ts`, `canvasCommandSchema.ts`, `wireValidation.ts` and `designSystemRequests.ts`; `compiler.ts` and `compilerWorker.ts` (a kit example compile: `CompileInput` becomes `{ kind: 'design'; designId; revisionId; generation; files; designSystem; designSystemAdherence } | { kind: 'kitPreview'; system: DesignSystemRef; example: string }`, no adherence on the second); `designSystemCommands.ts` (cases for `readKitPreview`, `saveKitCapture`, `readKitCapture`); `electron/canvasPreview.cjs`, `electron/canvasPreviewAssets.cjs`, `electron/main.cjs` (`canvas-preview-bind` takes `{ guestId, binding: { kind: 'canvas', canvasId } | { kind: 'kit' } }`), `electron/preload.cjs`, `src/lib/desktop.ts`, and the Electron tests beside them; renderer `systemDocument/DocumentPreview.tsx`, `DocumentCover.tsx`, create `systemDocument/useKitPreviewSlots.ts` (on `reducePreviewSlots` from `previewSlots.ts`), `kitCaptures.ts` (renderer cache, like `canvasCovers.ts`), `KitThumbnail.tsx`; the preview runtime's host-to-guest path for `setTokens` (`previewRuntime.ts`, `previewDocument.ts`).

- [ ] Compile and cache by `(id, version, mode, item)`, 32 entries; typography specimen as a generated example from the typography sections.
- [ ] Kit binding kind in Electron: kit fonts allowed, canvas images refused, unbound refused; tests in `canvasPreview.test.cjs` / `canvasPreviewAssets.test.cjs`.
- [ ] Renderer tiles at the item's size scaled to fit, live by slot, captured on first live render per mode, placeholders otherwise, “Saved version” label while the draft differs; tiles are pointer-interactive and out of the tab order.
- [ ] `setTokens`: changed values only, validated with the save rule, applied on the guest root.
- [ ] Cover at the top of the document; cover thumbnails in `KitThumbnail` for the picker (64 × 26) and chip (40 × 16); Regenerate puts the §5 sentence into the composer.
- [ ] Tests: compile cache key and kit-binding refusals. Verify four-guest cap and captures by scrolling a preset's Components in the running app.

## Slice 2b: agent authoring and proposals

Branch `canvas/ds-2b-agent-authoring`. Thread 2, after 1a and 1b merge.

Done: §11 holds for all three providers: a new kit saves v1 with cover and demos; a change to a user kit becomes a proposal the user reviews, accepts or discards; presets refuse; a stale base refuses; chat shows kit chips that open the document; nothing from the document reaches transcript, history, search or export.

**Files:** `sidecar/src/canvas/canvasMcpServer.ts` (save input of §11; result envelopes), create `designSystemChanges.ts` (+ test: `applyDocumentChanges(system, changes)`, natural keys, canonical insertion via `insertSection`), create `designSystemProposals.ts` (+ test: read, write, replace, accept onto latest, discard; one file per kit), `designSystemCommands.ts` (cases for accept and discard; `readDesignSystem` fills `proposal`), the accept and discard commands in both `protocol.ts`, `canvasCommandSchema.ts`, `wireValidation.ts` and `designSystemRequests.ts`, `canvasToolPresentation.ts` (+ test: activity fills the `designSystem` reference 0a added), `designSessionGuidance.ts` (§11 guidance, short), `src/types/bridge.ts` consumers and `src/lib/transcriptIngestion.ts` if merging needs it; renderer create `systemDocument/ProposalLine.tsx`, wire review into `DesignSystemDocument.tsx` and `SaveBar.tsx` using `draftDiff`, create `src/features/canvas/KitChip.tsx` and render it where canvas activity renders artifact cards (`src/components/chatFeedArtifacts.ts`, `CanvasArtifactCard.tsx`).

- [ ] Save: new kit from `blank`, `copy` (and `project`, which 2c wires), changes applied, schema, both-mode compile of `index.tsx` and every example; existing user kit to proposal; preset `preset_read_only`; stale base `revision_conflict`; deleted `invalid_input`.
- [ ] Proposal storage under the kit's directory with `appSessionId`, mutation replay, and accept as `savedBy: agent`, note authors `agent` for changed notes.
- [ ] Review per §11; Accept disabled while a draft exists; picker dot from `list`.
- [ ] Activity projection and replay: only `{ id, version, status }` persisted; extend the privacy canary test in `canvasToolPresentation.test.ts` with a marker in a note and in a token value.
- [ ] Tests: `designSystemChanges.test.ts` (natural keys, new token needs section and group, removal, limits), `designSystemProposals.test.ts` (replace, accept onto latest, accept over newer, discard), `canvasMcpServer.test.ts` (the four save outcomes). Run one real turn per provider.

## Slice 2c: create from this project, and adherence

Branch `canvas/ds-2c-project-adherence`. Thread 3, after 1a merges; the `from: { project }` wiring lands after 2b merges.

Done: In a Tailwind + CSS variables project, one agent save creates a kit with true provenance, unmapped tokens and diagnostics; paths outside the project, links and oversize files are refused; adherence reports the §13 findings from the document's sections; the brief groups tokens by section within its budget.

**Files:** create `sidecar/src/canvas/designSystemProject.ts` (+ test: `readProjectSources(projectRoot, sources)` with the §12 path rules, then `designSystemSources.ts`, `designSystemTokens.ts`, `configLiterals.ts` and `designSystemImport.ts` into `buildDocument`); `designSystemImport.ts` (accept several sources); the `from: { project }` branch in `canvasMcpServer.ts`, which resolves the project root from the scope's session, never from input; `designSystemAdherence.ts` (+ test), `canvasDiagnostics.ts` (`design_system_type`, `design_system_radius`, `design_system_spacing`, `design_system_shadow`), `designSystemBrief.ts` (tokens grouped by section kind, same 4 KiB budget); renderer `NewDesignSystemMenu.tsx` (From this project, shown when the session has a `cwd` and Canvas tools; puts the §12 sentence in the composer).

- [ ] Path rules: relative, no `..`, final component not a link, real path inside the root, regular UTF-8 file, 256 KiB, 8 sources. Provenance `{ project: { name, files } }` added to the schema with the parsed paths only.
- [ ] Adherence rules from token sections; codes added; cap 12; Auto and kits without a section skip that check; strict still fails builds.
- [ ] Tests: `designSystemProject.test.ts` (outside path, symbolic link, oversize, Tailwind + CSS mapping with unmapped kept), `designSystemAdherence.test.ts` (each new finding once; a matching token value is not a finding; Auto none), brief size under 21 KiB with a full kit. Try it once on this repository.

## Slice 2d: kit images and Assets

Branch `canvas/ds-2d-kit-assets`. First free thread, after 2a merges. Cuttable without blocking 3a.

Done: The user imports PNG/JPEG/WebP into a kit through picker or drop; images are stored once by hash and render offline as `kit-asset:` in previews and designs; the Assets section and the cover's Replace with image work; unbound guests are refused.

**Files:** create `sidecar/src/canvas/kitAssets.ts` (+ test, following `canvasAssets.ts`), `canvasImageRoute.ts` (a kit target on the private loopback route), `electron/canvasImageImport.cjs` (+ test), `electron/canvasPreviewAssets.cjs` (`kit-asset:` for bound guests), compiler/stylesheet resolution of `kit-asset:`; renderer create `systemDocument/AssetsSection.tsx`, Replace with image in `DocumentCover.tsx`.

- [ ] Same validation and limits as canvas images; content-addressed; metadata record; no agent import path.
- [ ] Assets grid per §5; rename, note, remove (entry only).
- [ ] Tests: import validation reuse, `kit-asset:` served to canvas and kit guests and refused to unbound ones, offline render.

## Slice 3a: acceptance and documentation

Branch `canvas/ds-3a-acceptance`. One thread.

Done: Every row of spec §17 passes and is recorded; light and dark checked; docs updated.

- [ ] An Electron smoke test in a sibling spec file (the board spec is at its size cap; add its name to `playwright.canvas-smoke.config.ts` `testMatch`): open a preset document from the picker, edit a token, save, see the chip follow, go back to the board.
- [ ] Run the §17 scenarios with Droid, Claude Code and Codex; record what passed and what did not in the PR.
- [ ] Mark the parent spec's two superseded §10 paragraphs with a pointer here; set this spec's status; draft the release note.
- [ ] Full validation from `AGENTS.md`, plus `npm run quality:design-tokens` and the Canvas Electron smoke.

## Review focus

1. A save, accept or restore racing another write to the same kit: exactly one new version, the loser refused with `revision_conflict`, the draft kept. Tests in 1a and 2b.
2. A queued request composed before a save keeps its version after choices follow the latest. Test in 1c.
3. The `kit` binding: a kit-bound guest cannot read canvas images, and an unbound guest still reads nothing. Tests in 2a and 2d.
4. Project paths: no escape through `..`, links or absolute paths; the project root comes from the session, never the agent. Tests in 2c.
5. Privacy: document text, token values and example source never enter the transcript, history, search or export, live or replayed. Test in 2b.

## Plan self-review

- Every spec section maps to a slice: §2–§3 to 0a and 1a; §4 and §9 to 1c; §5–§6 and §10 to 1b; §5 cover and §7 to 2a; §8 to 2d; §11 and the chat chips to 2b; §12–§13 to 2c; §14: the document types, `latestVersion` and the activity reference to 0a, each command and event to the slice that answers it; §15 to 1a; §17 to 3a.
- Concurrent slices own disjoint files except the dispatch points named above.
- Superseded code is deleted in the slice that replaces it: the Manage dialog chain in 1c, `modes`/`guidance` storage in 1a, universal primitive notes in 1a.
