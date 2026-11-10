// What the layers panel renders. There is no DOM test runner for `src/`, so
// this suite reads the tree off the real render: its rows, their order and
// states, and the row the keyboard starts on. The keys are layerKeys.test.ts's.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanvasFrame, FrameRect } from '../protocol';
import { LayersPanel, type LayersPanelProps } from './LayersPanel';

function frame(designId: string, name: string, rect: FrameRect): CanvasFrame {
  return {
    designId,
    name,
    rect,
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build: { status: 'ready', revisionId: 'rev_01', generation: 1, diagnostics: [] },
  };
}

function panel(props: Partial<LayersPanelProps>): string {
  return renderToStaticMarkup(
    createElement(LayersPanel, {
      frames: [],
      selectedFrameIds: [],
      agentWorking: false,
      onRename: undefined,
      onPick: () => undefined,
      onFocusFrame: () => undefined,
      onLeave: () => undefined,
      onClose: () => undefined,
      ...props,
    }),
  );
}

function rows(markup: string): { label: string; selected: boolean; id: string }[] {
  return [...markup.matchAll(/<div id="([^"]+)" role="treeitem"[^>]*>/g)].map(([tag, id]) => ({
    id,
    label: /aria-label="([^"]+)"/.exec(tag)?.[1] ?? '',
    selected: tag.includes('aria-selected="true"'),
  }));
}

test('rows follow the canvas order, not where the frames sit, and say what is selected', () => {
  // The board reads Checkout before Pricing; the panel keeps the canvas's own order.
  const frames = [
    frame('a', 'Pricing', { x: 600, y: 400, width: 400, height: 300 }),
    frame('b', 'Checkout', { x: 0, y: 0, width: 400, height: 300 }),
    {
      ...frame('c', 'Checkout (Variant 2)', { x: 500, y: 0, width: 400, height: 300 }),
      build: { status: 'failed', generation: 2, diagnostics: [], lastWorkingRevisionId: null },
    } satisfies CanvasFrame,
  ];
  const markup = panel({ frames, selectedFrameIds: ['c', 'a'] });
  const shown = rows(markup);
  assert.deepEqual(
    shown.map(({ label, selected }) => [label, selected]),
    [
      ['Pricing, Ready', true],
      ['Checkout, Ready', false],
      ['Checkout (Variant 2), Failed', true],
    ],
  );
  // The keyboard starts on the first frame picked.
  assert.match(markup, new RegExp(`aria-activedescendant="${shown[2].id}"`));
  assert.match(markup, /role="tree"[^>]*aria-multiselectable="true"/);
});

test('a canvas without frames says so instead of an empty tree', () => {
  const markup = panel({ frames: [] });
  assert.match(markup, /No frames yet/);
  assert.doesNotMatch(markup, /role="tree"/);
});
