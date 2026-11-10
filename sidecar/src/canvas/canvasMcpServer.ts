import { CanvasMcpServer } from './canvasMcpTransport.js';
import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { applyDesignSystem } from './applyDesignSystem.js';
import {
  agentElement,
  agentFrame,
  buildReport,
  renderedPreview,
  settledFrame,
} from './canvasAgentReport.js';
import { agentAnnotation } from './canvasAnnotationReport.js';
import { annotateCanvasInputSchema } from './canvasAnnotationSchema.js';
import {
  annotateSchema,
  arrangeSchema,
  createSchema,
  imageSchema,
  imageShape,
  inspectSchema,
  pageSchema,
  readSchema,
  scopeArgumentSchema,
  scopeIdSchema,
  themeSchema,
  writeSchema,
} from './canvasMcpSchemas.js';
import { canvasError, CanvasCommandError, EXPIRED_TURN } from './canvasError.js';
import { importFromProject, renderTarget, saveRender } from './canvasImageTool.js';
import { KitBuildError, kitSaveShape, saveKit } from './canvasMcpDesignSystemSave.js';
import { invalidCanvasArguments, validateCanvasTool } from './canvasMcpValidation.js';
import { CANVAS_MCP_SERVER_NAME } from './canvasMcpNames.js';
import { DESIGN_CANVAS_MCP_INSTRUCTIONS } from './designSessionGuidance.js';
import { designSystemBrief } from './designSystemBrief.js';
import type { ToolHandlerResult } from '../mcpToolUtils.js';
import type { SessionPurpose } from '../protocol.js';
import type { CanvasCapture } from './canvasCaptures.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasTurns } from './canvasTurnContext.js';
import type { ImportProjectImage } from './desktopImageChannel.js';
import type { KitPreviews } from './kitPreviews.js';
import type { CanvasFrame, CanvasScope, CanvasSnapshot, CaptureImage } from './protocol.js';
import { canvasIdentifierSchema, designSystemRefSchema, writeFilesInputSchema } from './schema.js';
import { listDesignSystems, readDesignSystem } from './designSystems.js';

/** The facts a tool answers with, and a base64 PNG the model sees beside them. */
type ToolValue = Record<string, unknown> & { png?: string };

/** One endpoint belongs to one chat; no tool argument can choose another chat. */
export function createCanvasMcpServer(
  workspace: () => Promise<CanvasWorkspace>,
  turns: Pick<CanvasTurns, 'activeScope' | 'requireScope' | 'scopeEnded'>,
  capture: CanvasCapture,
  kits: Pick<KitPreviews, 'check'>,
  getAppSessionId: () => string,
  projectFolder: (appSessionId: string) => string | null,
  importImage: ImportProjectImage,
  purpose?: SessionPurpose,
) {
  const dispatch = async (
    input: unknown,
    completion: 'read' | 'mutation',
    handler: (scope: Extract<CanvasScope, { origin: 'turn' }>) => Promise<ToolValue> | ToolValue,
  ): Promise<ToolHandlerResult> => {
    try {
      const appSessionId = getAppSessionId();
      const { scopeId } = scopeArgumentSchema.parse(input);
      const scope = scopeId
        ? turns.requireScope(scopeId, appSessionId)
        : turns.activeScope(appSessionId);
      if (scope?.origin !== 'turn') throw canvasError('scope_expired', EXPIRED_TURN);
      const { png, ...facts } = await handler(scope);
      // Successful mutations have already crossed their owner's publication gate.
      if (completion === 'read') turns.requireScope(scope.scopeId);
      const text = JSON.stringify({ ok: true, ...facts });
      if (!png) return text;
      return {
        content: [
          { type: 'text', text },
          { type: 'image', data: png, mimeType: 'image/png' },
        ],
      };
    } catch (error) {
      const failure = toolFailure(error);
      const facts = {
        ok: false,
        code: failure.code,
        message: failure.message,
        ...(failure.latestVersion === undefined ? {} : { latestVersion: failure.latestVersion }),
        ...(failure instanceof KitBuildError ? { diagnostics: failure.diagnostics } : {}),
      };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(facts) }] };
    }
  };

  const wholeBoard = async (scope: CanvasScope): Promise<CanvasSnapshot | null> =>
    scope.canvasId === null ? null : (await workspace()).snapshot(scope.canvasId);

  const board = async (scope: CanvasScope): Promise<CanvasSnapshot | null> => {
    const snapshot = await wholeBoard(scope);
    return snapshot && withinScope(snapshot, scope);
  };

  /** A frame this turn may use, on the canvas the chat is attached to. */
  const scopedFrame = async (scope: CanvasScope, designId: string) => {
    if (scope.allowedDesignIds !== 'canvas' && !scope.allowedDesignIds.includes(designId))
      throw canvasError('scope_expired', 'That frame is outside this turn’s assigned frames.');
    const snapshot = await board(scope);
    const frame = snapshot?.frames.find((entry) => entry.designId === designId);
    if (!snapshot || !frame)
      throw canvasError(
        'invalid_input',
        'That design is not on this canvas. Read the canvas summary again.',
      );
    return { canvasId: snapshot.canvasId, frame };
  };

  /** The live preview's image of the frame's current revision, never another one. */
  const captureFrame = async (
    canvasId: string,
    frame: CanvasFrame,
    scope: CanvasScope,
    image: CaptureImage,
  ): Promise<string> => {
    const { designId, revisionId, build } = frame;
    if (revisionId === null)
      throw canvasError('capture_unavailable', 'That frame has no source yet. Write it first.');
    if (build.status !== 'ready' || build.revisionId !== revisionId)
      throw canvasError(
        'capture_unavailable',
        'That revision has no working build to capture. Inspect its diagnostics, and capture it once it is ready.',
      );
    return capture(canvasId, { designId, revisionId }, turns.scopeEnded(scope.scopeId), image);
  };

  const tools = [
    tool(
      'canvas_read',
      'When the user explores, compares, or visualizes, make the result interactive with real controls, state, and data. Start each turn by calling canvas_read with no arguments to get its scopeId, attached canvas and pinned references. Pinned designs are the frames the user picked for this request and the only ones it can change. A <canvas_elements> block in the prompt lists the elements the user picked in them: change those, not the rest of the design, and read one’s exact source with view design and its design, revision and elementId. Pinned images are reference images the user attached: you see each one on the message, and canvas-asset:<assetId> places it in a design’s source. Never invent a scopeId. Subsequent reads may name only a scopeId this turn’s canvas_read returned. Pass that exact scopeId on every mutation, including theme save and apply. Never refresh a scope to retry an earlier turn’s mutation. Follow the design system the opening read returns when creating or restyling a design; under Auto, take the style from the request, then the chat’s project source, then the frames already on the canvas. Create named frames, then write each frame’s main.tsx with canvas_write, whose reply reports the build. Fix or reuse empty and failed frames instead of adding duplicates. Preserve unrelated frames and cite revision IDs when updating existing work. The same read lists the board’s annotations, each with its colour, its author, its geometry in whole board pixels — rect {x, y, width, height}, or points [{x, y}] — and the frames it is over, near, or points at with an arrow.',
      readSchema.innerType().shape,
      (raw) =>
        dispatch(raw, 'read', async (scope) => {
          const input = readSchema.parse(raw);
          const whole = await wholeBoard(scope);
          const snapshot = whole && withinScope(whole, scope);
          // A turn's opening read carries its pinned kit, so the agent need not fetch it.
          // Every frame counts toward its offers, whichever frames this turn may change.
          const kit = input.scopeId
            ? {}
            : {
                designSystem: await designSystemBrief(scope.context.designSystem, {
                  hasProjectFolder: projectFolder(scope.appSessionId) !== null,
                  hasDesigns: hasDesigns(whole),
                }),
              };
          if (!snapshot)
            return {
              scopeId: scope.scopeId,
              attached: false,
              pinned: scope.context,
              ...kit,
              frames: [],
            };
          if (input.view === 'summary') {
            const { previews, settings } = await workspace();
            return {
              scopeId: scope.scopeId,
              attached: true,
              canvasId: snapshot.canvasId,
              pinned: scope.context,
              ...kit,
              designSystemAdherence: settings.designSystemAdherence(snapshot.canvasId),
              sequence: snapshot.sequence,
              totalFrames: snapshot.frames.length,
              frames: snapshot.frames
                .slice(input.offset, input.offset + input.limit)
                .map((frame) => agentFrame(frame, previews.reportFor(snapshot.canvasId, frame))),
              annotationsVersion: snapshot.annotationsVersion,
              annotations: snapshot.annotations.map((annotation) =>
                agentAnnotation(annotation, snapshot.frames, scope.appSessionId),
              ),
            };
          }
          if (!input.designId || !input.revisionId)
            throw canvasError('invalid_input', 'Name a designId and revisionId to read source.');
          if (
            scope.allowedDesignIds !== 'canvas' &&
            !scope.allowedDesignIds.includes(input.designId)
          )
            throw canvasError(
              'scope_expired',
              'That frame is outside this turn’s assigned frames.',
            );
          const frame = snapshot.frames.find((each) => each.designId === input.designId);
          if (!frame)
            throw canvasError(
              'invalid_input',
              'That design is not on this canvas. Read the canvas summary again.',
            );
          const { designId, revisionId, elementId } = input;
          const { canvasId } = snapshot;
          const read = { scopeId: scope.scopeId, ...kit, canvasId, designId, revisionId };
          const files = await (await workspace()).readFiles(canvasId, { designId, revisionId });
          if (elementId) {
            const element = agentElement(frame.build, files, revisionId, elementId);
            if (!element)
              throw canvasError(
                'invalid_input',
                'That element is not in this revision’s build. Read its source by path instead.',
              );
            return { ...read, element };
          }
          const names = Object.keys(files).sort();
          const selected = input.paths ?? names.slice(input.offset, input.offset + input.limit);
          const source: Record<string, string> = {};
          for (const path of selected) {
            if (!Object.hasOwn(files, path))
              throw canvasError(
                'invalid_source_path',
                'That source file is not in this revision. Read its file list again.',
              );
            source[path] = files[path];
          }
          return {
            ...read,
            totalFiles: names.length,
            paths: names,
            files: source,
          };
        }),
    ),
    tool(
      'canvas_create',
      'Reserve one to four named frames on the attached canvas using the scopeId from this turn’s canvas_read, then write each one with canvas_write: its entry is main.tsx, which default-exports a React component. Use placeBeside to place variants in one row below an existing frame, with variantOf naming that frame on each so the user can pick one, and seed to copy a revision from this canvas or a library item the user named by its itemId. Size each frame for its deliverable from the board’s size groups, in CSS pixels: Screens (Phone 393×852, Tablet 768×1024, Desktop 1440×900), Print at 96 dpi (A4 794×1123, A3 1123×1587, Letter 816×1056, Poster 18×24 in 1728×2304), Social (Square 1080×1080, Portrait 1080×1350, Story 1080×1920, Landscape 1200×630) and Logo (Logo 512×512, Wide logo 1024×320, Icon 256×256). Create a small working composition first; retry with the same mutationId and scopeId after a lost response. A design system is a kit saved with canvas_theme, not frames.',
      createSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, frames, placeBeside } = createSchema.parse(raw);
          // Read before the create binds this turn's lease to the canvas it makes.
          const attachesChat = scope.canvasId === null;
          const created = await (
            await workspace()
          ).create(scope, { mutationId, frames, placeBeside });
          return {
            ...(attachesChat ? { chatAttached: true } : {}),
            created: {
              canvasId: created.canvasId,
              frames: created.frames.map((frame) => agentFrame(frame, null)),
            },
          };
        }),
    ),
    tool(
      'canvas_write',
      'Submit complete changed React/TSX files for a named frame using the scopeId from this turn’s canvas_read and the frame’s current revisionId (null for a new frame). The entry is main.tsx, which must default-export a React component; other relative .tsx, .ts and .css files are optional modules it imports. Imports may name react, lucide-react (UI icons), simple-icons (brand marks), recharts and @droidex/design-system (Tailwind available; a plain HTML document is not a frame); copy a project component in as a relative module, since project files cannot be imported. A tree without main.tsx is refused. The reply waits for the build: when it failed, fix the named file and line and write again in this turn. Use a new mutationId for each change and reuse it, with its scopeId, only to retry a lost response.',
      writeSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, designId, expectedRevisionId, files, deletedPaths, designSystem } =
            writeSchema.parse(raw);
          const input = writeFilesInputSchema.parse({
            mutationId,
            designId,
            expectedRevisionId,
            files,
            deletedPaths,
            designSystem,
          });
          const owner = await workspace();
          const receipt = await owner.write(scope, input);
          // The workspace refuses a write under a lease with no canvas; this narrows the type.
          const { canvasId } = scope;
          if (canvasId === null) return { receipt };
          const frame = await settledFrame(
            owner.changes,
            () =>
              owner.snapshot(canvasId).frames.find((entry) => entry.designId === receipt.designId),
            receipt.revisionId,
          );
          if (!frame) return { canvasId, receipt };
          // A newer write moved the frame on; report the build it is on now.
          const preview =
            frame.revisionId === receipt.revisionId && frame.build.status === 'ready'
              ? await renderedPreview(owner.previews, canvasId, frame)
              : owner.previews.reportFor(canvasId, frame);
          return { canvasId, receipt, build: buildReport(frame, preview) };
        }),
    ),
    tool(
      'canvas_inspect',
      'Read a frame’s build: its status, diagnostics with file and line, and the next step. canvas_write already reports the build it started, so inspect a build that was still running or a frame from an earlier turn. Set kind to screenshot to also see a PNG of its current revision as DROIDEX renders it; that needs a ready build and the design’s canvas open in a DROIDEX window, and otherwise reports capture_unavailable with the reason. Element capture is not available. Omit scopeId to read the active turn, or use only a scopeId this turn’s canvas_read returned.',
      inspectSchema.shape,
      (raw) =>
        dispatch(raw, 'read', async (scope) => {
          const input = inspectSchema.parse(raw);
          const { canvasId, frame } = await scopedFrame(scope, input.designId);
          if (input.revisionId && frame.revisionId !== input.revisionId)
            throw canvasError(
              'revision_conflict',
              'That design has changed. Inspect its current revision.',
            );
          if (input.kind === 'element')
            throw canvasError(
              'capture_unavailable',
              'Element capture is unavailable. Request a screenshot, or use build diagnostics and source.',
            );
          const { previews } = await workspace();
          const facts = {
            designId: frame.designId,
            revisionId: frame.revisionId,
            build: buildReport(frame, previews.reportFor(canvasId, frame)),
          };
          if (input.kind === 'diagnostics') return facts;
          const png = await captureFrame(canvasId, frame, scope, { format: 'png', scale: null });
          return { ...facts, png };
        }),
    ),
    tool(
      'canvas_image',
      'Save a frame as an image file in this chat’s project folder, or make an image already in that folder one of the canvas’s images, using the scopeId from this turn’s canvas_read. Use it for deliverables (posters, logos, icons, social images) and for the project’s own images. kind render captures the frame’s current revision as DROIDEX renders it, which needs a ready build and its canvas open in a DROIDEX window, and writes it to "to", a path relative to the project folder: format png (the default) at scale 1, 2 or 3 (default 1, the frame’s own CSS size), or svg when the frame’s root element is a single <svg>. It never replaces a file unless overwrite is true, and the reply shows the PNG. kind import reads "from", a PNG, JPEG, WebP or SVG under 10 MiB in the project folder, and returns its reference: canvas-asset:<assetId> places it in a design’s source.',
      imageShape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const input = imageSchema.parse(raw);
          const folder = projectFolder(scope.appSessionId);
          if (input.kind === 'import') {
            if (scope.canvasId === null)
              throw canvasError(
                'invalid_input',
                'This chat has no canvas yet. Create a frame first, then import the image.',
              );
            const signal = turns.scopeEnded(scope.scopeId);
            return importFromProject(folder, input.from, scope.canvasId, importImage, signal);
          }
          const target = await renderTarget(folder, input.to, input.format);
          const { canvasId, frame } = await scopedFrame(scope, input.designId);
          const image: CaptureImage =
            input.format === 'svg' ? { format: 'svg' } : { format: 'png', scale: input.scale };
          const captured = await captureFrame(canvasId, frame, scope, image);
          const saved = await saveRender(
            target,
            input.format === 'svg'
              ? { format: 'svg', markup: captured }
              : { format: 'png', base64: captured },
            input.overwrite,
            turns.scopeEnded(scope.scopeId),
          );
          return { designId: frame.designId, revisionId: frame.revisionId, ...saved };
        }),
    ),
    tool(
      'canvas_arrange',
      'Move or resize existing frames using the scopeId from this turn’s canvas_read and their current layout versions: each frame takes the full new rect, so a new width or height resizes it. This changes board layout only.',
      arrangeSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, frames } = arrangeSchema.parse(raw);
          return { change: await (await workspace()).arrange(scope, { mutationId, frames }) };
        }),
    ),
    tool(
      'canvas_annotate',
      'Draw on the board beside the frames using the scopeId and annotationsVersion from this turn’s canvas_read: rect, ellipse, line (arrowStart/arrowEnd), path, text or note, in board coordinates, with a colour token. Upsert by id to redraw and list ids in deletes to remove, but only annotations whose author is you; the user’s are read-only. A stale annotationsVersion is a revision_conflict: read again and retry. Annotations never change frames or source.',
      annotateSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, expectedAnnotationsVersion, upserts, deletes } =
            annotateSchema.parse(raw);
          const input = annotateCanvasInputSchema.parse({
            mutationId,
            expectedAnnotationsVersion,
            upserts,
            deletes,
          });
          const owner = await workspace();
          const { annotations } = await owner.annotations.annotate(scope, input);
          const frames = (await board(scope))?.frames ?? [];
          return {
            annotationsVersion: annotations.version,
            annotations: annotations.upserted.map((annotation) =>
              agentAnnotation(annotation, frames, scope.appSessionId),
            ),
            removedIds: annotations.removedIds,
          };
        }),
    ),
    tool(
      'canvas_theme',
      'List or read versioned design systems: omit scopeId to use the active turn, or use only a scopeId this turn’s canvas_read returned. Save and apply require that returned scopeId; reuse it and mutationId on retry. Apply to a named design at its current revision. Save sends changes, not a whole kit: a new id starts from blank, a copy, or this chat’s project files (from: { project: [{ path, kind }] }; kind is tailwind, css, tokens for a JS, TS or JSON token module, or designMd; or a shadcn/ui library’s components.json alone, kind shadcn, which copies its components into the kit with its stylesheet’s tokens and Tailwind theme) and saves version 1, while a change to an existing kit becomes a proposal the user reviews, so read that kit first and pass the version you read as baseVersion; send a new kit whole in its first save. Changes find tokens by name, notes by label, previews by title and images by name; a new token needs its section and group, and goes last in that group unless before names the token it goes just ahead of, so keep each scale in order, smallest first. From a description: start from blank, keep its token names (text-2xs before text-xs, text-2xl after text-xl), set light and dark colours, a type scale in Inter (embedded) or a system stack, spacing, radius, shadows and motion for that product, and set its 1-rules.md note to the product’s rules, keeping the shared ones that still hold, instead of adding a second. Extracting from a project or site: the import reads the named files, then your changes add what it missed — keep the source’s own token names (only the --ds- prefix is added, dots become hyphens), never rename or invent them, set values per mode where the source does, and move imported tokens into their proper sections and groups, covering every category the source has: Colors, Typography, Spacing, Corner radius, Shadows, Size, Z index, Motion. Notes are short neutral rules with no author, never restated token values, and name tokens bare (accent, never --ds-accent); give important tokens and each primitive a usage note. When you create a kit or change its look, write a cover.tsx example (1200 × 480) with cover: preview, and two or three demos as previews. Each example renders in a box exactly its preview’s size: fix its root at that size with overflow hidden (<main className="h-[480px] w-[1200px] overflow-hidden"> for the cover), never min-h-screen, h-screen, h-full or vh units, which follow the window. The cover is the brand’s poster, not a screen: the brand colours at full strength in both modes, one graphic idea from the brand’s geometry or mark (a giant form, layered cards under a sticker, or a texture field), a large headline in the kit’s faces and the mark small, with no app chrome, window or controls. Build each demo as the product’s own screen as it ships, not a mockup: a structured screen from the kit’s tokens and primitives cropped to its subject, real words and honest data on the subject and placeholder lines elsewhere, depth from surface tones not borders, no backdrop plate, no device frame or browser window unless that chrome is the product, no sparkles, stock-AI purple or made-up logos. After saving, read the kit back and check each example against its box and both modes’ token values. Save compiles index.tsx and every example and refuses with file and line diagnostics. Never invent a scopeId.',
      {
        scopeId: scopeIdSchema
          .optional()
          .describe(
            'Required for save and apply: use this turn’s canvas_read scopeId. For list and read, omit it to use the active turn, or use only a scopeId this turn’s canvas_read returned.',
          ),
        operation: z.enum(['list', 'read', 'save', 'apply']),
        offset: pageSchema.optional(),
        limit: z.number().int().min(1).max(32).optional(),
        ref: designSystemRefSchema.optional(),
        mutationId: canvasIdentifierSchema.optional(),
        ...kitSaveShape,
        kit: kitSaveShape.kit.optional(),
        designId: canvasIdentifierSchema.optional(),
        expectedRevisionId: canvasIdentifierSchema.optional(),
      },
      (raw) =>
        dispatch(
          raw,
          raw.operation === 'save' || raw.operation === 'apply' ? 'mutation' : 'read',
          async (scope) => {
            const input = themeSchema.parse(raw);
            if (input.operation === 'list') {
              const systems = await listDesignSystems();
              return {
                systems: systems.slice(input.offset, input.offset + input.limit),
                total: systems.length,
                selected: scope.context.designSystem,
              };
            }
            if (input.operation === 'read') return { system: await readDesignSystem(input.ref) };
            if (input.operation === 'save')
              return saveKit(input, {
                appSessionId: scope.appSessionId,
                kits,
                projectFolder: () => projectFolder(scope.appSessionId),
                beforePublish: () => {
                  turns.requireScope(scope.scopeId);
                },
              });
            const result = await applyDesignSystem(await workspace(), scope, {
              mutationId: input.mutationId,
              designId: input.designId,
              expectedRevisionId: input.expectedRevisionId,
              system: input.ref,
            });
            if (result.status === 'refused') {
              turns.requireScope(scope.scopeId);
              const diagnostic = result.diagnostics[0];
              const code =
                diagnostic.code === 'version_mismatch' ? 'version_mismatch' : 'invalid_source';
              throw canvasError(code, diagnostic.message);
            }
            return {
              status: 'applied',
              ref: { id: input.ref.id, version: input.ref.version },
              receipt: result.receipt,
            };
          },
        ),
    ),
  ];
  return new CanvasMcpServer(
    {
      name: CANVAS_MCP_SERVER_NAME,
      version: '1.0.0',
      tools: tools.map(validateCanvasTool),
    },
    purpose === 'design' ? DESIGN_CANVAS_MCP_INSTRUCTIONS : undefined,
  );
}

/** The canvas as this turn sees it: every frame, or only the frames it was assigned. */
function withinScope(snapshot: CanvasSnapshot, scope: CanvasScope): CanvasSnapshot {
  const allowed = scope.allowedDesignIds;
  if (allowed === 'canvas') return snapshot;
  return {
    ...snapshot,
    frames: snapshot.frames.filter((frame) => allowed.includes(frame.designId)),
  };
}

function hasDesigns(snapshot: CanvasSnapshot | null): boolean {
  return snapshot?.frames.some((frame) => frame.revisionId !== null) ?? false;
}

function toolFailure(error: unknown): CanvasCommandError {
  if (error instanceof CanvasCommandError) return error;
  if (error instanceof z.ZodError) return invalidCanvasArguments(error);
  return canvasError('storage_failed', 'Canvas could not finish that request. Retry it.');
}
