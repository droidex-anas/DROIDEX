import assert from 'node:assert/strict';
import test from 'node:test';

import { SIDEBAR_CONTENT_SEARCH_MIN_QUERY, sidebarSearchNotice } from './sidebarSearchStatus';

test('the search notice explains unavailable or incomplete content search beside its results', () => {
  const content = SIDEBAR_CONTENT_SEARCH_MIN_QUERY;
  // [why, query length, unavailable, indexing incomplete, entries, notice]
  const cases: Array<
    [string, number, boolean, boolean, number, ReturnType<typeof sidebarSearchNotice>]
  > = [
    // An unavailable index explains itself instead of a bare empty state, and
    // still labels title hits instead of looking complete.
    ['unavailable, no hits', content, true, false, 0, { kind: 'unavailable', layout: 'empty' }],
    ['unavailable, title hits', content, true, false, 2, { kind: 'unavailable', layout: 'inline' }],
    ['partially indexed, results', content, false, true, 1, { kind: 'indexing', layout: 'inline' }],
    ['partially indexed, empty', content, false, true, 0, { kind: 'indexing', layout: 'empty' }],
    ['complete and empty', content, false, false, 0, { kind: 'empty', layout: 'empty' }],
    ['complete with results', content, false, false, 3, null],
    // Title-only queries do not claim content search is unavailable or incomplete.
    ['title-only query', 1, true, true, 0, { kind: 'empty', layout: 'empty' }],
  ];
  for (const [
    why,
    queryLength,
    searchUnavailable,
    indexingIncomplete,
    entryCount,
    notice,
  ] of cases) {
    assert.deepEqual(
      sidebarSearchNotice({
        queryLength,
        pending: false,
        searchUnavailable,
        indexingIncomplete,
        entryCount,
      }),
      notice,
      why,
    );
  }
});
