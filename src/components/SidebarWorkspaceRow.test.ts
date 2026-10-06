import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SidebarWorkspaceRow, WorkspaceContextMenuPanel } from './SidebarWorkspaceRow';

test('a workspace row keeps Remove off the heading; its context menu offers it', () => {
  const heading = renderToStaticMarkup(
    createElement(
      SidebarWorkspaceRow,
      {
        name: 'droid-control',
        open: true,
        onToggle: () => undefined,
        onNewChat: () => undefined,
        onRemove: () => undefined,
      },
      null,
    ),
  );
  assert.match(heading, /droid-control/);
  assert.match(heading, /New chat here/);
  assert.doesNotMatch(heading, /Remove workspace/);

  const menu = renderToStaticMarkup(
    createElement(WorkspaceContextMenuPanel, {
      x: 40,
      y: 40,
      name: 'droid-control',
      onRemove: () => undefined,
      onClose: () => undefined,
    }),
  );
  assert.match(menu, /role="menu"/);
  assert.match(menu, /Remove workspace/);
});
