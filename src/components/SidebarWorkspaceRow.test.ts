import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SidebarWorkspaceRow } from './SidebarWorkspaceRow';

// The context menu portals through ui/Menu, which a static render cannot
// exercise; this covers the row that opens it.
test('a workspace row keeps Remove off the heading', () => {
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
});
