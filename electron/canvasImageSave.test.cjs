const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasImageSave } = require('./canvasImageSave.cjs');

function png() {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(720, 16);
  bytes.writeUInt32BE(720, 20);
  return bytes;
}

function boundary(choose) {
  const dialogs = [];
  const writes = [];
  const save = createCanvasImageSave({
    dialog: {
      showSaveDialog: async (_window, options) => {
        dialogs.push(options);
        return choose;
      },
    },
    writeFile: async (path, bytes) => writes.push({ path, bytes }),
    getWindow: () => ({}),
  });
  return { save, dialogs, writes };
}

test('PNG export writes only to the path chosen by the OS dialog', async () => {
  const selected = '/tmp/user-chosen-design.png';
  const { save, dialogs, writes } = boundary({ canceled: false, filePath: selected });
  const bytes = png();

  assert.deepEqual(await save({ suggestedName: '../Hey', bytes }), { ok: true });
  assert.equal(dialogs[0].defaultPath, '_Hey.png');
  assert.deepEqual(writes, [{ path: selected, bytes }]);
});

test('cancellation and invalid bytes never write an image', async () => {
  const { save, dialogs, writes } = boundary({ canceled: true });

  assert.equal((await save({ bytes: new Uint8Array([1, 2, 3]) })).code, 'capture_unavailable');
  assert.deepEqual(await save({ suggestedName: 'Hey', bytes: png() }), {
    ok: false,
    cancelled: true,
  });
  assert.equal(dialogs.length, 1);
  assert.equal(writes.length, 0);
});
