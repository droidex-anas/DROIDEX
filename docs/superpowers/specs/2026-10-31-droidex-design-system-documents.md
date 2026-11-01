# DROIDEX design system documents

Status: proposed. Nothing in this document is implemented yet. It supersedes two paragraphs of the [Canvas design specification](./2026-10-05-droidex-canvas-design.md) §10, **Choosing and managing systems** and **How a kit is written**, and the Manage design systems dialog they describe. The rest of §10 (Auto, the three presets, the lift/press and no-layout-shift rules, per-request pinning, apply, images) still holds.

Execution plan: [design system documents plan](../plans/2026-10-31-droidex-design-system-documents.md).

## Product intent

A design system becomes a document the agent writes and the user reads and edits. It opens full width in the canvas area, where the board was, with the chat column still beside it. The user reads it like a well-made brand book: a cover, the rules, the colours, the type, the components rendered for real and demos of the system applied. They change a colour or a rule in place and save. The agent reads the same document as its brief, writes new ones from a project's code, and proposes changes the user accepts.

There is one concept: **the document is the kit**. Its token sections are the tokens the compiler injects, its notes are the guidance the agent reads, its component and demo previews are the kit's examples. No theme object sits beside it, and no field is kept in sync with another.

Canvas only, laptop only. Design stays hidden in Remote, and the document with it.

## 1. References

Local frames, not files to commit: `/Users/anas/Documents/droid-control/.worktrees/droidex-canvas/reports/design-system-reference/`.

| Frame | What it shows | DROIDEX requirement |
| --- | --- | --- |
| f001 | Section nav with search; a hero card with a pixel wordmark, brand mark and art, and a tagline | The kit's cover at the top of the document (§5), made by the agent through the preview path |
| f002–f006 | Overview prose; collapsible note cards labelled `1-rules.md`, `2-feel.md`, “Design engineering” with code blocks | Notes with filename-like labels, rendered markdown at the reading measure (§2, §5) |
| f007 | Colors: section title with Add, a named palette with delete/add, rows of Name, Dark and Light swatch + value inputs | Token groups in a colour section, both modes side by side, values edited in place (§6) |
| f008 | A Usage notes popover on one token: “Window canvas: the reading area… Code: --droid-bg” | Per-token usage notes in a popover (§6) |
| f009 | Typography: Brand and Headings groups, specimen line per style with a family · size chip, Upload font | Type specimens rendered with the kit's own fonts (§5); font upload is out of scope |
| f010 | Components: a name column and a static preview per component (sidebar mockup, Badge, Button with states, Card), a note icon, “Static preview — see the note above” | Component previews and demos through the kit preview path (§7) |
| f011 | Assets: icon list with type and size, “Show all 167 files”, storage footer | Kit-owned images (§8) |
| bug-screenshot | Today's 280 px composer picker popover | Replaced by §9 |

The reference draws a grid of lines around every table and a border around every card. DROIDEX separates with tone and space instead (`docs/design-system/rules.md`): only a data table's `tbody` gets row dividers, a swatch keeps its hairline, and cards are tone steps. Match the structure and density, not the lines.

## 2. The document model

A `DesignSystem` version becomes:

```ts
interface DesignSystem {
  id: string;            // canvas identifier, unchanged
  version: number;       // one immutable version per save, unchanged
  name: string;          // at most 120 characters, unchanged
  cover: Cover | null;   // §5
  sections: Section[];   // the document, in reading order
  files: SourceFiles;    // kit source; index.tsx exports the primitives, unchanged
  examples: SourceFiles; // sources of the cover, component previews and demos
  provenance?: Provenance;
}

type Section =
  | { kind: 'notes'; id: string; title: string; items: (Note | Preview)[] }
  | { kind: TokenKind; id: string; title: string; items: (Note | TokenGroup)[] }
  | { kind: 'components'; id: string; title: string; items: (Note | Preview)[] }
  | { kind: 'assets'; id: string; title: string; items: (Note | Asset)[] };

type TokenKind = 'colors' | 'typography' | 'spacing' | 'radius' | 'shadows' | 'motion' | 'tokens';

interface Note { kind: 'note'; id: string; label: string; body: string; author: 'user' | 'agent' }
interface TokenGroup { kind: 'group'; id: string; title: string; tokens: Token[] }
type Token = { name: string; note?: string } & ({ value: string } | { light: string; dark: string });
interface Preview { kind: 'preview'; id: string; title: string; example: string; width: number; height: number; note?: string }
interface Asset { kind: 'asset'; id: string; name: string; assetId: string; note?: string }
type Cover = { kind: 'preview'; example: string } | { kind: 'image'; assetId: string };
```

What replaces what:

- `modes` is gone from storage. `kitModes(sections)` derives `{ light, dark }` from the token sections: a single-`value` token gives both modes the same value, a `light`/`dark` token gives each its own. The compiler, stylesheet writer, adherence, apply, export and the brief call it; nothing else holds token values. Light and dark can no longer disagree on token names, so that refinement goes.
- `guidance` is gone from storage. `kitGuidance(name, sections)` renders the document's text for the agent, in document order: each section title, each note's label and body, `name: note` for each token with a usage note, and `title: note` for each preview with one. Tokens without notes are already in the brief's name list and are not repeated.
- `examples` stays the one home for preview source. A `Preview` or a preview `Cover` names a file in it.

Rules the sidecar's schema enforces:

| Rule | Limit |
| --- | --- |
| Sections | at most 16; at most one section of each token kind, one `components` and one `assets`; any number of `notes` sections |
| Items per section | at most 64 |
| Section and item ids | `[a-z0-9-]{1,48}`, unique within the version |
| Tokens | at most 128 in the whole document (the old per-mode limit), names `--[a-z0-9]+(-[a-z0-9]+)*`, unique in the document, values as today (160 characters, no `;{}<>`, comment or line break) |
| Token usage note | at most 400 bytes |
| Note label | filename-like, `[a-z0-9][a-z0-9-]*\.md`, at most 48 characters, unique in the document |
| Note body | markdown, at most 8 KiB |
| Preview | at most 24 per version, cover included; title unique in the document, since §11 changes a preview by its title; id never `cover` or `typography`, which §14 uses as preview targets; `example` names a file in `examples`; `width` 240–1440 and `height` 120–1200 CSS px; note at most 1 KiB |
| Example file | the existing source limits: at most 256 KiB each, 1 MiB and 64 files for all examples |
| Assets | at most 48 per version; name unique in the document, since §11 changes an asset by its name |
| Agent-read text | the notes and usage notes `kitGuidance` passes on at most 16 KiB together, the existing `maxGuidanceBytes`; the headings it adds are not counted |
| Whole version | the stored JSON, without examples and files, at most 256 KiB |

How the 16 KiB guidance relates: it is no longer a field anyone writes. It is the document's own text as the agent reads it, and saving refuses a document whose notes and usage notes would pass 16 KiB together, naming the largest note. A builder (§15, imports, extraction) continues a note longer than 8 KiB in `name-2.md` and on, breaking between paragraphs or before a heading, so a 16 KiB DESIGN.md or v1.6 guidance is kept whole. The opening `canvas_read` brief is that text, its headings and the 4 KiB name lists. Prose that should not cost the agent's attention does not belong in a kit.

**Ordering.** The stored arrays are the order; the sidecar keeps exactly what was saved. Builders (presets, imports, the project flow, the v1.6 conversion in §15) use the canonical order: notes (titled Overview), Colors, Typography, Spacing, Corner radius, Shadows, Motion, Other tokens (`tokens`), Components, Assets. A section added later, by the user or the agent, is inserted before the first existing section that comes after it in that order. The user can then move sections up or down. Items keep the order they were added in and can be moved within their section.

**Note authors.** The sidecar sets `author` on save from who saved: `user` for a note the user changed, `agent` for one an agent save or an accepted proposal changed. It is never read from input. The document does not show who wrote a note.

## 3. Storage and versions

The existing owner, `sidecar/src/canvas/designSystems.ts`, keeps its contract: one file per version, `canvases/design-systems/<id>/<n>.json`, published once with `link`, a first-line summary header, mutation replay, read-only built-ins, `version_mismatch` for a missing pin.

- The summary header gains `savedAt` (ISO time) and `savedBy` (`{ actor: 'user' }` or `{ actor: 'agent', appSessionId }`), and `cover: boolean`. The list and the version history read only headers.
- A save names its base: the new version is `base + 1`. If that version already exists the save fails with the existing `revision_conflict` code, nothing is written, and the error carries `latestVersion` the way a stale frame move carries `currentRect`.
- `canvases/design-systems/<id>/proposal.json` holds at most one pending agent proposal (§11).
- `canvases/design-systems/<id>/deleted` is a tombstone (§10). A deleted kit leaves every list but its versions stay readable, so frames pinned to it keep building.
- Kit covers and preview captures are pixels of immutable source, so they are cached beside the version, not part of it; a later capture may replace one: `<n>.cover-light.png`, `<n>.cover-dark.png` and `<n>.previews/<itemId>-<mode>.png`, PNG, at most 2 MiB each since they are taken in device pixels, with the same atomic write as canvas covers (`canvasCovers.ts`). A missing capture is taken again the next time that preview is live.
- Kit images (§8) are content-addressed once in `canvases/design-systems/assets/<sha256>` with a metadata record, like canvas images.

## 4. Where the document opens

The canvas area is the only place a document opens: the board region beside the chat column in Design, and the canvas pane in an ordinary chat. The document is a view of the canvas tab, not a new tool or a second tab:

- `UtilityTab` gains two target keys, `designSystemId` and `designSystemVersion` (absent means latest), and `CanvasPaneTarget` gains `designSystem?: { id: string; version?: number }`. `useOpenCanvasPane` opens a document the same way it opens a frame, by retargeting the one canvas tab. Any frame target (an artifact card's Open, a Components list click, Show design, a frame chip) clears the document target and shows the board focused on that frame.
- Opening a document from an ordinary chat's docked pane expands it. Back to board leaves the size as it is.
- `CanvasWorkspace` stays mounted. Its ready body swaps the board for the document, so the canvas projection and subscription are not rebuilt, and viewport and selection are restored on Back. The board's live previews are released while the document shows; the document uses the same four slots.
- The chat column, its Agent and Components tabs and the composer stay beside the document. Talking to the agent about the kit while reading it is the point.
- Each chat keeps its own utility panel, so each chat remembers whether it shows the board or a document. Closing the pane closes the document; an unsaved draft survives (§6).
- The Design home has no canvas area. Its chip opens the picker (§9), which chooses and creates kits but shows no Open action.
- Escape closes the innermost popover or inline edit first. With nothing open, Escape in the document goes back to the board.

## 5. The document view

Layout, left to right inside the canvas area: a section nav, then the document column.

**Header row** (the canvas area's top row, same height as the board's): Back to board (ghost, arrow icon, “Board”); the kit name (editable in user kits); a quiet version button (“Version 5”) that opens the history (§10); then on the right a light/dark icon button named for the mode it switches to (“Preview in dark”), a more menu (Duplicate, Export…, Delete) and at most one primary action. The primary action is **Use in this canvas** when the kit is not the canvas's choice. While a draft or proposal is open, the save bar holds the primary action instead and the header has none.

**Section nav**, about 220 px, sticky, on the canvas tone with no divider: a search field, then one entry per section with its count (“Colors 18”). The active section has the `bg-active` tone; a section with unsaved or proposed changes shows a small accent dot. Search filters tokens by name and value, notes by label and text, previews and assets by title; nav counts show matches and empty sections hide while searching. In user kits the nav ends with Add section (a menu of the kinds not yet present, plus Notes). Below about 960 px of canvas width the nav folds into a Sections menu in the header.

**Document column**: page edge space-8, sections space-8 apart, each section a heading (`text-heading`) with its count and a section menu (rename, move up, move down, remove), then its items. Notes and prose keep the 672 px reading measure; token tables, previews and demos use the full column.

- **Cover.** At the top, the kit's cover (below) at the column's width, with the provenance line under it (“Copy of Claude-inspired v1”, “Created from this project: tailwind.config.ts, src/index.css · 6 tokens not mapped”, “Extracted from Landing page · v3”).
- **Notes** are `bg-raised` cards, radius 12, no border. The card header shows the title the label reads as (the label is its tooltip) and a chevron; the body is rendered markdown at the reading measure. Notes start expanded; collapse state is remembered per kit for the app session.
- **Token groups** are a group title (`text-body-strong`, like a preview's title) and a data table with `tbody` row dividers, its column heads in `text-caption`, muted, its names bare in medium sans (`accent` for `--ds-accent`; the full `var(--ds-accent)` is the row's tooltip and what its Copy reference action copies; a new token's name is typed bare) and its values in sans with tabular figures. Colours show Name, Light and Dark, each a hairlined swatch and its value, so both modes are always visible. Single-value kinds show Name, Value and a specimen: a bar for spacing, a tile with that corner for radius, a raised tile with that shadow for shadows, the value alone for motion. Typography rows show Name and Value; the specimens are one preview rendered by the kit (below). Other tokens open with one sentence: the shared primitives do not read these; designs can use them by name. A row with a usage note shows a note icon; hovering or focusing any row shows it.
- **Previews** (components and demos) are a title, an optional note and a tile at the preview's size scaled down to fit the column, never up (§7).
- **Assets** are a grid of tiles: the image, its name, pixel size and file size.

Specimens for colour, spacing, radius and shadow render in the renderer, in a wrapper that sets the kit's values for the previewed mode as custom properties. A value is used there only when `CSS.supports` accepts it for that property and it contains no `url(`, so a kit cannot make the app fetch anything. Fonts, previews and covers render only in preview guests.

**Light/dark** toggles the mode every specimen, preview and cover renders in. It starts at the canvas choice's mode when this kit is chosen, otherwise at the app's theme, and it does not change the choice. Use in this canvas pins the toggle's mode, as choosing in the picker does today.

**The cover** is the kit's visual: shown at the top of the document, as the picker row's thumbnail and as the composer chip's visual. It is either a preview, a frame-like composition at a fixed 1200 × 480 viewport written as `examples/cover.tsx` with the kit's primitives, tokens, fonts, icons and kit images (the brand mark, wordmark and hero of f001), or an image the user chose. The agent makes a preview cover by default whenever it creates a kit or substantially changes one (guidance, §11). In the document the cover is a live preview and takes one of the four slots; elsewhere it is its capture. The capture is taken from the live cover in each mode the first time it renders and stored with the version (§3); a kit without a cover or a capture shows its surface and accent swatches instead. The cover menu (user kits) has Regenerate, which puts “Make a new cover for <name>.” into the composer and focuses it, and Replace with image…, which imports through the image boundary of §8. Presets ship a hand-written `examples/cover.tsx` in their preset module, reviewed like the rest of the kit; their captures are taken in the app like any other kit's, so no image is checked in.

## 6. Editing

Who can edit: the user edits their own kits. Presets open read-only with a quiet line, “Presets are read-only”, and Duplicate. Auto has no document; it has no style to show.

**Draft.** Edits change a renderer-owned draft of one kit, based on the version it was opened at, never the saved version. The view renders the draft. Leaving the document, switching chats or closing the pane keeps the draft in memory for the app session, and reopening the kit shows it; a restart discards it.

**How unsaved looks.** Compared with its base, a changed or added row, note or preview shows a small accent dot before its name, and its previous value is in the row's tooltip (“Was #3355FF”). A removed item stays in place in `text-muted`, struck through, with Undo, until the save. The nav marks the sections that changed. A save bar sits at the bottom of the column on the raised tone: “3 unsaved changes”, Discard (ghost) and Save (primary, ⌘S). No outlines, no colour wash over edited rows.

**Editing in place.**

- Values: click a value to edit it in a `Field` input. Enter or blur keeps it in the draft, Escape reverts. A colour input shows its swatch live. A value that fails the schema rule or `CSS.supports` for its kind shows the error under the field and is not kept.
- Colour swatches: an editable colour row's swatch opens the system colour picker. The colour being chosen shows in the swatch and in the live previews; letting go keeps it in the draft as one change, and dismissing the picker keeps nothing. The picker has no alpha, so a translucent value keeps its own. A one-value colour picks from its Light swatch and sets both modes.
- Light and dark: a row's menu has Separate light and dark, or Use one value for both (which takes the light value).
- Usage notes: the row's note icon opens a popover (`usePopoverPosition`, 320 px) with the note as an editable text area and Remove.
- Add and remove: each group ends with Add token (a name field and value); a token section's Add makes a group; a section's Add note adds a note (`note-1.md`). Removing anything is a draft change with Undo, so it needs no confirmation.
- Notes: Edit turns a card into its label field and a text area; Done shows the rendered markdown again.
- Previews: notes and titles are editable; source is not. New previews and demos come from the agent.
- Sections and items: rename, move up, move down and remove from their menus.

**Saving.** Save sends the draft's name, cover reference and sections with its base version (`canvas.saveDesignSystem`). Files and examples always come from the base; the document never sends source. The new version is shown at once, the draft clears, and every canvas that chose this kit follows to the new version (§9). If the base is no longer the latest, nothing is written and the bar says “Version 6 was saved while you edited” with Discard mine and Save over version 6; saving over writes the draft as version 7 and version 6 stays in the history. The draft is kept until the user chooses.

## 7. Component previews and demos

A preview renders one example file with the kit, through the same compiler and preview host as board frames. It is not a frame: no board, no revision, no selection, inspection or source drawer.

- **Components** previews show the kit's primitives in use: one per primitive, with its states (as in f010). Presets ship one per shared primitive (Button, Input, Card, Badge, Tabs, Dialog), each with a note that documents its API; these notes replace the universal primitive notes that guidance carried until now.
- **Demos** are larger compositions, a settings page or a pricing card, that show the system applied. They are previews placed in a notes section between notes, or in Components after the primitives. The agent writes them when it creates a kit (one or two) and when asked.
- **Building.** `canvas.readKitPreview { ref: { id, version, mode }, item }` compiles the example under that exact kit version and returns the artifact the preview host loads. Versions are immutable, so artifacts are cached in memory by `(id, version, mode, item)`, at most 32. Adherence does not run on kit previews. A build failure shows its first diagnostic in the tile.
- **Live slots.** The document shares the board's `MAX_LIVE_PREVIEWS = 4` and its slot reducer: the cover and the previews nearest the viewport's centre are live, the others show their stored capture (§3) or a quiet placeholder with the title. Captures are taken when a preview first renders live in a mode, as canvas covers are.
- **Drafts.** When the draft changes token values, the renderer sends the changed values to live previews as one `setTokens` message over the existing preview runtime channel; the guest sets them on its root for that mode, validated by the same rule as a save. Nothing recompiles. Captured tiles keep the saved look and say so (“Saved version”) while the draft differs.
- **Isolation.** Today a preview guest is bound to one canvas. Kit previews add a second binding kind, `kit`. A kit-bound guest may load kit fonts and kit images and nothing a canvas owns; it keeps the opaque origin and the network-denied session. Unbound guests stay refused.
- **Interaction.** Tiles are illustrations: pointer events reach the guest so hover and press show the kit's lift and press, but Tab does not enter them and they keep no state. Each tile has an accessible name (“Button preview”).

## 8. Assets

Assets are images the kit owns: logos, marks, illustrations, cover images. PNG, JPEG and WebP only, through the existing Electron picker and drop boundary with the canvas image limits (10 MiB, 8192 × 8192, content validated). SVG waits for an image contract that allows it.

- Stored once by content hash in the global kit asset store (§3); a document refers to them by asset ID. Design and preview source use `kit-asset:<sha256>`, which the preview host serves to any bound guest, canvas or kit, as it serves kit fonts. Unbound guests and the app's default session are refused.
- The agent sees assets in `canvas_theme` read (name, ID, size, note), can use them in source, and can add, rename, annotate or remove entries for IDs that already exist. It cannot import bytes; that authority stays with the user's picker and drop.
- Fonts are not assets in the document. They stay in the kit's files with their licences; Typography shows them.
- Removing an entry does not delete bytes, since older versions may refer to them.

## 9. Choosing a system: the picker and the chips

**The composer chip** stays where the control is today, in the composer's quiet row. It shows the cover thumbnail (40 × 16, `rounded-xs`) or the swatches, then the kit's name, and a clear button back to Auto when a kit is chosen. Clicking it opens the chosen kit's document where the chat has a canvas area: in place of the board in a Design chat, and in the canvas pane of an ordinary chat with a canvas, which opens and expands as in §4. On the Design home, which has no canvas area, it opens the picker. It also opens the picker when there is no document to show: under Auto, and for a kit chosen but no longer saved, which keeps today's “unavailable” treatment. A trailing chevron on the chip (“Change design system”) opens the picker in every chat, so choosing another kit stays one click away.

**The picker** replaces today's 280 px popover with a 320 px one (`Popover`, menus 200–320):

1. A search field, focused on open, and the light/dark toggle beside it.
2. **Auto**, always first: “Styles from the request and the canvas”.
3. **Recent**: up to three kits most recently chosen on any canvas, newest first, read from the choice store. Hidden while searching and when empty.
4. **Presets**: DROIDEX, OpenAI-inspired, Claude-inspired.
5. **Yours**: user kits, most recently saved first, a dot on a kit with a pending agent proposal.

Each row shows the cover thumbnail (64 × 26, `rounded-sm`) or the two swatches, the name and a check on the current one. Enter or click chooses and closes. On the active row, Open (a trailing ghost button, also Right Arrow) opens the kit's document in the canvas area; it is absent on the Design home and for Auto. The footer is **New design system**, a submenu: From this project (§12; shown only when the chat has a project folder), From DESIGN.md…, From CSS or Tailwind config…. The last two open a 560 px dialog with the existing paste-or-upload form (`NewDesignSystemForm`), call the existing `canvas.importDesignSystem`, choose the new kit for this canvas and open its document where a canvas area exists. The Manage design systems footer is gone.

**Choices follow the latest version.** A canvas's choice names a kit. When the renderer learns of a new version (its own save, an accepted proposal or a `designSystemsChanged` event), every stored choice of that kit moves to it. A request still pins the exact version when it is composed, so queued, steered and retried requests keep theirs. Deleting a kit returns every canvas that chose it to Auto, and Undo restores them. This changes today's behaviour, where a choice keeps the version it was made at forever.

**Chat chips.** `canvas_theme` activity projects to small semantic records, as other canvas tools do, now carrying the kit reference: “Created design system Acme · v1”, “Proposed changes to Acme”, “Applied Acme to Card · v3”. The record shows the kit as a chip with its cover thumbnail; clicking opens the document, and a proposal chip opens it in review. Only `{ id, version }` or the proposal's base is persisted for replay; no document text, token values or example source enters the transcript, history, search or export. User messages do not gain a kit chip, since that would mean adding text to the prompt.

## 10. Document actions

The Manage design systems dialog and its entry points (the canvas menu, the Design column header and the picker footer) are removed. Its jobs move here:

| Was | Now |
| --- | --- |
| Presets and Yours list | The picker (§9) |
| Colors / Typography / Spacing & Radius / Shadows tabs | The document's sections |
| New from DESIGN.md / CSS or Tailwind | The picker's New submenu |
| Save a copy | Duplicate in the more menu: copies the shown version as a new user kit “<name> copy” with `copiedFrom` provenance and opens it |
| Export | Export… in the more menu, the existing host route, now also writing `notes/<label>` files and `document.json`; `DESIGN.md` and `modes.css` are derived from the document |

New actions:

- **Version history**: the version button opens a menu of versions, newest first. Each row reads “Version 5”, a muted line of what it changed against the version before (“Accent, radius-card, 1 note”, “Created” for the first) and how long ago it was saved, right-aligned; the latest has a check and the version on screen is highlighted. Choosing one shows it read-only with a line “Viewing version 3 · latest is version 5”, Back to latest, and Restore as version 6 (primary), which saves that version's document, files and examples as the next version (`canvas.restoreDesignSystemVersion`).
- **Delete** (user kits only): optimistic, with an Undo toast and no confirmation. It writes the tombstone, takes the kit out of the picker and returns every canvas that chose it to Auto. Frames and queued requests pinned to its versions keep building. Undo removes the tombstone and restores those choices.

## 11. Agent authoring

`canvas_theme` stays the one design-system tool; the server keeps seven tools. Its operations stay `list`, `read`, `save` and `apply`, all through the same owner and schema as the document's saves.

- `list` adds `proposal: boolean` per kit.
- `read` returns the whole version: cover, sections, files, examples (bounded by §2), provenance.
- `save` takes changes, not a whole document, so a one-token edit costs one change:

```ts
{
  operation: 'save'; scopeId: string; mutationId: string;
  kit: { id: string } & ({ baseVersion: number } | { from: 'blank' | { copy: DesignSystemVersionRef } | { project: ProjectSource[] } });
  name?: string;
  changes?: DocumentChange[];     // at most 200
  files?: SourceFiles;            // changed kit files, complete contents
  examples?: SourceFiles;         // changed example files, complete contents
  cover?: 'preview' | null;       // 'preview' uses examples/cover.tsx
}

type DocumentChange =
  | { set: 'token'; name: string; value?: string; light?: string; dark?: string; note?: string; section?: TokenKind; group?: string }
  | { set: 'note'; label: string; body: string; section?: string }
  | { set: 'preview'; title: string; example: string; width: number; height: number; note?: string; section?: string }
  | { set: 'asset'; name: string; assetId: string; note?: string }
  | { remove: 'token' | 'note' | 'preview' | 'asset'; key: string };
```

Changes use the document's natural keys (token name, note label, preview title, asset name); the sidecar assigns ids. A new token needs its `section` and `group`; other new items go to the first section of the right kind, created at its canonical place if missing.

What a save does:

- **New kit** (the id is unused): built from its `from` base, the changes applied, validated, then `index.tsx` and every example compiled in both modes. A failure refuses with diagnostics (file, line, message). Success saves v1 with `savedBy: agent` and returns `{ status: 'saved', ref, diagnostics }`.
- **Existing user kit**: the same validation and build, then the result becomes the kit's pending proposal against `baseVersion`, replacing an earlier one. It returns `{ status: 'proposed', id, baseVersion, diagnostics }`. The tool's message says the user reviews it and that builds keep the current version until then.
- A preset id refuses with `preset_read_only` and suggests `from: { copy }`. A deleted kit refuses with `invalid_input`. A `baseVersion` that is not the latest refuses with `revision_conflict` and the latest number, so the agent reads again.

The rule is simple on purpose: **the agent creates kits freely; it changes an existing kit only through a proposal the user accepts.** A kit can serve many canvases, so a silent change would restyle every future request on all of them.

**Review.** A pending proposal shows in the document as a line under the header: “Proposed changes · 4 changes”, Discard and Review, without naming who proposed them. Review renders the proposal with the same change marks as a draft (§6), and the save bar reads “Proposal”, Discard and Accept as v6 (primary). Accept saves the proposal as the next version with `savedBy: agent`; if its base is no longer the latest it says so and offers Accept over v6. Accept is unavailable while the user has an unsaved draft of the kit (“Save or discard your edits first”). Neither accept nor discard sends anything to the agent; its next `list` or `read` shows the outcome.

**Guidance.** `DESIGN_CANVAS_MCP_INSTRUCTIONS` and the tool description say, briefly: read a kit before changing it; notes are short rules, not restated token values; give important tokens a usage note; make a preview cover and one or two demos when creating a kit or changing its look; use `from: { project }` for a project's styles (§12); expect changes to existing kits to become proposals.

Turn scope, mutation IDs and replay are unchanged. A proposal records the scope's `appSessionId`, never a provider session.

## 12. Create from this project

Entry: the picker's New → From this project, shown in a chat whose session has a project folder and the Canvas tools. It puts “Create a design system from this project.” into the composer and focuses it, so the user can add direction and send. No hidden text is added.

The agent explores with its own tools: the Tailwind config, CSS variable files, theme modules, the component library (for example `src/components/ui`) and any `DESIGN.md`. Then it makes one save:

```ts
kit: { id: 'acme', from: { project: [
  { path: 'tailwind.config.ts', kind: 'tailwind' },
  { path: 'src/index.css', kind: 'css' },
  { path: 'DESIGN.md', kind: 'designMd' },
] } },
changes: [/* notes on rules and conventions found, token usage notes, component and demo previews */],
examples: { 'cover.tsx': '…', 'Button.tsx': '…', 'Pricing.tsx': '…' },
cover: 'preview',
```

- **DROIDEX reads the files, not the agent.** Each path is relative to the session's project folder: no `..`, no absolute paths, the final component not a symbolic link, the real path inside the folder, a regular UTF-8 file of at most 256 KiB, at most 8 sources. So the provenance is true.
- **The existing readers do the mapping.** CSS through `designSystemSources.ts` and the root/`data-mode` rule in `designSystemTokens.ts` (shared with `extractDesignSystem`), Tailwind configs through `configLiterals.ts`, `DESIGN.md` fences and text as today. `designSystemImport.ts` maps familiar names onto the `--ds-*` contract and keeps the rest as Other tokens. The document's builder places mapped tokens in their canonical sections; a `DESIGN.md`'s prose becomes a `design.md` note. Then the agent's changes apply on top.
- **Provenance** gains a third kind, `{ project: { name, files } }`: the project folder's name, taken from the session, and the paths DROIDEX parsed.
- **Not read.** Theme modules other than Tailwind configs (a `theme.ts`, a styled-components theme) are not parsed. The agent may transcribe their values as token changes; provenance does not list them as read. The project's components are not imported as kit code: the agent describes them in notes and previews them with the kit's primitives. Kit `files` may change only if they still build with the allowed imports (`react`, `lucide-react`, the kit module), so imports of project paths fail the save.
- **What the user sees**: the agent's “Created design system” chip; the document's provenance line with counts (“6 tokens not mapped · 2 values not read”), and the importer's diagnostics (scoped rules, computed config values, unresolved references, single-mode tokens) listed under Other tokens.

## 13. Turn context and adherence

The turn context does not change shape: each request pins `{ id, version, mode }` and rests on Auto. The opening `canvas_read` brief keeps `{ ref, name, primitives, tokens, omittedNames, guidance }`, with `guidance` now the `kitGuidance` text (§2) and `tokens` grouped by section kind (`{ colors: [...], radius: [...] }`) inside the same 4 KiB name budget, so the brief stays under 21 KiB. `canvas_theme` read stays the way to get values, files and examples.

`designSystemAdherence.ts` takes its rules from the document's token sections instead of fixed token names. A kit without a section of a kind gets no check for it:

| Section | Finding | Code |
| --- | --- | --- |
| colors | A colour literal outside tokens (unchanged) | `design_system_color` |
| typography | A font outside the kit (unchanged); a font-size literal or arbitrary `text-[…]` that equals no typography token value | `design_system_font`, `design_system_type` |
| radius | A border-radius literal or arbitrary `rounded-[…]` that equals no radius token value | `design_system_radius` |
| spacing | An arbitrary padding, margin or gap literal off the spacing tokens | `design_system_spacing` |
| shadows | A box-shadow literal | `design_system_shadow` |
| any | Kit primitives unused; `--ds-*` overrides noted (unchanged) | `design_system_unused`, `design_system_override` |

Findings stay build diagnostics: on the frame and in the agent's write receipt, at most 12, never fixed silently. Guide reports; strict fails the build; the per-canvas rule and Auto's exemption are unchanged. Notes are guidance and are not checked.

## 14. Wire contract

Renderer commands, answered by `designSystemCommands.ts` without a canvas or scope, mirrored in `src/features/canvas/protocol.ts` and changed with every consumer in one commit:

| Command | Reply |
| --- | --- |
| `canvas.listDesignSystems` | `designSystems`: summaries with `savedAt`, `cover`, `proposal`; deleted kits excluded |
| `canvas.readDesignSystem { ref: { id, version } }` | `designSystem`: `{ id, version, latestVersion, name, kind, cover, sections, examples: string[], unmapped, provenance, savedAt, savedBy, proposal }` without source; `proposal` is `{ baseVersion, proposedAt, appSessionId, name, cover, sections } \| null`, `name` because a proposal may rename the kit |
| `canvas.saveDesignSystem { mutationId, id, baseVersion, name, cover, sections }` | `designSystemSaved { ref, diagnostics }`, or `revision_conflict { latestVersion }` |
| `canvas.listDesignSystemVersions { id }` | `designSystemVersions`: `{ version, savedAt, savedBy }[]` newest first |
| `canvas.restoreDesignSystemVersion { mutationId, id, version, onto }` | `designSystemSaved`, or `revision_conflict { latestVersion }` |
| `canvas.acceptDesignSystemProposal { mutationId, id, onto }` | `designSystemSaved`; `onto` is the version the user saw as latest |
| `canvas.discardDesignSystemProposal { id }` | `ok` |
| `canvas.setDesignSystemDeleted { mutationId, id, deleted }` | `ok` |
| `canvas.readKitPreview { ref: { id, version, mode }, item }` | `kitPreview`: the artifact; `item` is a preview id or `cover` or `typography`, two ids §2 keeps from previews |
| `canvas.saveKitCapture { ref, item, png }` / `canvas.readKitCapture { ref, item }` | `ok` / `kitCapture { png \| null }` |
| `canvas.copyDesignSystem`, `canvas.importDesignSystem` | unchanged commands; replies now carry the document |

Event: `designSystemsChanged { id }` after every save, accept, discard, proposal and delete, so lists, choices and open documents refresh.

## 15. Kits saved by v1.6

v1.6.0 and v1.6.1 shipped Design in beta with user kits saved as `{ modes, guidance }`. The beta label allows the format to change; it does not allow losing those kits. `designSystems.ts` reads a v1.6 version file through one converter: tokens grouped by the contract's names into the canonical sections (unknown names into Other tokens), `guidance` as a `guidance.md` note by the user (continued in `guidance-2.md` and on past 8 KiB), examples kept, no cover. It presents the same version number, so frames pinned to it keep building; the next save writes the new shape. The converter and its test are deleted in the first release after the one that ships this feature.

## 16. Out of scope

- Import from a website URL or a screenshot.
- Team or cloud sharing, sync, publishing and a kit marketplace.
- Figma variables import or export.
- Editing kit or example source in the document; the agent writes source.
- Checking prose rules mechanically, and user-defined lint rules.
- Modes other than light and dark, per-canvas forks of a kit, and merging concurrent edits.
- Restyling existing frames when a kit changes; apply stays an explicit, per-design source revision.
- SVG assets and font upload (f009's Upload font).
- Collecting deleted kits and unreferenced kit images from disk.
- Remote and small-window layouts.
- Theming DROIDEX's own chrome from a kit.
- Saving a frame as a design system from the board. `extractDesignSystem` stays a helper; exposing it is a follow-up.

## 17. Acceptance

| Scenario | Evidence |
| --- | --- |
| Open DROIDEX from the picker in a Design canvas | Document replaces the board beside the chat; cover live; nav, counts and search work; Back restores viewport and selection; Escape backs out |
| Edit `--ds-accent` and a radius, add a usage note and a note, save | Live previews update before saving; unsaved marks and bar; v2 saved; this and every canvas choosing the kit follow; a request queued before saving keeps v1 |
| Stale base | A save, accept or restore whose base is no longer the latest writes nothing and returns `revision_conflict`; the draft stays; Save over writes the next version |
| “Create a design system from this project” in a Tailwind + CSS variables repo | One save; provenance lists the parsed files; unmapped tokens and diagnostics shown; cover and demos render; a path outside the project is refused |
| Ask the agent to make the accent warmer in a user kit | A proposal, not a version; review marks; Accept makes v3; Discard leaves v2; nothing reaches the transcript but the chip |
| Presets | Read-only, Duplicate works, covers render in both modes from their `cover.tsx` |
| Delete and Undo | Kit leaves the picker, canvases fall back to Auto, pinned frames still build; Undo restores both |
| v1.6 kit on disk | Opens as a document with its guidance as a note; pinned frames build unchanged |
| Adherence | A literal radius under a kit with a radius section is reported once in guide mode and fails strict; Auto has no findings |
| Four live previews | Scrolling Components never exceeds four guests; released tiles show captures |
| Privacy canary | A unique marker in a note and a token value is absent from transcript, history, search and export |
| Light and dark | Document, picker, chips and covers checked in both app themes and both preview modes |

## Decisions

The owner settled the open questions on 2026-10-31:

1. **v1.6 kits** (§15) convert on read, with a removal condition.
2. **Agent edits to a kit it just created** are proposals, like any other agent change to an existing kit (§11).
3. **Choices follow the latest version** (§9); per-request pinning is unchanged.
4. **Kit images and Assets** (§8) ship in this release as the last slice, which can be cut without blocking the rest.
5. **The composer chip** opens the chosen kit's document where the chat has a canvas area, and the picker on the Design home (§9).
