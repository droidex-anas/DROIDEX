import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as desktop from '../../lib/desktop';
import * as imageCapture from './captureCanvasImage';
import { DesignPreview, PreviewGuestFrame, type DesignPreviewProps } from './DesignPreview';
import type { CanvasBuildState, CanvasFrame } from './protocol';

const CANVAS = 'cv_01';

function frameWith(build: CanvasBuildState): CanvasFrame {
  return {
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'rev_02',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build,
  };
}

function render(build: CanvasBuildState, overrides: Partial<DesignPreviewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(DesignPreview, {
      canvasId: CANVAS,
      frame: frameWith(build),
      readArtifact: () => Promise.resolve(null),
      ...overrides,
    }),
  );
}

test('each build state without an artifact says what the frame is waiting for', () => {
  const labels = {
    pending: render({ status: 'pending' }),
    building: render({ status: 'building', revisionId: 'rev_02', generation: 1 }),
    cancelled: render({ status: 'cancelled', revisionId: 'rev_02' }),
    neverBuilt: render({
      status: 'failed',
      revisionId: 'rev_02',
      diagnostics: [{ code: 'syntax_error', message: 'Unexpected token' }],
      lastWorkingRevisionId: null,
    }),
  };

  assert.match(labels.pending, /Waiting to build/);
  assert.match(labels.building, /Building this design/);
  assert.match(labels.cancelled, /cancelled/);
  assert.match(labels.neverBuilt, /no working preview yet/);
  // A failure with nothing to fall back to still shows why.
  assert.match(labels.neverBuilt, /Unexpected token/);
  for (const markup of Object.values(labels)) assert.equal(markup.includes('<button'), false);
});

test('a revision with an artifact to load waits for it rather than guessing', () => {
  // Reading the artifact is an effect, so a first paint can only say it is
  // loading; previewRuntime.test.ts owns what happens once the guest is up.
  const ready = render({
    status: 'ready',
    revisionId: 'rev_02',
    artifactId: 'a'.repeat(64),
    elements: [],
    diagnostics: [],
  });
  const fallback = render({
    status: 'failed',
    revisionId: 'rev_03',
    diagnostics: [],
    lastWorkingRevisionId: 'rev_01',
  });

  assert.match(ready, /Loading this preview/);
  assert.match(fallback, /Loading this preview/);
});

test('a mounted fallback names the older working revision beside its diagnostics', () => {
  const markup = renderToStaticMarkup(
    createElement(PreviewGuestFrame, {
      canvasId: CANVAS,
      designId: 'dsg_hey',
      revisionId: 'rev_01',
      generation: 1,
      showingRevisionId: 'rev_01',
      html: '<!doctype html><body>x</body>',
      diagnostics: [{ code: 'syntax_error', message: 'Unexpected token' }],
      onResize: undefined,
    }),
  );

  // Spec §5: the frame labels the older working preview it is showing.
  assert.match(markup, /Showing revision rev_01/);
  assert.match(markup, /Unexpected token/);
  // The frame's own revision is not a fallback, so it is not labelled.
  assert.equal(
    renderToStaticMarkup(
      createElement(PreviewGuestFrame, {
        canvasId: CANVAS,
        designId: 'dsg_hey',
        revisionId: 'rev_02',
        generation: 1,
        showingRevisionId: null,
        html: '<!doctype html><body>x</body>',
        diagnostics: [],
        onResize: undefined,
      }),
    ).includes('Showing revision'),
    false,
  );
});

test('a zoomed preview submits its untransformed layout viewport for capture', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let mount: (() => void | (() => void)) | undefined;
  let ready: (() => void) | undefined;
  let request: desktop.CanvasPreviewCaptureRequest | undefined;
  let started: (() => void) | undefined;
  // Main binds the guest to its canvas before a design runs, so the capture is
  // only registered once the preview has actually started.
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const guest = {
    offsetWidth: 720,
    offsetHeight: 720,
    style: { cssText: '' },
    setAttribute() {},
    getBoundingClientRect: () => ({ width: 360, height: 360 }),
    getWebContentsId: () => 41,
    addEventListener: (_event: string, listener: () => void) => {
      ready = listener;
    },
    remove() {},
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      devicePixelRatio: 2,
      droidControl: {
        canvasPreviewUrl: 'droidex-canvas-preview://preview/guest',
        canvasPreviewBind: () => Promise.resolve(true),
        canvasPreviewCapture: (submitted: desktop.CanvasPreviewCaptureRequest) => {
          request = submitted;
          return Promise.resolve({ ok: true, mediaType: 'image/png', bytes: new Uint8Array([1]) });
        },
      },
    },
  });
  const compiled = ts.transpileModule(
    readFileSync(new URL('./DesignPreview.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  );
  const exports: Record<string, (props: unknown) => unknown> = {};
  let refs = 0;
  runInNewContext(compiled.outputText, {
    exports,
    require: (name: string) => {
      if (name === 'react')
        return {
          ...React,
          useRef: (value: unknown) => ({
            current: refs++ === 0 ? { append: () => ready?.() } : value,
          }),
          useState: (value: unknown) => [value, () => undefined],
          useEffect: (effect: typeof mount) => {
            mount = effect;
          },
        };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === '../../lib/desktop') return desktop;
      if (name === './captureCanvasImage') return imageCapture;
      if (name === './previewLabels') return {};
      if (name === './useCanvasMotion') return { useCanvasMotion: () => ({ readyMs: 0 }) };
      if (name === './previewRuntime')
        return {
          startPreview: ({ observer }: { observer: { onReady(): void } }) => {
            observer.onReady();
            started?.();
            return { stop() {} };
          },
        };
      throw new Error(`Unexpected import: ${name}`);
    },
    document: { createElement: () => guest },
    window,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    AbortController,
    setTimeout,
    clearTimeout,
  });
  exports.PreviewGuestFrame({
    canvasId: CANVAS,
    designId: 'dsg_zoom',
    revisionId: 'rev_zoom',
    generation: 1,
    html: '',
    diagnostics: [],
  });
  const stop = mount?.();
  try {
    await running;
    t.mock.timers.tick(150);
    assert.ok(request, 'the ready preview registered a capture');
    assert.equal(request.width, 720);
    assert.equal(request.height, 720);
    assert.equal(request.scaleFactor, 2);
  } finally {
    stop?.();
    Reflect.deleteProperty(globalThis, 'window');
  }
});
