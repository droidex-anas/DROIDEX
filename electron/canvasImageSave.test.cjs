const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCanvasImageSave } = require('./canvasImageSave.cjs');

const imageRef = { canvasId: 'cv_01', designId: 'dsg_01', revisionId: 'rev_01' };
const capturedPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

async function boundary(t, { fs = fsp, choose } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'canvas-image-save-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const selected = path.join(directory, 'design.png');
  const dialogs = [];
  const reads = [];
  const save = createCanvasImageSave({
    dialog: {
      showSaveDialog: async (_window, options) => {
        dialogs.push(options);
        return choose ?? { canceled: false, filePath: selected };
      },
    },
    fs,
    readThumbnail: (canvasId, designId, revisionId) => {
      reads.push([canvasId, designId, revisionId]);
      return canvasId === imageRef.canvasId &&
        designId === imageRef.designId &&
        revisionId === imageRef.revisionId
        ? capturedPng
        : null;
    },
    getWindow: () => ({}),
  });
  return { save, dialogs, reads, directory, selected };
}

test('PNG export writes only to the path chosen by the OS dialog', async (t) => {
  const operations = [];
  let stagingPath;
  const fs = {
    ...fsp,
    open: async (filePath, flags, mode) => {
      assert.equal(flags, 'wx');
      assert.equal(mode, 0o600);
      stagingPath = filePath;
      const file = await fsp.open(filePath, flags, mode);
      return {
        writeFile: async (bytes) => {
          await file.writeFile(bytes);
          operations.push('write');
        },
        sync: async () => {
          await file.sync();
          operations.push('sync');
        },
        close: async () => {
          await file.close();
          operations.push('close');
        },
      };
    },
    rename: async (source, destination) => {
      assert.deepEqual(operations, ['write', 'sync', 'close']);
      assert.deepEqual(await fsp.readFile(source), capturedPng);
      assert.equal(await fsp.readFile(destination, 'utf8'), 'existing image');
      await fsp.rename(source, destination);
    },
  };
  const { save, dialogs, reads, directory, selected } = await boundary(t, { fs });
  await fsp.writeFile(selected, 'existing image');

  assert.deepEqual(
    await save({ ...imageRef, suggestedName: '../Hey', bytes: new Uint8Array([1, 2, 3]) }),
    { ok: true },
  );
  assert.equal(dialogs[0].defaultPath, '_Hey.png');
  assert.deepEqual(reads, [['cv_01', 'dsg_01', 'rev_01']]);
  assert.equal(path.dirname(stagingPath), directory);
  assert.notEqual(stagingPath, selected);
  assert.deepEqual(await fsp.readFile(selected), capturedPng);
  assert.deepEqual(await fsp.readdir(directory), ['design.png']);
});

test('cancellation and uncached revisions never write an image', async (t) => {
  const { save, dialogs, directory } = await boundary(t, { choose: { canceled: true } });

  assert.equal(
    (await save({ ...imageRef, revisionId: 'rev_02', bytes: capturedPng })).code,
    'capture_unavailable',
  );
  assert.deepEqual(await save({ ...imageRef, suggestedName: 'Hey' }), {
    ok: false,
    cancelled: true,
  });
  assert.equal(dialogs.length, 1);
  assert.deepEqual(await fsp.readdir(directory), []);
});

test('a failed image write preserves the existing destination and removes its temporary file', async (t) => {
  let closed = false;
  const { save, directory, selected } = await boundary(t, {
    fs: {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        return {
          writeFile: async (image) => {
            await handle.writeFile(image.subarray(0, 12));
            throw new Error('Partial write');
          },
          sync: () => handle.sync(),
          close: async () => {
            await handle.close();
            closed = true;
          },
        };
      },
    },
  });
  const original = Buffer.from('existing image');
  await fsp.writeFile(selected, original);

  const result = await save({ ...imageRef, suggestedName: 'design' });
  assert.equal(result.code, 'storage_failed');
  assert.equal(closed, true);
  assert.deepEqual(await fsp.readFile(selected), original);
  assert.deepEqual(await fsp.readdir(directory), ['design.png']);
});

test('renderer-supplied PNG bytes never authorize an image save', async (t) => {
  const { save, dialogs, directory } = await boundary(t);

  assert.equal(
    (await save({ suggestedName: 'design', bytes: capturedPng })).code,
    'capture_unavailable',
  );
  assert.equal(dialogs.length, 0);
  assert.deepEqual(await fsp.readdir(directory), []);
});

for (const stage of ['sync', 'close', 'rename']) {
  test(`a failed ${stage} preserves the destination and removes the owned temporary file`, async (t) => {
    let closed = false;
    const { save, directory, selected } = await boundary(t, {
      fs: {
        ...fsp,
        open: async (...args) => {
          const file = await fsp.open(...args);
          return {
            writeFile: (bytes) => file.writeFile(bytes),
            sync: async () => {
              if (stage === 'sync') throw new Error('Sync failed');
              await file.sync();
            },
            close: async () => {
              await file.close();
              closed = true;
              if (stage === 'close') throw new Error('Close failed');
            },
          };
        },
        rename: async (...args) => {
          if (stage === 'rename') throw new Error('Rename failed');
          await fsp.rename(...args);
        },
      },
    });
    await fsp.writeFile(selected, 'existing image');

    assert.equal((await save(imageRef)).code, 'storage_failed');
    assert.equal(closed, true);
    assert.equal(await fsp.readFile(selected, 'utf8'), 'existing image');
    assert.deepEqual(await fsp.readdir(directory), ['design.png']);
  });
}

test('a failed exclusive open never removes a temporary file owned by another writer', async (t) => {
  let unownedPath;
  const unlinks = [];
  const { save, selected } = await boundary(t, {
    fs: {
      ...fsp,
      open: async (filePath, flags, mode) => {
        unownedPath = filePath;
        await fsp.writeFile(filePath, 'another writer');
        return fsp.open(filePath, flags, mode);
      },
      unlink: async (filePath) => {
        unlinks.push(filePath);
        await fsp.unlink(filePath);
      },
    },
  });
  await fsp.writeFile(selected, 'existing image');

  assert.equal((await save(imageRef)).code, 'storage_failed');
  assert.deepEqual(unlinks, []);
  assert.equal(await fsp.readFile(unownedPath, 'utf8'), 'another writer');
  assert.equal(await fsp.readFile(selected, 'utf8'), 'existing image');
});
