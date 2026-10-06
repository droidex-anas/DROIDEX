import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionContextMenuPanel, type SessionContextMenuProps } from './SessionContextMenu';

// The panel must SSR without any browser global: with no window the viewport
// clamp is skipped and coordinates pass through raw. (The portal wrapper
// stays untestable in SSR — portals reject fake document.body containers —
// hence rendering the panel.)
function render(props: Partial<SessionContextMenuProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SessionContextMenuPanel, {
      x: 40,
      y: 40,
      pinned: false,
      cwd: '/repo',
      provider: 'droid',
      resumeSessionId: 'droid-123',
      providerSessionId: 'droid-123',
      onOpenInTab: () => undefined,
      onRename: () => undefined,
      onTogglePin: () => undefined,
      onArchive: () => undefined,
      onCopyMarkdown: () => undefined,
      onClose: () => undefined,
      ...props,
    }),
  );
}

// Renders with a minimal window stub so the viewport clamp engages.
function renderWithWindow(props: Partial<SessionContextMenuProps> = {}): string {
  const g = globalThis as { window?: unknown };
  const previous = g.window;
  g.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  try {
    return render(props);
  } finally {
    if (previous === undefined) delete g.window;
    else g.window = previous;
  }
}

test('SessionContextMenu lists organization actions first, then the copy actions', () => {
  const html = render();
  const order = [
    'Open in new tab',
    'Pin chat',
    'Rename chat',
    'Archive chat',
    'Copy Working Directory',
    'Copy Session ID',
    'Copy Session Link',
    'Copy as Markdown',
  ];
  const positions = order.map((label) => html.indexOf(label));
  for (const [index, position] of positions.entries()) {
    assert.notEqual(position, -1, `${order[index]} should render`);
    if (index > 0) assert.ok(position > positions[index - 1], `${order[index]} out of order`);
  }
  assert.match(html, /aria-label="Chat actions"/);
});

test('SessionContextMenu rows follow what the chat has', () => {
  assert.match(render({ pinned: true }), /Unpin chat/);
  for (const cwd of [undefined, '']) {
    const html = render({ cwd });
    assert.doesNotMatch(html, /Copy Working Directory/);
    assert.match(html, /Copy Session ID/);
  }
  // The session id and link rows wait until the harness assigns an id.
  const unassigned = render({ providerSessionId: undefined, resumeSessionId: undefined });
  assert.doesNotMatch(unassigned, /Copy Session ID/);
  assert.doesNotMatch(unassigned, /Copy Session Link/);
  assert.match(unassigned, /Copy Working Directory/);
  assert.match(unassigned, /Copy as Markdown/);
});

test('SessionContextMenu renders without a window global and skips the clamp', () => {
  // Regression: the clamp used to dereference window during render, making the
  // panel unrenderable in SSR without a fake browser global.
  assert.equal(typeof window, 'undefined');
  const html = render({ x: 2, y: 790 });
  // No viewport: raw coordinates pass through (only the margin floor applies).
  assert.match(html, /top:\s*790px/);
  assert.match(html, /left:\s*8px/);
});

test('SessionContextMenu clamps to the viewport bottom using the rendered row count', () => {
  // Full menu (cwd + provider id => 8 rows): 18 chrome + 8*30 = 258px tall.
  const html = renderWithWindow({ y: 790 });
  const top = /top:\s*([\d.]+)px/.exec(html);
  assert.ok(top, 'expected an inline top style');
  // 800 - 258 - 8 margin = 534.
  assert.equal(Number(top[1]), 534);
});
