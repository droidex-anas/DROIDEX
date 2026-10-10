const assert = require('node:assert/strict');
const test = require('node:test');
const { createCanvasSourceExport, createDesignSystemExport } = require('./canvasSourceExport.cjs');

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

test('a design system export names only a kit version, and posts to its own route', async () => {
  let chooserCalls = 0;
  const posted = [];
  const exportKit = createDesignSystemExport({
    chooseDirectory: async () => {
      chooserCalls += 1;
      return { canceled: false, filePaths: ['/tmp/kit'] };
    },
    getBridgeInfo: async () => ({ port: 1234 }),
    exportToken: () => 'host-token',
    fetchRequest: async (url, init) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ filesWritten: 7 }));
    },
  });

  for (const input of [
    null,
    { ref: { id: 'droidex' } },
    { ref: { id: '../escape', version: 1 } },
    { ref: { id: 'droidex', version: 1 }, destinationDirectory: '/elsewhere' },
  ]) {
    assert.deepEqual(await exportKit(input), {
      ok: false,
      code: 'invalid_input',
      message: 'Choose a design system to export.',
    });
  }
  assert.equal(chooserCalls, 0);
  assert.deepEqual(await exportKit({ ref: { id: 'droidex', version: 1 } }), {
    ok: true,
    filesWritten: 7,
  });
  assert.deepEqual(posted, [
    {
      url: 'http://127.0.0.1:1234/canvas/design-system-export',
      body: { ref: { id: 'droidex', version: 1 }, destinationDirectory: '/tmp/kit' },
    },
  ]);
});

test('a design system export answers a sidecar refusal as a result, with its own message', async () => {
  const exportKit = createDesignSystemExport({
    chooseDirectory: async () => ({ canceled: false, filePaths: ['/tmp/kit'] }),
    getBridgeInfo: async () => ({ port: 1234 }),
    exportToken: () => 'host-token',
    fetchRequest: async () =>
      new Response(
        JSON.stringify({ code: 'invalid_input', message: 'The chosen folder is not empty.' }),
        { status: 400 },
      ),
  });
  assert.deepEqual(await exportKit({ ref: { id: 'droidex', version: 1 } }), {
    ok: false,
    code: 'invalid_input',
    message: 'The chosen folder is not empty.',
  });
});
