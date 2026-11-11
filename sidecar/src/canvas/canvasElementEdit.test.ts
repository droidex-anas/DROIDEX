// `canvas.editElement` through the pane's dispatch boundary: what a direct edit
// commits, which targets it refuses, and how a retry answers from the original
// receipt. The frame is built by the real compiler, because an element map is
// what makes a target selectable at all.

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { isCanvasEvent } from '../../../src/features/canvas/wireValidation.js';
import { instrumentSource } from './sourceElements.js';
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

  await edit('req-bad-token', {
    kind: 'style',
    styles: [{ property: 'color', value: '--not-a-kit-token' }],
  });
  assert.equal(errorOf(canvas, 'req-bad-token').code, 'invalid_edit');
  await edit('req-token-kind', { kind: 'token', property: 'color', token: '--ds-accent' });
  assert.equal(errorOf(canvas, 'req-token-kind').code, 'invalid_input');
  await edit('req-repeated', {
    kind: 'style',
    styles: [
      { property: 'color', value: '--ds-accent' },
      { property: 'color', value: '--ds-fg' },
    ],
  });
  assert.equal(errorOf(canvas, 'req-repeated').code, 'invalid_input');
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

  await edit('req-edit-valid', {
    kind: 'style',
    styles: [{ property: 'color', value: '--ds-accent' }],
  });
  const changed = okReply(canvas, 'req-edit-valid');
  assert.ok(changed.kind === 'edited');
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

test('a layer moves in one revision and answers the row it landed on; its retry answers without one', async (t) => {
  const main = 'export default function Hey(){return <main><h1>Hey</h1><p>Hi</p></main>}';
  const { canvas, canvasId, element } = await editableElement(t, { 'main.tsx': main });
  const build = canvas.builds.stateOf(canvasId, element.designId);
  assert.ok(build.status === 'ready');
  const row = (name: string) => build.outline.nodes.find((node) => node.name === name)?.nodeId;
  const { designId, revisionId } = element;
  const command = {
    type: 'canvas.editElement',
    requestId: 'req-move',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-move',
      edit: {
        layer: { designId, revisionId, nodeId: row('p') },
        change: { kind: 'move', parentId: row('main'), beforeId: row('h1') },
      },
    },
  };
  await canvas.handle(command);
  const moved = okReply(canvas, 'req-move');
  assert.ok(moved.kind === 'edited');
  const files = await canvas.workspace.readFiles(canvasId, moved.receipt);
  assert.equal(
    files['main.tsx'],
    'export default function Hey(){return <main><p>Hi</p><h1>Hey</h1></main>}',
  );
  const landed = instrumentSource({ ...files }, moved.receipt.revisionId).outline.nodes.find(
    (node) => node.nodeId === moved.landed,
  );
  assert.equal(landed?.text, 'Hi');

  await canvas.handle({ ...command, requestId: 'req-move-retry' });
  assert.deepEqual(okReply(canvas, 'req-move-retry'), { ...moved, landed: null });
});

test('a layer is duplicated through the same edit, answering the copy', async (t) => {
  const main = 'export default function Hey(){return <main><h1>Hey</h1><p>Hi</p></main>}';
  const { canvas, canvasId, element } = await editableElement(t, { 'main.tsx': main });
  const build = canvas.builds.stateOf(canvasId, element.designId);
  assert.ok(build.status === 'ready');
  const nodeId = build.outline.nodes.find((node) => node.name === 'p')?.nodeId;
  const { designId, revisionId } = element;
  await canvas.handle({
    type: 'canvas.editElement',
    requestId: 'req-copy',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-copy',
      edit: { layer: { designId, revisionId, nodeId }, change: { kind: 'duplicate' } },
    },
  });
  const copied = okReply(canvas, 'req-copy');
  assert.ok(copied.kind === 'edited');
  const files = await canvas.workspace.readFiles(canvasId, copied.receipt);
  assert.equal(
    files['main.tsx'],
    'export default function Hey(){return <main><h1>Hey</h1><p>Hi</p><p>Hi</p></main>}',
  );
  const copies = instrumentSource({ ...files }, copied.receipt.revisionId).outline.nodes.filter(
    (node) => node.name === 'p',
  );
  assert.equal(copied.landed, copies[1].nodeId);
});

/** Asks to move `subject` last into `target` and answers the refusal, checking the source stayed. */
async function refusedMove(t: TestContext, main: string, subject: string, target: string) {
  const { canvas, canvasId, element } = await editableElement(t, { 'main.tsx': main });
  const build = canvas.builds.stateOf(canvasId, element.designId);
  assert.ok(build.status === 'ready');
  const row = (name: string) => build.outline.nodes.find((node) => node.name === name)?.nodeId;
  const { designId, revisionId } = element;
  await canvas.handle({
    type: 'canvas.editElement',
    requestId: 'req-refused-move',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-refused-move',
      edit: {
        layer: { designId, revisionId, nodeId: row(subject) },
        change: { kind: 'move', parentId: row(target), beforeId: null },
      },
    },
  });
  assert.equal((await canvas.workspace.readFiles(canvasId, element))['main.tsx'], main);
  assert.equal(canvas.workspace.snapshot(canvasId).frames[0]?.revisionId, revisionId);
  return errorOf(canvas, 'req-refused-move');
}

test('a move to before the line that sets a value the layer reads is refused', async (t) => {
  const main = `export default function App({ flag = true }) {
  if (flag) return <section />;
  const label = 'Scoped';
  return <main><span>{label}</span></main>;
}`;
  const { code, message } = await refusedMove(t, main, 'span', 'section');
  assert.equal(code, 'ambiguous_element');
  assert.equal(
    message,
    'This layer uses a value the code sets further down, so it can’t go there. Ask the agent to move it.',
  );
});

test('a move past a line that assigns a value the layer reads is refused', async (t) => {
  const main = `export default function App({ flag = true }) {
  let label = 'Early';
  if (flag) return <section />;
  label = 'Late';
  return <main><span>{label}</span></main>;
}`;
  const { code, message } = await refusedMove(t, main, 'span', 'section');
  assert.equal(code, 'ambiguous_element');
  assert.equal(
    message,
    'This layer uses a value the code sets further down, so it can’t go there. Ask the agent to move it.',
  );
});

test('a move past a write into a property or index of a value the layer reads is refused', async (t) => {
  const main = `export default function App({ flag = true }) {
  const config = { color: 'red', sizes: [1] };
  if (flag) return <section />;
  config.color = 'blue';
  config.sizes[0]++;
  return <main><span>{config.color}</span></main>;
}`;
  const { code, message } = await refusedMove(t, main, 'span', 'section');
  assert.equal(code, 'ambiguous_element');
  assert.equal(
    message,
    'This layer uses a value the code sets further down, so it can’t go there. Ask the agent to move it.',
  );
});

test('a move to before the enum a layer reads is refused', async (t) => {
  const main = `export default function App({ flag = true }) {
  if (flag) return <section />;
  enum Size { Large = 'Large' }
  return <main><span>{Size.Large}</span></main>;
}`;
  const { code } = await refusedMove(t, main, 'span', 'section');
  assert.equal(code, 'ambiguous_element');
});

test('a move into an element with a spread, which may set its content, is refused', async (t) => {
  const main =
    "export default () => <main><section {...{dangerouslySetInnerHTML:{__html:'Existing'}}} /><i>A</i></main>;";
  const { code, message } = await refusedMove(t, main, 'i', 'section');
  assert.equal(code, 'invalid_edit');
  assert.equal(message, "This layer's props may set its content, so it can't hold other layers.");
});

test('a style edit sets every style it names in one revision, and its retry answers from the ledger', async (t) => {
  const { canvas, canvasId, element } = await editableElement(t);
  const command = (requestId: string, mutationId: string, padding: string) => ({
    type: 'canvas.editElement',
    requestId,
    appSessionId: APP,
    canvasId,
    input: {
      mutationId,
      edit: {
        element,
        change: {
          kind: 'style',
          styles: [
            { property: 'padding', value: padding },
            { property: 'flexDirection', value: 'column' },
            { property: 'width', value: '321px' },
          ],
        },
      },
    },
  });
  const before = canvas.workspace.snapshot(canvasId).sequence;

  await canvas.handle(command('req-style', 'm-style', '0.5rem'));
  const first = okReply(canvas, 'req-style');
  assert.ok(first.kind === 'edited');
  assert.equal(first.receipt.sequence, before + 1);
  assert.ok(
    isCanvasEvent({ type: 'canvas.result', requestId: 'req-style', ok: true, reply: first }),
  );
  // The kit token and the keyword are classes; a width no class says stays inline.
  assert.equal(
    (await canvas.workspace.readFiles(canvasId, first.receipt))['main.tsx'],
    'export default function Hey(){return <h1 className="p-[var(--ds-space-2)] flex-col" style={{color:"var(--ds-fg)", width: 321}}>Hey</h1>}',
  );

  // The edit moved the revision on, so only the ledger can answer this retry.
  await canvas.handle(command('req-style-retry', 'm-style', '0.5rem'));
  assert.deepEqual(okReply(canvas, 'req-style-retry'), first);
  await canvas.handle(command('req-style-stale', 'm-style-raw', '13px'));
  assert.equal(errorOf(canvas, 'req-style-stale').code, 'stale_revision');
});

test('an element of a component rendered once is edited in the file it is written in', async (t) => {
  const main =
    "import { TopBar } from './components/TopBar'; export default function App(){return <TopBar />}";
  const topBar =
    'export function TopBar(){return <header style={{color:"var(--ds-fg)"}}>Inbox</header>}';
  const { canvas, canvasId, element } = await editableElement(t, {
    'main.tsx': main,
    'components/TopBar.tsx': topBar,
  });
  await canvas.handle({
    type: 'canvas.editElement',
    requestId: 'req-top-bar',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-top-bar',
      edit: {
        element,
        change: { kind: 'style', styles: [{ property: 'color', value: '--ds-accent' }] },
      },
    },
  });
  const changed = okReply(canvas, 'req-top-bar');
  assert.ok(changed.kind === 'edited');
  assert.deepEqual(
    { ...(await canvas.workspace.readFiles(canvasId, changed.receipt)) },
    {
      'main.tsx': main,
      'components/TopBar.tsx':
        'export function TopBar(){return <header className="text-[color:var(--ds-accent)]">Inbox</header>}',
    },
  );
});
