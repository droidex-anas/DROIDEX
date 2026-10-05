import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';

import type * as Renderer from '../../../src/features/canvas/protocol.js';
import type {
  ArrangeFramesInput,
  CanvasChange,
  CanvasError,
  CanvasSnapshot,
  CanvasSummary,
  CreateFramesInput,
  DesignRef,
  DesignSystemRef,
  ElementRef,
  SourceElement,
  WriteFilesInput,
  WriteReceipt,
} from './protocol.js';
import {
  arrangeFramesInputSchema,
  createFramesInputSchema,
  writeFilesInputSchema,
} from './schema.js';

// Every DTO the renderer mirrors, gathered so the mirror test can check both
// directions of assignability in one place.
type SidecarWire = {
  create: CreateFramesInput;
  write: WriteFilesInput;
  arrange: ArrangeFramesInput;
  snapshot: CanvasSnapshot;
  change: CanvasChange;
  summary: CanvasSummary;
  receipt: WriteReceipt;
  designRef: DesignRef;
  elementRef: ElementRef;
  element: SourceElement;
  error: CanvasError;
};

type RendererWire = {
  create: Renderer.CreateFramesInput;
  write: Renderer.WriteFilesInput;
  arrange: Renderer.ArrangeFramesInput;
  snapshot: Renderer.CanvasSnapshot;
  change: Renderer.CanvasChange;
  summary: Renderer.CanvasSummary;
  receipt: Renderer.WriteReceipt;
  designRef: Renderer.DesignRef;
  elementRef: Renderer.ElementRef;
  element: Renderer.SourceElement;
  error: Renderer.CanvasError;
};

const designSystem: DesignSystemRef = { id: 'droidex', version: 3, mode: 'dark' };

const wire: SidecarWire = {
  create: {
    mutationId: 'create-hey',
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
  snapshot: {
    canvasId: 'cv_01',
    sequence: 7,
    frames: [
      {
        designId: 'dsg_hey',
        name: 'Hey',
        rect: { x: 0, y: 0, width: 720, height: 720 },
        layoutVersion: 2,
        revisionId: 'rev_02',
        designSystem,
        build: { status: 'ready', revisionId: 'rev_02', artifactId: 'art_02' },
      },
      {
        designId: 'dsg_reserved',
        name: 'Cards',
        rect: { x: 760, y: 0, width: 720, height: 720 },
        layoutVersion: 1,
        revisionId: null,
        designSystem,
        build: { status: 'pending' },
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
        revisionId: 'rev_03',
        designSystem,
        build: {
          status: 'failed',
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
  summary: { canvasId: 'cv_01', name: 'Components', updatedAt: 1_767_225_600_000, designCount: 2 },
  receipt: { designId: 'dsg_hey', revisionId: 'rev_03', sequence: 8 },
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
  error: { code: 'revision_conflict', message: 'Reload the design and reapply your change.' },
};

test('every mirrored DTO survives JSON and stays assignable in both directions', () => {
  const mirrored: RendererWire = wire;
  const roundTripped: SidecarWire = mirrored;
  assert.deepEqual(JSON.parse(JSON.stringify(roundTripped)), wire);
});

test('the create, write and arrange fixtures parse, and the parsed value fits the mirror', () => {
  const create: Renderer.CreateFramesInput = createFramesInputSchema.parse(wire.create);
  const write: Renderer.WriteFilesInput = writeFilesInputSchema.parse(wire.write);
  const arrange: Renderer.ArrangeFramesInput = arrangeFramesInputSchema.parse(wire.arrange);
  assert.deepEqual(create, wire.create);
  assert.deepEqual(write, wire.write);
  assert.deepEqual(arrange, wire.arrange);
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
  assert.match(
    rejection(
      writeFilesInputSchema,
      writeWith({ files: { 'main.tsx': 'x' }, deletedPaths: ['main.tsx'] }),
    ),
    /cannot also be written/,
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
