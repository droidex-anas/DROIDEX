import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarSearchNotice from './SidebarSearchNotice';
import {
  HISTORY_INDEXING_INCOMPLETE_MESSAGE,
  HISTORY_SEARCH_UNAVAILABLE_MESSAGE,
} from '../lib/historyStatusCopy';

test('each search state renders its own notice, and only a complete search is empty', () => {
  const render = (kind: 'unavailable' | 'indexing' | 'empty', layout: 'empty' | 'inline') =>
    renderToStaticMarkup(createElement(SidebarSearchNotice, { kind, layout }));

  const unavailable = render('unavailable', 'empty');
  assert.ok(unavailable.includes('data-testid="sidebar-search-unavailable"'));
  assert.ok(unavailable.includes(HISTORY_SEARCH_UNAVAILABLE_MESSAGE));
  assert.doesNotMatch(unavailable, /No sessions found/);

  const indexing = render('indexing', 'inline');
  assert.ok(indexing.includes('data-testid="sidebar-search-indexing"'));
  assert.ok(indexing.includes(HISTORY_INDEXING_INCOMPLETE_MESSAGE));

  const empty = render('empty', 'empty');
  assert.match(empty, /No sessions found/);
  assert.doesNotMatch(empty, /data-testid="sidebar-search-/);
});
