import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesignPreview, PreviewGuestFrame, type DesignPreviewProps } from './DesignPreview';
import type { CanvasBuildState, CanvasFrame } from './protocol';

const CANVAS = 'cv_01';

function frameWith(build: CanvasBuildState): CanvasFrame {
  return {
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 1,
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
  const ready = render({ status: 'ready', revisionId: 'rev_02', artifactId: 'a'.repeat(64) });
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
      designId: 'dsg_hey',
      revisionId: 'rev_01',
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
        designId: 'dsg_hey',
        revisionId: 'rev_02',
        showingRevisionId: null,
        html: '<!doctype html><body>x</body>',
        diagnostics: [],
        onResize: undefined,
      }),
    ).includes('Showing revision'),
    false,
  );
});
