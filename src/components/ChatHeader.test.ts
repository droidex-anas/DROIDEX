import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatHeader } from './ChatHeader';

test('a primary chat shows its title without child controls, including an empty title', () => {
  for (const title of ['Workspace navigation', '']) {
    const html = renderToStaticMarkup(
      createElement(ChatHeader, { title, live: false, leadPx: 16, trailPx: 16, tile: undefined }),
    );
    assert.ok(html.includes(title));
    assert.doesNotMatch(html, /<button|shimmer-text/);
    assert.match(html, /data-electron-drag-region="true"/);
  }
});

test('a running child shows its parent breadcrumb, metadata, and stop control', () => {
  const html = renderToStaticMarkup(
    createElement(ChatHeader, {
      title: 'Workspace navigation',
      live: true,
      leadPx: 16,
      trailPx: 16,
      tile: undefined,
      sub: {
        label: 'Inspect sidebar',
        meta: 'Worker',
        running: true,
        onBack: () => {},
        onStop: () => {},
      },
    }),
  );
  assert.match(html, /Back to primary session/);
  assert.match(html, /Workspace navigation/);
  assert.match(html, /Inspect sidebar/);
  assert.match(html, /Worker/);
  assert.match(html, /shimmer-text/);
  assert.match(html, /Stop child session/);
});
