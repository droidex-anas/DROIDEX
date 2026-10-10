import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';

import type * as Renderer from '../../../src/features/canvas/protocol.js';
import { isCanvasEvent } from '../../../src/features/canvas/wireValidation.js';
import type {
  ArrangeFramesInput,
  RemoveFramesInput,
  RenameFrameInput,
  UndoRemovalInput,
  CanvasChange,
  CanvasCommand,
  CanvasError,
  CanvasEvent,
  CanvasReply,
  CanvasSnapshot,
  CanvasSummary,
  CanvasTurnContext,
  CreateCanvasResult,
  CreateFramesInput,
  CreateFramesResult,
  DesignRef,
  DesignSystemRef,
  EditElementInput,
  ElementRef,
  RevisionDiff,
  RevisionPage,
  RevisionSummary,
  RestoreRevisionInput,
  SourceElement,
  WriteFilesInput,
  WriteReceipt,
} from './protocol.js';
import {
  arrangeFramesInputSchema,
  createFramesInputSchema,
  editElementInputSchema,
  removeFramesInputSchema,
  renameFrameInputSchema,
  undoRemovalInputSchema,
  writeFilesInputSchema,
} from './schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every DTO the renderer mirrors. Assignability is too weak to catch a mirror
// that gained an optional field, so ExactMirror below compares each pair for
// type identity instead.
type SidecarWire = {
  create: CreateFramesInput;
  createCanvasResult: CreateCanvasResult;
  createResult: CreateFramesResult;
  write: WriteFilesInput;
  arrange: ArrangeFramesInput;
  remove: RemoveFramesInput;
  undo: UndoRemovalInput;
  rename: RenameFrameInput;
  snapshot: CanvasSnapshot;
  change: CanvasChange;
  summary: CanvasSummary;
  receipt: WriteReceipt;
  turnContext: CanvasTurnContext;
  designRef: DesignRef;
  elementRef: ElementRef;
  element: SourceElement;
  edit: EditElementInput;
  revision: RevisionSummary;
  diff: RevisionDiff;
  page: RevisionPage;
  restore: RestoreRevisionInput;
  error: CanvasError;
  command: CanvasCommand;
  reply: CanvasReply;
  event: CanvasEvent;
};

type RendererWire = {
  create: Renderer.CreateFramesInput;
  createCanvasResult: Renderer.CreateCanvasResult;
  createResult: Renderer.CreateFramesResult;
  write: Renderer.WriteFilesInput;
  arrange: Renderer.ArrangeFramesInput;
  remove: Renderer.RemoveFramesInput;
  undo: Renderer.UndoRemovalInput;
  rename: Renderer.RenameFrameInput;
  snapshot: Renderer.CanvasSnapshot;
  change: Renderer.CanvasChange;
  summary: Renderer.CanvasSummary;
  receipt: Renderer.WriteReceipt;
  turnContext: Renderer.CanvasTurnContext;
  designRef: Renderer.DesignRef;
  elementRef: Renderer.ElementRef;
  element: Renderer.SourceElement;
  edit: Renderer.EditElementInput;
  revision: Renderer.RevisionSummary;
  diff: Renderer.RevisionDiff;
  page: Renderer.RevisionPage;
  restore: Renderer.RestoreRevisionInput;
  error: Renderer.CanvasError;
  command: Renderer.CanvasCommand;
  reply: Renderer.CanvasReply;
  event: Renderer.CanvasEvent;
};

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// One entry per mirrored DTO. A drifted mirror types its entry as `false`, and
// the compile error names the property that drifted.
type ExactMirror = { [Key in keyof SidecarWire]: Equals<SidecarWire[Key], RendererWire[Key]> };

const designSystem: DesignSystemRef = { id: 'droidex', version: 3, mode: 'dark' };

const wire: SidecarWire = {
  createCanvasResult: { canvasId: 'cv_01', attachedCanvasId: 'cv_02' },
  create: {
    mutationId: 'create-hey',
    placeBeside: { designId: 'dsg_hey' },
    frames: [
      { name: 'Hey', width: 720, height: 720, designSystem },
      {
        name: 'Hey variant',
        width: 720,
        height: 720,
        designSystem,
        seed: {
          kind: 'revision',
          canvasId: 'cv_01',
          revision: { designId: 'dsg_hey', revisionId: 'rev_01' },
        },
      },
    ],
  },
  createResult: {
    canvasId: 'cv_01',
    frames: [
      {
        designId: 'dsg_hey',
        name: 'Hey',
        rect: { x: 0, y: 0, width: 720, height: 720 },
        layoutVersion: 0,
        manifestVersion: 0,
        revisionId: null,
        designSystem,
        build: { status: 'pending', generation: 0 },
      },
    ],
  },
  write: {
    mutationId: 'write-hey',
    designId: 'dsg_hey',
    expectedRevisionId: null,
    files: {
      'main.tsx': 'export default function Hey() {\n  return <h1>Hey</h1>;\n}\n',
      'ui/Cta.tsx': 'export const Cta = () => <button type="button">Get started</button>;\n',
    },
    deletedPaths: ['ui/Legacy.tsx'],
    designSystem,
  },
  arrange: {
    mutationId: 'arrange-hey',
    frames: [
      {
        designId: 'dsg_hey',
        expectedLayoutVersion: 2,
        rect: { x: 0, y: 0, width: 720, height: 720 },
      },
    ],
  },
  remove: { mutationId: 'remove-hey', designIds: ['dsg_hey'] },
  undo: { mutationId: 'undo-hey', undoId: 'undo_01' },
  rename: {
    mutationId: 'rename-hey',
    designId: 'dsg_hey',
    name: 'Hey again',
    expectedManifestVersion: 2,
  },
  snapshot: {
    canvasId: 'cv_01',
    sequence: 7,
    frames: [
      {
        designId: 'dsg_hey',
        name: 'Hey',
        rect: { x: 0, y: 0, width: 720, height: 720 },
        layoutVersion: 2,
        manifestVersion: 2,
        revisionId: 'rev_02',
        designSystem,
        build: {
          status: 'ready',
          revisionId: 'rev_02',
          artifactId: 'art_02',
          elements: [],
          diagnostics: [],
          generation: 1,
        },
      },
      {
        designId: 'dsg_reserved',
        name: 'Cards',
        rect: { x: 760, y: 0, width: 720, height: 720 },
        layoutVersion: 1,
        manifestVersion: 1,
        revisionId: null,
        designSystem,
        build: { status: 'pending', generation: 0 },
      },
    ],
  },
  change: {
    canvasId: 'cv_01',
    sequence: 8,
    frames: [
      {
        designId: 'dsg_hey',
        name: 'Hey',
        rect: { x: 0, y: 0, width: 720, height: 720 },
        layoutVersion: 2,
        manifestVersion: 2,
        revisionId: 'rev_03',
        designSystem,
        build: {
          status: 'failed',
          generation: 2,
          revisionId: 'rev_03',
          diagnostics: [
            {
              code: 'unsupported_import',
              message: 'Import "lodash" is not available.',
              file: 'main.tsx',
              line: 1,
              column: 8,
            },
          ],
          lastWorkingRevisionId: 'rev_02',
        },
      },
    ],
    removedDesignIds: ['dsg_reserved'],
  },
  summary: {
    canvasId: 'cv_01',
    name: 'Components',
    updatedAt: 1_767_225_600_000,
    designCount: 2,
    attachedAppSessionIds: ['app_session_01', 'app_session_02'],
    designSystemAdherence: 'guide',
  },
  receipt: { designId: 'dsg_hey', revisionId: 'rev_03', sequence: 8 },
  turnContext: {
    designs: [{ designId: 'dsg_hey', revisionId: 'rev_02' }],
    elements: [
      { designId: 'dsg_hey', revisionId: 'rev_02', elementId: 'el_17', instancePath: '0/2/1' },
    ],
    designSystem,
  },
  designRef: { designId: 'dsg_hey', revisionId: 'rev_02' },
  elementRef: {
    designId: 'dsg_hey',
    revisionId: 'rev_02',
    elementId: 'el_17',
    instancePath: '0/2/1',
  },
  element: {
    elementId: 'el_17',
    file: 'main.tsx',
    start: 48,
    end: 64,
    tagName: 'h1',
    editability: 'literal',
  },
  edit: {
    mutationId: 'edit-hey',
    edit: {
      element: { designId: 'dsg_hey', revisionId: 'rev_02', elementId: 'el_17', instancePath: '0' },
      change: { kind: 'text', value: 'Welcome' },
    },
  },
  error: { code: 'revision_conflict', message: 'Reload the design and reapply your change.' },
  revision: {
    state: 'saved',
    revisionId: 'rev_02',
    restoredFromRevisionId: 'rev_01',
    sequence: 7,
    createdAt: 1_767_225_600_000,
    author: { kind: 'agent', scopeRef: 'scope-safe' },
    designSystem,
    buildStatus: 'ready',
    mutationKind: 'restore',
  },
  diff: {
    from: 'rev_01',
    to: 'rev_02',
    files: [{ path: 'main.tsx', kind: 'modified', diff: '-old\n+new\n', truncated: false }],
  },
  page: { limit: 50, before: 7 },
  restore: {
    mutationId: 'restore-hey',
    designId: 'dsg_hey',
    revisionId: 'rev_01',
    expectedRevisionId: 'rev_02',
  },
  command: {
    type: 'canvas.write',
    requestId: 'req_01',
    appSessionId: 'app_01',
    canvasId: 'cv_01',
    input: {
      mutationId: 'write-hey',
      designId: 'dsg_hey',
      expectedRevisionId: 'rev_02',
      files: { 'main.tsx': 'export default function Hey() {\n  return <h1>Hey</h1>;\n}\n' },
      deletedPaths: [],
    },
  },
  reply: { kind: 'written', receipt: { designId: 'dsg_hey', revisionId: 'rev_03', sequence: 8 } },
  event: {
    type: 'canvas.result',
    requestId: 'req_01',
    ok: false,
    error: { code: 'scope_expired', message: 'This chat is not attached to that canvas.' },
  },
};

test('the renderer mirrors every wire DTO exactly, and the fixtures are plain JSON', () => {
  const exact: ExactMirror = {
    create: true,
    createCanvasResult: true,
    createResult: true,
    write: true,
    arrange: true,
    remove: true,
    undo: true,
    rename: true,
    snapshot: true,
    change: true,
    summary: true,
    receipt: true,
    turnContext: true,
    designRef: true,
    elementRef: true,
    element: true,
    edit: true,
    revision: true,
    diff: true,
    page: true,
    restore: true,
    error: true,
    command: true,
    reply: true,
    event: true,
  };
  assert.ok(Object.values(exact).every((isExact) => isExact));
  assert.deepEqual(JSON.parse(JSON.stringify(wire)), wire);
});

test('every serialized event the sidecar emits passes the renderer validator', () => {
  const summaries = [wire.summary];
  const events: CanvasEvent[] = [
    { type: 'canvas.result', requestId: 'req_01', ok: true, reply: { kind: 'ok' } },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'summaries', summaries },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'attachment', canvasId: 'cv_01' },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'attachment', canvasId: null },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'canvasCreated', ...wire.createCanvasResult },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'canvasCreated', canvasId: 'cv_01', attachedCanvasId: null },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'created', created: wire.createResult },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'written', receipt: wire.receipt },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'arranged', change: wire.change },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'removed', undoId: 'undo_01' },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'undone', change: wire.change },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'renamed', change: wire.change },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: false,
      error: {
        code: 'layout_conflict',
        message: 'Move the occupant.',
        currentRect: { x: 0, y: 0, width: 720, height: 720 },
      },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: {
        kind: 'artifact',
        artifact: { artifactId: 'a'.repeat(64), html: '<!doctype html><body>Hey</body>' },
      },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'artifact', artifact: null },
    },
    wire.event,
    {
      type: 'canvas.result',
      requestId: 'req_02',
      ok: false,
      error: { code: 'unknown_chat', message: 'Open a saved chat and try again.' },
    },
    {
      type: 'canvas.result',
      requestId: 'req_02',
      ok: false,
      error: { code: 'stale_revision', message: 'Reselect the element.' },
    },
    { type: 'canvas.snapshot', requestId: 'req_01', snapshot: wire.snapshot },
    { type: 'canvas.summaries', summaries },
    { type: 'canvas.change', change: wire.change },
  ];
  // Types agreeing is not enough: the two runtime bounds have to agree too, or
  // a reply the sidecar accepts arrives as an event the renderer throws away.
  for (const event of events) {
    const serialized: unknown = JSON.parse(JSON.stringify(event));
    assert.ok(isRecord(serialized) && isCanvasEvent(serialized), `rejected ${event.type}`);
  }
  // The renderer's half of the one correlation bound; canvasBridge.test.ts
  // holds the sidecar to the same length through the dispatch boundary.
  assert.ok(isCanvasEvent({ ...wire.event, requestId: 'r'.repeat(128) }));
  assert.equal(isCanvasEvent({ ...wire.event, requestId: 'r'.repeat(129) }), false);
});

test('the renderer accepts a ready element map and rejects incomplete or unbounded maps', () => {
  const ready = {
    status: 'ready',
    revisionId: 'rev_02',
    artifactId: 'art_02',
    elements: [wire.element],
    diagnostics: [{ code: 'selection_unavailable', message: 'Reselect after rebuilding.' }],
    generation: 1,
  };
  const event = (build: unknown) => ({
    type: 'canvas.snapshot',
    requestId: 'req_01',
    snapshot: {
      ...wire.snapshot,
      frames: [{ ...wire.snapshot.frames[0], build }],
    },
  });

  assert.equal(isCanvasEvent(event(ready)), true);
  assert.equal(
    isCanvasEvent(
      event({
        status: 'ready',
        revisionId: 'rev_02',
        artifactId: 'art_02',
        diagnostics: [],
        generation: 1,
      }),
    ),
    false,
  );
  assert.equal(isCanvasEvent(event({ ...ready, diagnostics: undefined })), false);
  assert.equal(
    isCanvasEvent(event({ ...ready, elements: new Array(8193).fill(wire.element) })),
    false,
  );
  assert.equal(
    isCanvasEvent(event({ ...ready, diagnostics: new Array(65).fill(ready.diagnostics[0]) })),
    false,
  );
  assert.equal(isCanvasEvent(event({ ...ready, elements: [{ ...wire.element, end: 47 }] })), false);
});

test('the renderer bounds restored-from revision identities in history replies', () => {
  const event = (restoredFromRevisionId: unknown) => ({
    type: 'canvas.result',
    requestId: 'req_01',
    ok: true,
    reply: {
      kind: 'revisions',
      revisions: [{ ...wire.revision, restoredFromRevisionId }],
    },
  });
  assert.equal(isCanvasEvent(event('rev_01')), true);
  assert.equal(isCanvasEvent(event(undefined)), true);
  for (const invalid of [null, '', 'r'.repeat(129), 1]) {
    assert.equal(isCanvasEvent(event(invalid)), false);
  }
});

test('the mutation fixtures parse, and the parsed values fit the mirror', () => {
  const create: Renderer.CreateFramesInput = createFramesInputSchema.parse(wire.create);
  const write: Renderer.WriteFilesInput = writeFilesInputSchema.parse(wire.write);
  const arrange: Renderer.ArrangeFramesInput = arrangeFramesInputSchema.parse(wire.arrange);
  const edit: Renderer.EditElementInput = editElementInputSchema.parse(wire.edit);
  const remove: Renderer.RemoveFramesInput = removeFramesInputSchema.parse(wire.remove);
  const undo: Renderer.UndoRemovalInput = undoRemovalInputSchema.parse(wire.undo);
  const rename: Renderer.RenameFrameInput = renameFrameInputSchema.parse(wire.rename);
  assert.deepEqual(create, wire.create);
  assert.deepEqual(write, wire.write);
  assert.deepEqual(arrange, wire.arrange);
  assert.deepEqual(edit, wire.edit);
  assert.deepEqual(remove, wire.remove);
  assert.deepEqual(undo, wire.undo);
  assert.deepEqual(rename, wire.rename);
});

test('create rejects more than four frames and an out-of-range dimension', () => {
  const frame = wire.create.frames[0];
  assert.match(
    rejection(createFramesInputSchema, { ...wire.create, frames: new Array(5).fill(frame) }),
    /1 to 4 frames/,
  );
  assert.match(
    rejection(createFramesInputSchema, { ...wire.create, frames: [{ ...frame, width: 8193 }] }),
    /between 1 and 8192/,
  );
});

test('create and arrange reject an identifier that is too long and a NaN coordinate', () => {
  assert.match(
    rejection(createFramesInputSchema, { ...wire.create, mutationId: 'm'.repeat(129) }),
    /1 to 128 characters/,
  );
  const [frame] = wire.arrange.frames;
  assert.match(
    rejection(arrangeFramesInputSchema, {
      ...wire.arrange,
      frames: [{ ...frame, rect: { ...frame.rect, x: Number.NaN } }],
    }),
    /finite numbers/,
  );
  assert.match(
    rejection(createFramesInputSchema, {
      ...wire.create,
      frames: [{ ...wire.create.frames[0], name: 'Hey\u0085' }],
    }),
    /without control characters/,
  );
});

test('write rejects source that breaks a file-count, per-file or total byte limit', () => {
  const many = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`file${String(index)}.tsx`, 'export default 1;']),
  );
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: many })),
    /at most 64 source files/,
  );
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: { 'main.tsx': 'x'.repeat(257 * 1024) } })),
    /under 256 KiB/,
  );
  const halfMebibyte = 'x'.repeat(512 * 1024);
  assert.match(
    rejection(
      writeFilesInputSchema,
      writeWith({ files: { 'a.tsx': halfMebibyte, 'b.tsx': halfMebibyte, 'c.tsx': 'x' } }),
    ),
    /under 1 MiB/,
  );
});

test('write rejects escaping, absolute, backslash and case-colliding paths', () => {
  for (const path of ['../x.tsx', '/abs.tsx', 'a\\b.tsx']) {
    assert.match(
      rejection(writeFilesInputSchema, writeWith({ files: { [path]: 'x' } })),
      /relative/,
    );
  }
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: { 'main.tsx': 'x', 'MAIN.tsx': 'y' } })),
    /ignoring case/,
  );
  // Two spellings of one folder address one directory on disk, so the write
  // has to be refused here rather than failing halfway through the revision.
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: { 'ui/A.tsx': 'x', 'UI/B.tsx': 'y' } })),
    /folders must be distinct/,
  );
  assert.match(
    rejection(
      writeFilesInputSchema,
      writeWith({ files: { 'main.tsx': 'x' }, deletedPaths: ['main.tsx'] }),
    ),
    /cannot also be written/,
  );
});

test('write rejects a path an object-keyed source tree would lose', () => {
  // Only a parsed payload can carry an own `__proto__` key; Zod's record drops
  // it, so without this rule an accepted write silently loses that file.
  const payload: unknown = JSON.parse(
    '{"mutationId":"write-hey","designId":"dsg_hey","expectedRevisionId":null,' +
      '"files":{"__proto__":"source"},"deletedPaths":[]}',
  );
  assert.match(rejection(writeFilesInputSchema, payload), /__proto__, constructor or prototype/);
});

test('write rejects paths the filesystem would merge by Unicode form or surrogate', () => {
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: { 'café.tsx': 'x', 'café.tsx': 'y' } })),
    /Unicode normalization/,
  );
  assert.match(
    rejection(
      writeFilesInputSchema,
      writeWith({ files: { 'café.tsx': 'x' }, deletedPaths: ['Café.tsx'] }),
    ),
    /cannot also be written/,
  );
  // Both lone surrogates encode to the same UTF-8 bytes, so both are refused.
  assert.match(
    rejection(
      writeFilesInputSchema,
      writeWith({ files: { '\ud800.tsx': 'x', '\ud801.tsx': 'y' } }),
    ),
    /relative/,
  );
  // U+0085 is a C1 control character: invisible, and legal in neither a path
  // nor a frame name.
  assert.match(
    rejection(writeFilesInputSchema, writeWith({ files: { 'a\u0085.tsx': 'x' } })),
    /relative/,
  );
});

function writeWith(patch: Partial<WriteFilesInput>): unknown {
  return { ...wire.write, deletedPaths: [], ...patch };
}

function rejection(schema: z.ZodTypeAny, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) assert.fail('The boundary accepted an input it must reject.');
  return result.error.issues.map((issue) => issue.message).join(' | ');
}
