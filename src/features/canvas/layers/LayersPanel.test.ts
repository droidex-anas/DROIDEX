// What the layers panel renders. There is no DOM test runner for `src/`, so
// this suite reads the tree off the real render: its rows, their order and
// states, and the row the keyboard starts on. The keys are layerKeys.test.ts's.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverlayStore } from '../overlayStore';
import { PreviewRuns } from '../previewRuns';
import type { CanvasFrame, FrameRect, OutlineNode } from '../protocol';
import type { HoveredElement } from '../useElementHover';
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
    build: {
      status: 'ready',
      revisionId: 'rev_01',
      artifactId: 'art_01',
      elements: [],
      outline: { nodes: [], truncated: false },
      generation: 1,
      diagnostics: [],
    },
  };
}

function panel(props: Partial<LayersPanelProps>): string {
  return renderToStaticMarkup(
    createElement(LayersPanel, {
      frames: [],
      selectedFrameIds: [],
      agentWorking: false,
      elements: {
        runs: new PreviewRuns(),
        picked: null,
        hovered: new OverlayStore(null),
        pick: () => undefined,
        hover: () => undefined,
      },
      onRename: undefined,
      onSetHidden: undefined,
      onReorder: undefined,
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

test('rows run front to back in the canvas order, not where the frames sit, and say what is selected', () => {
  // The board reads Checkout before Pricing; the panel keeps the canvas's stacking, front first.
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
      ['Checkout (Variant 2), Failed', true],
      ['Checkout, Ready', false],
      ['Pricing, Ready', true],
    ],
  );
  // The keyboard starts on the first frame picked.
  assert.match(markup, new RegExp(`aria-activedescendant="${shown[0].id}"`));
  assert.match(markup, /role="tree"[^>]*aria-multiselectable="true"/);
});

test('a hidden frame says so, dimmed, with its eye pressed; a chat that cannot edit has no eye', () => {
  const frames = [
    frame('a', 'Pricing', { x: 0, y: 0, width: 400, height: 300 }),
    { ...frame('b', 'Checkout', { x: 500, y: 0, width: 400, height: 300 }), hidden: true },
  ];
  const editable = panel({ frames, onSetHidden: () => undefined, onReorder: () => undefined });
  assert.deepEqual(
    rows(editable).map(({ label }) => label),
    ['Checkout, Ready, hidden', 'Pricing, Ready'],
  );
  assert.match(editable, /<span class="text-muted">Checkout<\/span>/);
  const eyes = [...editable.matchAll(/<button[^>]*aria-label="Hide"[^>]*>/g)].map(([tag]) =>
    tag.includes('aria-pressed="true"'),
  );
  assert.deepEqual(eyes, [true, false]);
  assert.doesNotMatch(panel({ frames }), /aria-label="Hide"/);
});

test('a canvas without frames says so instead of an empty tree', () => {
  const markup = panel({ frames: [] });
  assert.match(markup, /No frames yet/);
  assert.doesNotMatch(markup, /role="tree"/);
});

test('a frame that has built opens on its layers; one that never has has no caret', () => {
  const frames = [
    frame('a', 'Pricing', { x: 0, y: 0, width: 400, height: 300 }),
    {
      ...frame('b', 'Checkout', { x: 500, y: 0, width: 400, height: 300 }),
      build: { status: 'building', revisionId: 'rev_01', generation: 1 },
    } satisfies CanvasFrame,
  ];
  const markup = panel({ frames });
  const tags = [...markup.matchAll(/<div id="[^"]+" role="treeitem"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(
    tags.map((tag) => /aria-expanded="(\w+)"/.exec(tag)?.[1] ?? null),
    [null, 'false'],
  );
  assert.equal([...markup.matchAll(/aria-label="Expand"/g)].length, 1);
});

test('an element picked on the board opens its frame, and rows its preview has not been read for say so and stay unpicked', () => {
  const layer = (nodeId: string, parentId: string | null, row: Partial<OutlineNode>) =>
    ({
      nodeId,
      parentId,
      kind: 'element',
      name: 'div',
      text: null,
      elementId: null,
      lock: null,
      free: true,
      contentFromProps: false,
      visibility: 'shown',
      ...row,
    }) satisfies OutlineNode;
  const pricing = frame('a', 'Pricing', { x: 0, y: 0, width: 400, height: 300 });
  const outline = {
    nodes: [
      layer('n1', null, { name: 'section', elementId: 'el_section' }),
      layer('n2', 'n1', { name: 'h1', text: 'Simple plans', elementId: 'el_title' }),
      layer('n3', 'n1', { kind: 'repeat', name: 'Repeat', lock: 'repeated' }),
    ],
    truncated: false,
  };
  const markup = panel({
    frames: [{ ...pricing, build: { ...pricing.build, outline } } as CanvasFrame],
    elements: {
      runs: new PreviewRuns(),
      picked: {
        element: {
          designId: 'a',
          revisionId: 'rev_01',
          elementId: 'el_title',
          instancePath: '0/0',
        },
        pick: 1,
      },
      hovered: new OverlayStore<HoveredElement | null>({
        designId: 'a',
        element: {
          elementId: 'el_section',
          instancePath: '0',
          rect: { x: 0, y: 0, width: 400, height: 300 },
          tagName: 'section',
          room: { above: null, below: null },
        },
      }),
      pick: () => undefined,
      hover: () => undefined,
    },
  });
  const shown = rows(markup);
  assert.deepEqual(
    shown.map(({ label, selected }) => [label, selected]),
    [
      ['Pricing, Ready', false],
      // No live preview has said where it draws this frame's elements, so no row can be told
      // for the picked or hovered element: the element id alone does not say which copy it is.
      ['section, Container, not read', false],
      ['Simple plans, Text, not read', false],
      ['Repeat, locked', false],
    ],
  );
  assert.doesNotMatch(markup, / bg-elevated/);
});
