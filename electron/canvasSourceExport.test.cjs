const assert = require('node:assert/strict');
const test = require('node:test');
const { createCanvasSourceExport } = require('./canvasSourceExport.cjs');

const validRequest = {
  canvasId: 'canvas_1',
  ref: { designId: 'design_1', revisionId: 'revision_1' },
};

test('rejects malformed Canvas source export requests before opening the chooser', async () => {
  let chooserCalls = 0;
  const exportSource = createCanvasSourceExport({
    chooseDirectory: async () => {
      chooserCalls += 1;
      return { canceled: false, filePaths: ['/tmp/export'] };
    },
    getBridgeInfo: async () => ({ port: 1234 }),
    exportToken: () => 'host-token',
    fetchRequest: async () => new Response(JSON.stringify({ filesWritten: 1 })),
  });

  for (const input of [
    null,
    { ...validRequest, canvasId: 123 },
    { ...validRequest, canvasId: '../escape' },
    { ...validRequest, ref: { ...validRequest.ref, revisionId: '' } },
    { ...validRequest, extra: true },
  ]) {
    await assert.rejects(exportSource(input), /Choose a Canvas revision to export/);
  }
  assert.equal(chooserCalls, 0);
  assert.deepEqual(await exportSource(validRequest), { filesWritten: 1 });
  assert.equal(chooserCalls, 1);
});

test('rejects malformed sidecar replies before forwarding the export result', async () => {
  let response = new Response(JSON.stringify({ filesWritten: 'many' }), { status: 200 });
  const exportSource = createCanvasSourceExport({
    chooseDirectory: async () => ({ canceled: false, filePaths: ['/tmp/export'] }),
    getBridgeInfo: async () => ({ port: 1234 }),
    exportToken: () => 'host-token',
    fetchRequest: async () => response,
  });

  await assert.rejects(exportSource(validRequest), /invalid result/);
  response = new Response(JSON.stringify({ code: 'storage_failed', message: { private: true } }), {
    status: 400,
  });
  await assert.rejects(exportSource(validRequest), /Canvas source could not be exported/);
});
