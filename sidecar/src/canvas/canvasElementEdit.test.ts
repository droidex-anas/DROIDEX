// `canvas.editElement` through the pane's dispatch boundary: what a direct edit
// commits, which targets it refuses, and how a retry answers from the original
// receipt. The frame is built by the real compiler, because an element map is
// what makes a target selectable at all.

import assert from 'node:assert/strict';
import test from 'node:test';
import { isCanvasEvent } from '../../../src/features/canvas/wireValidation.js';
import {
  APP,
  canvasCommandHandler,
  EDITABLE,
  editableElement,
  errorOf,
  okReply,
  PAGE,
} from '../testing/canvasBridgeSupport.js';

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

  await edit('req-bad-token', { kind: 'colour', property: 'color', value: '--not-a-kit-token' });
  assert.equal(errorOf(canvas, 'req-bad-token').code, 'invalid_edit');
  await edit('req-token-kind', { kind: 'token', property: 'color', token: '--ds-accent' });
  assert.equal(errorOf(canvas, 'req-token-kind').code, 'invalid_input');
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

  await edit('req-edit-valid', { kind: 'colour', property: 'color', value: '--ds-accent' });
  const changed = okReply(canvas, 'req-edit-valid');
  assert.ok(changed.kind === 'edited');
  assert.deepEqual(changed.resolution, { kind: 'token', token: '--ds-accent' });
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
  assert.ok(first.kind === 'edited');
  assert.equal(first.resolution, null);

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

test('a style edit answers what it resolved to, and its retry answers the same from the ledger', async (t) => {
  const { canvas, canvasId, element } = await editableElement(t);
  const command = (requestId: string, mutationId: string, value: string) => ({
    type: 'canvas.editElement',
    requestId,
    appSessionId: APP,
    canvasId,
    input: {
      mutationId,
      edit: { element, change: { kind: 'spacing', property: 'padding', value } },
    },
  });

  await canvas.handle(command('req-style', 'm-style', '0.5rem'));
  const first = okReply(canvas, 'req-style');
  assert.ok(first.kind === 'edited');
  assert.deepEqual(first.resolution, { kind: 'token', token: '--ds-space-2' });
  assert.ok(
    isCanvasEvent({ type: 'canvas.result', requestId: 'req-style', ok: true, reply: first }),
  );
  assert.match(
    (await canvas.workspace.readFiles(canvasId, first.receipt))['main.tsx'] ?? '',
    /padding: "var\(--ds-space-2\)"/,
  );

  // The edit moved the revision on, so only the ledger can answer this retry.
  await canvas.handle(command('req-style-retry', 'm-style', '0.5rem'));
  assert.deepEqual(okReply(canvas, 'req-style-retry'), first);
  await canvas.handle(command('req-style-stale', 'm-style-raw', '13px'));
  assert.equal(errorOf(canvas, 'req-style-stale').code, 'stale_revision');
});

test('a style value the kit has no token for is written and answered raw', async (t) => {
  const { canvas, canvasId, element } = await editableElement(t);
  await canvas.handle({
    type: 'canvas.editElement',
    requestId: 'req-raw',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-raw',
      edit: { element, change: { kind: 'layout', property: 'flexDirection', value: 'column' } },
    },
  });
  const reply = okReply(canvas, 'req-raw');
  assert.ok(reply.kind === 'edited');
  assert.deepEqual(reply.resolution, { kind: 'raw', value: 'column' });
  assert.ok(isCanvasEvent({ type: 'canvas.result', requestId: 'req-raw', ok: true, reply }));
  assert.match(
    (await canvas.workspace.readFiles(canvasId, reply.receipt))['main.tsx'] ?? '',
    /style=\{\{color:"var\(--ds-fg\)", flexDirection: "column"\}\}/,
  );
});
