import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';

import type * as Contract from '@droidex/protocol';
import type * as Schema from './schema.js';
import type * as FrameEdits from './frameEditSchema.js';
import type * as Annotations from './canvasAnnotationSchema.js';
import type * as Catalog from './kitCatalog.js';
import type * as Provenance from './designSystemProvenance.js';
import type * as DesignSystems from './designSystems.js';
import { isCanvasEvent } from '../../../src/features/canvas/wireValidation.js';
import {
  annotateCanvasInputSchema,
  type AnnotateCanvasInput,
  type Annotation,
} from './canvasAnnotationSchema.js';
import {
  arrangeFramesInputSchema,
  removeFramesInputSchema,
  renameFrameInputSchema,
  reorderFramesInputSchema,
  undoRemovalInputSchema,
} from './frameEditSchema.js';
import { editElementInputSchema, type EditElementInput } from './elementEditSchema.js';
import { createFramesInputSchema, writeFilesInputSchema } from './schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// JSON fixtures for the wire contract and the boundary parsers.
type WireFixtures = {
  create: Contract.CreateFramesInput;
  createCanvasResult: Contract.CreateCanvasResult;
  createResult: Contract.CreateFramesResult;
  write: Contract.WriteFilesInput;
  arrange: Contract.ArrangeFramesInput;
  remove: Contract.RemoveFramesInput;
  undo: Contract.UndoRemovalInput;
  rename: Contract.RenameFrameInput;
  annotate: AnnotateCanvasInput;
  annotation: Annotation;
  snapshot: Contract.CanvasSnapshot;
  change: Contract.CanvasChange;
  summary: Contract.CanvasSummary;
  receipt: Contract.WriteReceipt;
  turnContext: Contract.CanvasTurnContext;
  designRef: Contract.DesignRef;
  elementRef: Contract.ElementRef;
  element: Contract.SourceElement;
  edit: EditElementInput;
  revision: Contract.RevisionSummary;
  diff: Contract.RevisionDiff;
  page: Contract.RevisionPage;
  switch: Contract.SwitchRevisionInput;
  error: Contract.CanvasError;
  command: Contract.CanvasCommand;
  reply: Contract.CanvasReply;
  event: Contract.CanvasEvent;
};

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExactMirror = {
  create: Equals<Schema.CreateFramesInput, Contract.CreateFramesInput>;
  write: Equals<Schema.WriteFilesInput, Contract.WriteFilesInput>;
  arrange: Equals<FrameEdits.ArrangeFramesInput, Contract.ArrangeFramesInput>;
  remove: Equals<FrameEdits.RemoveFramesInput, Contract.RemoveFramesInput>;
  undo: Equals<FrameEdits.UndoRemovalInput, Contract.UndoRemovalInput>;
  rename: Equals<FrameEdits.RenameFrameInput, Contract.RenameFrameInput>;
  hidden: Equals<FrameEdits.SetFrameHiddenInput, Contract.SetFrameHiddenInput>;
  reorder: Equals<FrameEdits.ReorderFramesInput, Contract.ReorderFramesInput>;
  annotate: Equals<Annotations.AnnotateCanvasInput, Contract.AnnotateCanvasInput>;
  annotation: Equals<Annotations.Annotation, Contract.Annotation>;
  annotationDraft: Equals<Annotations.AnnotationDraft, Contract.AnnotationDraft>;
  annotationPoint: Equals<Annotations.AnnotationPoint, Contract.AnnotationPoint>;
  annotationAuthor: Equals<Annotations.AnnotationAuthor, Contract.AnnotationAuthor>;
  turnContext: Equals<Schema.CanvasTurnContext, Contract.CanvasTurnContext>;
  designRef: Equals<Schema.DesignRef, Contract.DesignRef>;
  elementRef: Equals<Schema.ElementRef, Contract.ElementRef>;
  element: Equals<z.infer<typeof Schema.sourceElementSchema>, Contract.SourceElement>;
  outline: Equals<z.infer<typeof Schema.sourceOutlineSchema>, Contract.SourceOutline>;
  edit: Equals<EditElementInput, Contract.EditElementInput>;
  page: Equals<Schema.RevisionPage, Contract.RevisionPage>;
  switch: Equals<Schema.SwitchRevisionInput, Contract.SwitchRevisionInput>;
  seed: Equals<z.infer<typeof Schema.canvasSeedSchema>, Contract.CanvasSeed>;
  designSystem: Equals<Schema.DesignSystemRef, Contract.DesignSystemRef>;
  designSystemVersion: Equals<Schema.DesignSystemVersionRef, Contract.DesignSystemVersionRef>;
  adherence: Equals<Schema.DesignSystemAdherence, Contract.DesignSystemAdherence>;
  revisionRef: Equals<Schema.RevisionRef, Contract.RevisionRef>;
  rect: Equals<Schema.FrameRect, Contract.FrameRect>;
  files: Equals<Schema.SourceFiles, Contract.SourceFiles>;
  catalogProp: Equals<Catalog.CatalogProp, Contract.CatalogProp>;
  propPick: Equals<Catalog.PropPick, Contract.PropPick>;
  librarySkip: Equals<Provenance.LibrarySkip, Contract.LibrarySkip>;
  provenance: Equals<Provenance.DesignSystemProvenance, Contract.DesignSystemProvenance>;
  savedBy: Equals<DesignSystems.SavedBy, Contract.SavedBy>;
  cover: Equals<DesignSystems.DesignSystemCover, Contract.DesignSystemCover>;
};

const designSystem: Contract.DesignSystemRef = { id: 'droidex', version: 3, mode: 'dark' };

const sketch: Annotation = {
  id: 'ann_sketch',
  kind: 'path',
  color: 'ink',
  points: [
    { x: 12.5, y: 40 },
    { x: 300, y: 44.2 },
  ],
  author: { kind: 'agent', chatId: 'app_session_01' },
  createdAt: 1_767_225_600_000,
  updatedAt: 1_767_225_600_500,
};

const hey = {
  designId: 'dsg_hey',
  name: 'Hey',
  rect: { x: 0, y: 0, width: 720, height: 720 },
  designSystem,
  variantOf: null,
  seededRevisionId: null,
  hidden: false,
};

const wire: WireFixtures = {
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
        ...hey,
        layoutVersion: 0,
        manifestVersion: 0,
        revisionId: null,
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
  annotate: {
    mutationId: 'annotate-hey',
    expectedAnnotationsVersion: 3,
    upserts: [
      {
        id: 'ann_arrow',
        kind: 'line',
        color: 'red',
        points: [
          { x: 0, y: 0 },
          { x: 120, y: 40 },
        ],
        arrowStart: false,
        arrowEnd: true,
      },
      {
        id: 'ann_note',
        kind: 'note',
        color: 'yellow',
        rect: { x: 760, y: -200, width: 220, height: 140 },
        text: 'Make the header\nlook like this',
      },
    ],
    deletes: ['ann_old'],
  },
  annotation: sketch,
  snapshot: {
    canvasId: 'cv_01',
    sequence: 7,
    annotationsVersion: 3,
    annotations: [sketch],
    frames: [
      {
        ...hey,
        layoutVersion: 2,
        manifestVersion: 2,
        revisionId: 'rev_02',
        build: {
          status: 'ready',
          revisionId: 'rev_02',
          artifactId: 'art_02',
          elements: [],
          outline: { nodes: [], truncated: false },
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
        variantOf: null,
        seededRevisionId: null,
        hidden: false,
        build: { status: 'pending', generation: 0 },
      },
    ],
  },
  change: {
    canvasId: 'cv_01',
    sequence: 8,
    frames: [{ ...hey, layoutVersion: 2, manifestVersion: 2, revisionId: 'rev_03' }],
    builds: [
      {
        designId: 'dsg_hey',
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
    line: 3,
    tagName: 'h1',
    component: 'Hero',
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
    version: 2,
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
  switch: {
    mutationId: 'switch-hey',
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

test('boundary schemas match the shared contract exactly, and the fixtures are plain JSON', () => {
  const exact: ExactMirror = {
    create: true,
    write: true,
    arrange: true,
    remove: true,
    undo: true,
    rename: true,
    hidden: true,
    reorder: true,
    annotate: true,
    annotation: true,
    annotationDraft: true,
    annotationPoint: true,
    annotationAuthor: true,
    turnContext: true,
    designRef: true,
    elementRef: true,
    element: true,
    outline: true,
    edit: true,
    page: true,
    switch: true,
    seed: true,
    designSystem: true,
    designSystemVersion: true,
    adherence: true,
    revisionRef: true,
    rect: true,
    files: true,
    catalogProp: true,
    propPick: true,
    librarySkip: true,
    provenance: true,
    savedBy: true,
    cover: true,
  };
  assert.ok(Object.values(exact).every((isExact) => isExact));
  assert.deepEqual(JSON.parse(JSON.stringify(wire)), wire);
});

test('every serialized event the sidecar emits passes the renderer validator', () => {
  const summaries = [wire.summary];
  const events: Contract.CanvasEvent[] = [
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
      reply: { kind: 'edited', receipt: wire.receipt, landed: '0123456789abcdef' },
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
      ok: true,
      reply: { kind: 'hiddenSet', change: wire.change },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: { kind: 'reordered', change: { ...wire.change, frames: [], order: ['dsg_hey'] } },
    },
    {
      type: 'canvas.result',
      requestId: 'req_01',
      ok: true,
      reply: {
        kind: 'annotated',
        change: {
          canvasId: 'cv_01',
          sequence: 9,
          frames: [],
          builds: [],
          removedDesignIds: [],
          annotations: { version: 4, upserted: [sketch], removedIds: ['ann_old'] },
        },
      },
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
    {
      type: 'canvas.captureRequest',
      captureId: '0b6b9f3e-7c1d-4f43-9a5e-2f1c8d4e6a70',
      canvasId: 'cv_01',
      designId: 'dsg_01',
      revisionId: 'rev_01',
      image: { format: 'png', scale: 3 },
    },
    {
      type: 'canvas.captureRequest',
      captureId: '0b6b9f3e-7c1d-4f43-9a5e-2f1c8d4e6a71',
      canvasId: 'cv_01',
      designId: 'dsg_01',
      revisionId: 'rev_01',
      image: { format: 'svg' },
    },
  ];
  // Types agreeing is not enough: the two runtime bounds have to agree too, or
  // a reply the sidecar accepts arrives as an event the renderer throws away.
  for (const event of events) {
    const serialized: unknown = JSON.parse(JSON.stringify(event));
    assert.ok(isRecord(serialized) && isCanvasEvent(serialized), `rejected ${event.type}`);
  }
  assert.equal(isCanvasEvent({ ...events.at(-1), image: { format: 'png', scale: 4 } }), false);
  const reordered = (order: string[]) => ({
    type: 'canvas.change',
    change: { ...wire.change, order },
  });
  assert.ok(isCanvasEvent(reordered(['dsg_a', 'dsg_b'])));
  assert.equal(isCanvasEvent(reordered(['dsg_a', 'dsg_a'])), false);
  // The renderer's half of the one correlation bound; canvasBridge.test.ts
  // holds the sidecar to the same length through the dispatch boundary.
  assert.ok(isCanvasEvent({ ...wire.event, requestId: 'r'.repeat(128) }));
  assert.equal(isCanvasEvent({ ...wire.event, requestId: 'r'.repeat(129) }), false);
});

test('the renderer accepts a ready element map and rejects incomplete or unbounded maps', () => {
  const node = { nodeId: '0123456789abcdef', parentId: null, kind: 'element', name: 'h1' };
  const flags = { lock: null, free: false, contentFromProps: false, visibility: 'shown' };
  const row = { ...node, ...flags, text: 'Hey', elementId: wire.element.elementId };
  const ready = {
    status: 'ready',
    revisionId: 'rev_02',
    artifactId: 'art_02',
    elements: [wire.element],
    outline: { nodes: [row], truncated: false },
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
  assert.equal(isCanvasEvent(event({ ...ready, outline: undefined })), false);
  const bad = { ...row, nodeId: 'not-hex' };
  assert.equal(
    isCanvasEvent(event({ ...ready, outline: { nodes: [bad], truncated: false } })),
    false,
  );
});

test('the renderer refuses history replies without a version counted from 1', () => {
  const event = (version: unknown) => ({
    type: 'canvas.result',
    requestId: 'req_01',
    ok: true,
    reply: { kind: 'revisions', revisions: [{ ...wire.revision, version }] },
  });
  assert.equal(isCanvasEvent(event(1)), true);
  for (const invalid of [undefined, 0, -1, 1.5, '2']) {
    assert.equal(isCanvasEvent(event(invalid)), false);
  }
});

test('the mutation fixtures parse, and the parsed values fit the shared contract', () => {
  const create: Contract.CreateFramesInput = createFramesInputSchema.parse(wire.create);
  const write: Contract.WriteFilesInput = writeFilesInputSchema.parse(wire.write);
  const arrange: Contract.ArrangeFramesInput = arrangeFramesInputSchema.parse(wire.arrange);
  const edit: Contract.EditElementInput = editElementInputSchema.parse(wire.edit);
  const remove: Contract.RemoveFramesInput = removeFramesInputSchema.parse(wire.remove);
  const undo: Contract.UndoRemovalInput = undoRemovalInputSchema.parse(wire.undo);
  const rename: Contract.RenameFrameInput = renameFrameInputSchema.parse(wire.rename);
  const annotate: Contract.AnnotateCanvasInput = annotateCanvasInputSchema.parse(wire.annotate);
  assert.deepEqual(create, wire.create);
  assert.deepEqual(write, wire.write);
  assert.deepEqual(arrange, wire.arrange);
  assert.deepEqual(edit, wire.edit);
  assert.deepEqual(remove, wire.remove);
  assert.deepEqual(undo, wire.undo);
  assert.deepEqual(rename, wire.rename);
  assert.deepEqual(annotate, wire.annotate);
});

test('a reorder names each frame once', () => {
  assert.match(
    rejection(reorderFramesInputSchema, { mutationId: 'reorder', designIds: ['dsg_a', 'dsg_a'] }),
    /each frame once/,
  );
});

test('annotate names each annotation once, changes at least one and refuses a stray control character', () => {
  assert.match(
    rejection(annotateCanvasInputSchema, { ...wire.annotate, deletes: ['ann_arrow'] }),
    /only once/,
  );
  assert.match(
    rejection(annotateCanvasInputSchema, { ...wire.annotate, upserts: [], deletes: [] }),
    /at least one annotation/,
  );
  assert.match(
    rejection(annotateCanvasInputSchema, {
      ...wire.annotate,
      upserts: [{ ...wire.annotate.upserts[1], text: 'Header\u0007bell' }],
    }),
    /without control characters/,
  );
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
  // A rename by case and Unicode form alone deletes one spelling and writes the other.
  const rename = writeWith({ files: { 'café.tsx': 'x' }, deletedPaths: ['Café.tsx'] });
  assert.equal(writeFilesInputSchema.safeParse(rename).success, true);
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

function writeWith(patch: Partial<Contract.WriteFilesInput>): unknown {
  return { ...wire.write, deletedPaths: [], ...patch };
}

function rejection(schema: z.ZodTypeAny, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) assert.fail('The boundary accepted an input it must reject.');
  return result.error.issues.map((issue) => issue.message).join(' | ');
}
