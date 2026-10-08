import { CanvasMcpServer } from './canvasMcpTransport.js';
import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { applyDesignSystem } from './applyDesignSystem.js';
import { canvasError, CanvasCommandError, EXPIRED_TURN } from './canvasError.js';
import { invalidCanvasArguments, validateCanvasTool } from './canvasMcpValidation.js';
import { CANVAS_MCP_SERVER_NAME } from './canvasMcpNames.js';
import { DESIGN_CANVAS_MCP_INSTRUCTIONS } from './designSessionGuidance.js';
import type { SessionPurpose } from '../protocol.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasTurns } from './canvasTurnContext.js';
import type { CanvasScope } from './protocol.js';
import {
  arrangeFramesInputSchema,
  canvasIdentifierSchema,
  createFramesInputSchema,
  designSystemRefSchema,
  writeFilesInputSchema,
} from './schema.js';
import {
  designSystemSchema,
  listDesignSystems,
  readDesignSystem,
  saveDesignSystem,
} from './designSystems.js';

const authoredSystemSchema = designSystemSchema.omit({ provenance: true });
const scopeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The exact scopeId returned by this turn’s canvas_read. Never invent an ID or reuse one from an earlier turn.',
  );
const scopeShape = {
  scopeId: scopeIdSchema
    .optional()
    .describe(
      'Omit scopeId to begin the turn. Only supply a scopeId this turn’s canvas_read returned to keep reading that lease’s pinned references.',
    ),
};
const mutationScopeShape = { scopeId: scopeIdSchema };
const scopeArgumentSchema = z.object(scopeShape).passthrough();
const pageSchema = z.number().int().min(0).max(100_000);
const readSchema = z
  .object({
    ...scopeShape,
    view: z.enum(['summary', 'design']).default('summary'),
    designId: canvasIdentifierSchema.optional(),
    revisionId: canvasIdentifierSchema.optional(),
    paths: z.array(z.string().min(1).max(256)).max(16).optional(),
    offset: pageSchema.default(0),
    limit: z.number().int().min(1).max(32).default(32),
  })
  .strict();
const createSchema = createFramesInputSchema.extend(mutationScopeShape).strict();
const writeSchema = z
  .object({ ...writeFilesInputSchema.innerType().shape, ...mutationScopeShape })
  .strict();
const arrangeSchema = arrangeFramesInputSchema.extend(mutationScopeShape).strict();
const inspectSchema = z
  .object({
    ...scopeShape,
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema.optional(),
    kind: z.enum(['diagnostics', 'element', 'screenshot']).default('diagnostics'),
    elementId: canvasIdentifierSchema.optional(),
  })
  .strict();
const themeSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...scopeShape,
      operation: z.literal('list'),
      offset: pageSchema.default(0),
      limit: z.number().int().min(1).max(32).default(32),
    })
    .strict(),
  z.object({ ...scopeShape, operation: z.literal('read'), ref: designSystemRefSchema }).strict(),
  z
    .object({
      ...mutationScopeShape,
      operation: z.literal('save'),
      mutationId: canvasIdentifierSchema,
      system: authoredSystemSchema,
    })
    .strict(),
  z
    .object({
      ...mutationScopeShape,
      operation: z.literal('apply'),
      mutationId: canvasIdentifierSchema,
      designId: canvasIdentifierSchema,
      expectedRevisionId: canvasIdentifierSchema,
      ref: designSystemRefSchema,
    })
    .strict(),
]);

type ToolReply = string | { isError: true; content: [{ type: 'text'; text: string }] };

/** One endpoint belongs to one chat; no tool argument can choose another chat. */
export function createCanvasMcpServer(
  workspace: () => Promise<CanvasWorkspace>,
  turns: Pick<CanvasTurns, 'activeScope' | 'requireScope'>,
  getAppSessionId: () => string,
  purpose?: SessionPurpose,
) {
  const dispatch = async (
    input: unknown,
    completion: 'read' | 'mutation',
    handler: (
      scope: Extract<CanvasScope, { origin: 'turn' }>,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ): Promise<ToolReply> => {
    try {
      const appSessionId = getAppSessionId();
      const { scopeId } = scopeArgumentSchema.parse(input);
      const scope = scopeId
        ? turns.requireScope(scopeId, appSessionId)
        : turns.activeScope(appSessionId);
      if (scope?.origin !== 'turn') throw canvasError('scope_expired', EXPIRED_TURN);
      const value = await handler(scope);
      // Successful mutations have already crossed their owner's publication gate.
      if (completion === 'read') turns.requireScope(scope.scopeId);
      return JSON.stringify({ ok: true, ...value });
    } catch (error) {
      const failure = toolFailure(error);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, code: failure.code, message: failure.message }),
          },
        ],
      };
    }
  };

  const board = async (
    scope: CanvasScope,
  ): Promise<ReturnType<CanvasWorkspace['snapshot']> | null> => {
    if (scope.canvasId === null) return null;
    const owner = await workspace();
    const snapshot = owner.snapshot(scope.canvasId);
    const allowed = scope.allowedDesignIds;
    if (allowed === 'canvas') return snapshot;
    return {
      ...snapshot,
      frames: snapshot.frames.filter((frame) => allowed.includes(frame.designId)),
    };
  };

  const tools = [
    tool(
      'canvas_read',
      'When the user explores, compares, or visualizes, make the result interactive with real controls, state, and data. Start each turn by calling canvas_read with no arguments to get its scopeId, attached canvas and pinned references. Never invent a scopeId. Subsequent reads may name only a scopeId this turn’s canvas_read returned. Pass that exact scopeId on every mutation, including theme save and apply. Never refresh a scope to retry an earlier turn’s mutation. Read the selected design system before creating or restyling a design. Create named frames, submit complete working files, then inspect the result. Preserve unrelated frames and cite revision IDs when updating existing work.',
      readSchema.shape,
      (raw) =>
        dispatch(raw, 'read', async (scope) => {
          const input = readSchema.parse(raw);
          const snapshot = await board(scope);
          if (!snapshot)
            return { scopeId: scope.scopeId, attached: false, pinned: scope.context, frames: [] };
          const frames = snapshot.frames.slice(input.offset, input.offset + input.limit);
          if (input.view === 'summary')
            return {
              scopeId: scope.scopeId,
              attached: true,
              canvasId: snapshot.canvasId,
              pinned: scope.context,
              sequence: snapshot.sequence,
              totalFrames: snapshot.frames.length,
              frames,
            };
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
          if (!snapshot.frames.some((frame) => frame.designId === input.designId))
            throw canvasError(
              'invalid_input',
              'That design is not on this canvas. Read the canvas summary again.',
            );
          const files = await (
            await workspace()
          ).readFiles(snapshot.canvasId, {
            designId: input.designId,
            revisionId: input.revisionId,
          });
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
            scopeId: scope.scopeId,
            canvasId: snapshot.canvasId,
            designId: input.designId,
            revisionId: input.revisionId,
            totalFiles: names.length,
            paths: names,
            files: source,
          };
        }),
    ),
    tool(
      'canvas_create',
      'Reserve one to four named frames on the attached canvas using the scopeId from this turn’s canvas_read. Use placeBeside to place variants below an existing frame and seed to copy a revision from this canvas. Create a small working composition first; retry with the same mutationId and scopeId after a lost response.',
      createSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, frames, placeBeside } = createSchema.parse(raw);
          return {
            created: await (await workspace()).create(scope, { mutationId, frames, placeBeside }),
          };
        }),
    ),
    tool(
      'canvas_write',
      'Submit complete changed React/TSX files (the canvas compiles them with Tailwind available; a plain HTML document is not a frame) for a named frame using the scopeId from this turn’s canvas_read and its current revisionId. Preserve unrelated frames and reuse mutationId and scopeId on retry.',
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
          return { receipt: await (await workspace()).write(scope, input) };
        }),
    ),
    tool(
      'canvas_inspect',
      'Inspect a design build and its diagnostics before revising it. Omit scopeId to read the active turn, or use only a scopeId this turn’s canvas_read returned. Screenshot and element capture report when no agent capture is available.',
      inspectSchema.shape,
      (raw) =>
        dispatch(raw, 'read', async (scope) => {
          const input = inspectSchema.parse(raw);
          if (
            scope.allowedDesignIds !== 'canvas' &&
            !scope.allowedDesignIds.includes(input.designId)
          )
            throw canvasError(
              'scope_expired',
              'That frame is outside this turn’s assigned frames.',
            );
          const snapshot = await board(scope);
          const frame = snapshot?.frames.find((entry) => entry.designId === input.designId);
          if (!frame)
            throw canvasError(
              'invalid_input',
              'That design is not on this canvas. Read the canvas summary again.',
            );
          if (input.revisionId && frame.revisionId !== input.revisionId)
            throw canvasError(
              'revision_conflict',
              'That design has changed. Inspect its current revision.',
            );
          if (input.kind !== 'diagnostics')
            throw canvasError(
              'capture_unavailable',
              'Agent element and screenshot capture is unavailable. Use build diagnostics and source for now.',
            );
          return { designId: frame.designId, revisionId: frame.revisionId, build: frame.build };
        }),
    ),
    tool(
      'canvas_arrange',
      'Move or resize existing frames using the scopeId from this turn’s canvas_read and their current layout versions. This changes board layout only.',
      arrangeSchema.shape,
      (raw) =>
        dispatch(raw, 'mutation', async (scope) => {
          const { mutationId, frames } = arrangeSchema.parse(raw);
          return { change: await (await workspace()).arrange(scope, { mutationId, frames }) };
        }),
    ),
    tool(
      'canvas_theme',
      'List or read versioned design systems on demand: omit scopeId to use the active turn, or use only a scopeId this turn’s canvas_read returned. Save and apply require that returned scopeId; reuse it and mutationId on retry. Apply to a named design at its current revision. Never invent a scopeId.',
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
        system: authoredSystemSchema.optional(),
        mutationId: canvasIdentifierSchema.optional(),
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
              return {
                ref: await saveDesignSystem(input.system, {
                  mutationId: input.mutationId,
                  beforePublish: () => {
                    turns.requireScope(scope.scopeId);
                  },
                }),
              };
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
            return { receipt: result.receipt };
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

function toolFailure(error: unknown): CanvasCommandError {
  if (error instanceof CanvasCommandError) return error;
  if (error instanceof z.ZodError) return invalidCanvasArguments(error);
  return canvasError('storage_failed', 'Canvas could not finish that request. Retry it.');
}
