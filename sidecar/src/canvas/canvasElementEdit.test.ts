// `canvas.editElement` through the pane's dispatch boundary: what a direct edit
// commits, which targets it refuses, and how a retry answers from the original
// receipt. The frame is built by the real compiler, because an element map is
// what makes a target selectable at all.

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  canvasCommandHandler,
  errorOf,
  frameHarness,
  okReply,
  TEST_APP_SESSION as APP,
  TEST_PAGE as PAGE,
  type Harness,
  writeInput,
} from '../testing/canvasStorageSupport.js';
import { CanvasBuilds } from './CanvasBuilds.js';
import type { ElementRef } from './protocol.js';

const EDITABLE =
  'export default function Hey(){return <h1 style={{color:"var(--ds-fg)"}}>Hey</h1>}';

async function editableElement(
  t: TestContext,
): Promise<{ canvas: Harness; canvasId: string; element: ElementRef }> {
  const builds = new CanvasBuilds();
  t.after(() => builds.close());
  const { canvas, canvasId, designId } = await frameHarness(t, { builds });
  const ready = new Promise<void>((resolve, reject) => {
    const unsubscribe = canvas.workspace.changes.subscribe((change) => {
      const build = change.frames.find((frame) => frame.designId === designId)?.build;
      if (!build || build.status === 'pending' || build.status === 'building') return;
      unsubscribe();
      if (build.status === 'ready') resolve();
      else reject(new Error(`initial build ended as ${build.status}`));
    });
  });
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-edit-source',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-edit-source', designId, null, { 'main.tsx': EDITABLE }),
  });
  const written = okReply(canvas, 'req-edit-source');
  assert.ok(written.kind === 'written');
  await ready;
  const build = builds.stateOf(canvasId, designId);
  assert.ok(build.status === 'ready');
  const [site] = build.elements;
  assert.ok(site);
  const element: ElementRef = {
    designId,
    revisionId: written.receipt.revisionId,
    elementId: site.elementId,
    instancePath: '0',
  };
  return { canvas, canvasId, element };
}

test('a direct element edit commits a new revision and rejects untrusted targets', async (t) => {
  const { canvas, canvasId, element } = await editableElement(t);
  const edit = async (requestId: string, change: object, selected = element) => {
    await canvas.handle({
      type: 'canvas.editElement',
      requestId,
      appSessionId: APP,
      canvasId,
      input: { mutationId: requestId, edit: { element: selected, change } },
    });
  };

  await edit('req-bad-token', { kind: 'token', property: 'color', token: '--not-a-kit-token' });
  assert.equal(errorOf(canvas, 'req-bad-token').code, 'invalid_edit');
  await edit('req-image', { kind: 'image', assetId: 'not_owned' });
  assert.equal(errorOf(canvas, 'req-image').code, 'unsupported_edit');
  await edit(
    'req-unknown',
    { kind: 'text', value: 'Changed' },
    { ...element, elementId: 'unknown' },
  );
  assert.equal(errorOf(canvas, 'req-unknown').code, 'stale_reference');
  await edit(
    'req-malformed',
    { kind: 'text', value: 'Changed' },
    { ...element, elementId: '../bad' },
  );
  assert.equal(errorOf(canvas, 'req-malformed').code, 'invalid_input');
  assert.equal((await canvas.workspace.readFiles(canvasId, element))['main.tsx'], EDITABLE);

  await edit('req-edit-valid', { kind: 'token', property: 'color', token: '--ds-accent' });
  const changed = okReply(canvas, 'req-edit-valid');
  assert.ok(changed.kind === 'written');
  assert.notEqual(changed.receipt.revisionId, element.revisionId);
  assert.match(
    (await canvas.workspace.readFiles(canvasId, changed.receipt))['main.tsx'] ?? '',
    /var\(--ds-accent\)/,
  );
  await edit('req-old-revision', { kind: 'text', value: 'Again' });
  assert.equal(errorOf(canvas, 'req-old-revision').code, 'stale_revision');
});

test('a retried element edit returns its original receipt through a new handler', async (t) => {
  const { canvas, canvasId, element } = await editableElement(t);

  const command = {
    type: 'canvas.editElement',
    requestId: 'req-edit-first',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-edit-retry',
      edit: { element, change: { kind: 'text', value: 'Welcome' } },
    },
  };
  await canvas.handle(command);
  const first = okReply(canvas, 'req-edit-first');
  assert.ok(first.kind === 'written');

  const { handle: replay } = canvasCommandHandler({
    ready: Promise.resolve(canvas.workspace),
    scopes: canvas.scopes,
    builds: canvas.builds,
    events: canvas.events,
    root: canvas.root,
  });
  await replay({ ...command, requestId: 'req-edit-retry' }, PAGE);
  const retried = okReply(canvas, 'req-edit-retry');
  assert.deepEqual(retried, first);
  await replay(
    {
      ...command,
      requestId: 'req-edit-reused',
      input: {
        ...command.input,
        edit: { ...command.input.edit, change: { kind: 'text', value: 'Other' } },
      },
    },
    PAGE,
  );
  assert.equal(errorOf(canvas, 'req-edit-reused').code, 'invalid_input');
  assert.equal(canvas.workspace.snapshot(canvasId).sequence, first.receipt.sequence);
});
