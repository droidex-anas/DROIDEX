// The intermediate's half of canvasPreviewSvg.cjs: a design's frame can post
// anything, so a shape answer reaches the board only as path data, a finite
// matrix and a box, and a select previews only the board's own path data.
// sidecar/src/canvas/pathData.test.ts holds the path data rule itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { canvasPreviewDocument } = require('./canvasPreview.cjs');

/** The intermediate's own script against a stand-in document, as canvasPreview.test.cjs runs it. */
function runIntermediate() {
  const document = canvasPreviewDocument();
  const script = document.slice(
    document.lastIndexOf('<script>') + 8,
    document.lastIndexOf('</script>'),
  );
  const posted = [];
  const contentWindow = { postMessage: (message) => posted.push(message) };
  let receive = null;
  const context = vm.createContext({
    document: { querySelector: () => ({ contentWindow }) },
    addEventListener: (type, listener) => {
      if (type === 'message') receive = listener;
    },
    TextEncoder,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  vm.runInContext(script, context);
  const preview = context.__droidexCanvasPreview;
  const nonce = 'a'.repeat(32);
  preview.start({ nonce, html: '', designId: 'dsg_01', revisionId: 'rev_01', generation: 1 });
  return {
    preview,
    posted,
    reply: (data) =>
      receive({ source: contentWindow, data: Object.assign({ canvasPreview: nonce }, data) }),
  };
}

test('a shape answer carries only source path data, a finite matrix and a box, or a known refusal', async () => {
  const { preview, posted, reply } = runIntermediate();
  const node = { elementId: 'el_1', instancePath: '0/0' };
  const answer = (shape) => {
    const asked = preview.shape(node);
    assert.equal(posted.at(-1).command, 'shape');
    reply({ event: 'shape', sequence: posted.at(-1).sequence, shape });
    return asked.then(JSON.parse);
  };
  const rect = { x: 8, y: 8, width: 20, height: 20 };
  const drawn = { d: 'M0 0\n  L10,10 Z', matrix: [2, 0, 0, 2, 8, 8], rect };
  assert.deepEqual(await answer({ ...drawn, style: 'x' }), drawn);
  // Every newline doubles under JSON, past the 4096 bytes other events may measure.
  const wrapped = { ...drawn, d: 'M0 0' + '\n'.repeat(16 * 1024 - 4) };
  assert.deepEqual(await answer(wrapped), wrapped);
  assert.deepEqual(await answer({ refused: 'not_drawn', d: 'x' }), { refused: 'not_drawn' });
  // The source's own data, when it is not path data, is a refusal the board can name.
  for (const d of ['M', 'Ee', 'M0 0L', 'M0 0L1e39 1', 'M0 0 url(#x)'])
    assert.deepEqual(await answer({ ...drawn, d }), { refused: 'unreadable' }, d);
  for (const shape of [
    { refused: 'anything' },
    { ...drawn, d: 'M0 0' + ' '.repeat(16 * 1024 - 3) },
    { ...drawn, matrix: [2, 0, 0, 2, 8] },
    { ...drawn, matrix: [2, 0, 0, 2, 8, null] },
    { ...drawn, rect: null },
  ])
    assert.equal(await answer(shape), null, JSON.stringify(shape).slice(0, 60));
  assert.equal(preview.shape({ elementId: 'el_1', instancePath: '0/../1' }), 'invalid_request');
});

test("a select previews a path's d only as path data with spaces and commas", () => {
  const { preview, posted } = runIntermediate();
  const target = { elementId: 'el_1', instancePath: '0/0', styles: {}, text: null };
  const select = (d, sequence) =>
    preview.select({ target: { ...target, d }, properties: [], sequence });

  for (const d of [
    'M0 0\nL1 1',
    'M0 0 url(#x)',
    'M0 0L',
    'Ee',
    'M' + '0'.repeat(16 * 1024),
    42,
    null,
  ])
    assert.equal(select(d, 1), 'invalid_request', String(d).slice(0, 20));
  assert.deepEqual(posted, []);
  select('M0 0 L1,1 Z', 2);
  select(undefined, 3);
  assert.deepEqual(
    posted.map(({ target }) => target.d),
    ['M0 0 L1,1 Z', null],
  );
});
