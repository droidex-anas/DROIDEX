import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { BrowserChannelProcess } from '../browser/desktopBrowserChannel.js';
import { createDesktopImageChannel } from './desktopImageChannel.js';

const ASSET = {
  assetId: 'a'.repeat(64),
  mediaType: 'image/png',
  byteLength: 68,
  width: 1,
  height: 1,
} as const;

function projectFile(path: string) {
  return { path, dev: 1, ino: 2, size: 68 };
}

/** Main's end of the IPC channel: it records each request and answers when told. */
function mainProcess() {
  const channel = new EventEmitter() as EventEmitter & { connected: boolean };
  channel.connected = true;
  const requests: { id: string; canvasId: string; filePath: string; file: object }[] = [];
  const cancels: string[] = [];
  Object.assign(channel, {
    send: (
      message: (typeof requests)[number] & { type: string },
      callback: (error: Error | null) => void,
    ) => {
      if (message.type === 'canvas.importImageCancel') cancels.push(message.id);
      else requests.push(message);
      callback(null);
      return true;
    },
  });
  const answer = (id: string, result: unknown) => {
    channel.emit('message', { type: 'canvas.importImageResult', id, result });
  };
  return {
    channel: channel as unknown as BrowserChannelProcess,
    emitter: channel,
    requests,
    cancels,
    answer,
  };
}

test('a project image is imported by main and its refusal keeps the importer’s message', async () => {
  const main = mainProcess();
  const { importImage } = createDesktopImageChannel(main.channel);
  const signal = new AbortController().signal;

  const imported = importImage('canvas-one', projectFile('/project/logo.png'), signal);
  const refused = importImage('canvas-one', projectFile('/project/broken.png'), signal);
  const [first, second] = main.requests;
  assert.deepEqual(
    { canvasId: first.canvasId, filePath: first.filePath, file: first.file },
    { canvasId: 'canvas-one', filePath: '/project/logo.png', file: { dev: 1, ino: 2, size: 68 } },
  );
  main.answer(second.id, {
    ok: false,
    error: { code: 'invalid_input', message: 'The selected image could not be decoded.' },
  });
  main.answer(first.id, { ok: true, asset: ASSET });

  assert.deepEqual(await imported, ASSET);
  await assert.rejects(refused, {
    code: 'invalid_input',
    message: 'The selected image could not be decoded.',
  });
});

test('an ended turn or a closed channel fails a waiting import, and a late answer is dropped', async () => {
  const main = mainProcess();
  const { importImage, isWaiting } = createDesktopImageChannel(main.channel);
  const turn = new AbortController();

  const ended = importImage('canvas-one', projectFile('/project/logo.png'), turn.signal);
  const closed = importImage(
    'canvas-one',
    projectFile('/project/icon.png'),
    new AbortController().signal,
  );
  const endedId = main.requests[0].id;
  assert.equal(isWaiting(endedId), true);
  turn.abort();
  await assert.rejects(ended, { code: 'scope_expired' });
  // Main stops the import, and a save it still asks for is refused.
  assert.deepEqual(main.cancels, [endedId]);
  assert.equal(isWaiting(endedId), false);
  main.answer(endedId, { ok: true, asset: ASSET });

  main.emitter.emit('disconnect');
  await assert.rejects(closed, { code: 'storage_failed' });
});

test('an import main does not answer in time is cancelled there', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const main = mainProcess();
  const { importImage, isWaiting } = createDesktopImageChannel(main.channel, 1_000);

  const late = importImage(
    'canvas-one',
    projectFile('/project/logo.png'),
    new AbortController().signal,
  );
  t.mock.timers.tick(1_000);
  await assert.rejects(late, { code: 'storage_failed' });
  assert.deepEqual(main.cancels, [main.requests[0].id]);
  assert.equal(isWaiting(main.requests[0].id), false);
});
