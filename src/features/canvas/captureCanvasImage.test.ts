import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CanvasImageSaveResult,
  CanvasPreviewCaptureResult,
  CanvasPreviewCaptureRequest,
} from '../../lib/desktop';
import {
  CanvasImageError,
  captureCanvasImage,
  exportCanvasImage,
  registerCanvasPreview,
} from './captureCanvasImage';

const ref = { designId: 'dsg_01', revisionId: 'rev_01' };

function desktopCapture() {
  const pending: {
    request: CanvasPreviewCaptureRequest;
    answer: (result: CanvasPreviewCaptureResult) => void;
  }[] = [];
  const cancelled: string[] = [];
  const saves: [string, string, string, string][] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      droidControl: {
        canvasPreviewCapture: (request: CanvasPreviewCaptureRequest) =>
          new Promise<CanvasPreviewCaptureResult>((answer) => pending.push({ request, answer })),
        canvasPreviewCancelCapture: (requestId: string) => {
          cancelled.push(requestId);
          return Promise.resolve(true);
        },
        canvasImageSave: (...args: [string, string, string, string]) => {
          saves.push(args);
          return Promise.resolve<CanvasImageSaveResult>({ ok: true });
        },
      },
    },
  });
  return { pending, cancelled, saves, close: () => Reflect.deleteProperty(globalThis, 'window') };
}

function mount(guestId: number) {
  return registerCanvasPreview('cv_01', ref, {
    guestId,
    generation: guestId,
    width: 720,
    height: 720,
    scaleFactor: 2,
  });
}

test('an abort settles before the compositor answers and releases the request', async () => {
  const desktop = desktopCapture();
  const release = mount(41);
  try {
    const controller = new AbortController();
    const capture = captureCanvasImage('cv_01', ref, controller.signal);
    assert.equal(desktop.pending.length, 1);
    controller.abort();
    await assert.rejects(capture, (error: unknown) => error instanceof CanvasImageError);
    assert.deepEqual(desktop.cancelled, [desktop.pending[0].request.requestId]);
    desktop.pending[0].answer({
      ok: true,
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
  } finally {
    release();
    desktop.close();
  }
});

test('a replacement generation cancels the old capture and serves only the new guest', async () => {
  const desktop = desktopCapture();
  const releaseOld = mount(41);
  let releaseNew: (() => void) | null = null;
  try {
    const oldCapture = captureCanvasImage('cv_01', ref, new AbortController().signal);
    releaseNew = mount(42);
    await assert.rejects(oldCapture, (error: unknown) => error instanceof CanvasImageError);
    const nextCapture = captureCanvasImage('cv_01', ref, new AbortController().signal);
    assert.equal(desktop.pending[1].request.guestId, 42);
    const bytes = new Uint8Array([4, 5, 6]);
    desktop.pending[0].answer({ ok: true, mediaType: 'image/png', bytes: new Uint8Array([1]) });
    desktop.pending[1].answer({ ok: true, mediaType: 'image/png', bytes });
    assert.deepEqual((await nextCapture).bytes, bytes);
  } finally {
    releaseNew?.();
    releaseOld();
    desktop.close();
  }
});

test('releasing the preview slot cancels a pending capture', async () => {
  const desktop = desktopCapture();
  const release = mount(41);
  try {
    const capture = captureCanvasImage('cv_01', ref, new AbortController().signal);
    release();
    await assert.rejects(capture, (error: unknown) => error instanceof CanvasImageError);
    assert.deepEqual(desktop.cancelled, [desktop.pending[0].request.requestId]);
  } finally {
    desktop.close();
  }
});

test('export saves the captured revision identifiers without forwarding renderer bytes', async () => {
  const desktop = desktopCapture();
  const release = mount(41);
  try {
    const exported = exportCanvasImage('cv_01', ref, 'design', new AbortController().signal);
    assert.deepEqual(desktop.saves, []);
    const request = desktop.pending[0].request;
    assert.equal(request.canvasId, 'cv_01');
    assert.equal(request.designId, 'dsg_01');
    assert.equal(request.revisionId, 'rev_01');
    desktop.pending[0].answer({
      ok: true,
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });

    assert.equal(await exported, true);
    assert.deepEqual(desktop.saves, [['cv_01', 'dsg_01', 'rev_01', 'design']]);
  } finally {
    release();
    desktop.close();
  }
});
