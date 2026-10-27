import assert from 'node:assert/strict';
import test from 'node:test';
import { armLibrarySeed, oweCreatedCanvasSeed, takeCreatedCanvasSeed } from './librarySeed';
import type { LibraryItem } from './protocol';

const hero: LibraryItem = {
  itemId: 'item-hero',
  name: 'Hero',
  sourceCanvasId: 'cv_source',
  source: { designId: 'dsg_hero', revisionId: 'rev_hero' },
  width: 640,
  height: 400,
  designSystem: { id: 'droidex', version: 1, mode: 'light' },
};

test('a Design home send takes the armed library item once, and the next one starts blank', () => {
  armLibrarySeed(hero);
  oweCreatedCanvasSeed('send-1');
  oweCreatedCanvasSeed('send-2');
  const owed = takeCreatedCanvasSeed('send-1');
  assert.equal(owed?.item, hero);
  // A remounted bootstrap or a replayed attachment read places nothing more.
  assert.equal(takeCreatedCanvasSeed('send-1'), null);
  assert.equal(takeCreatedCanvasSeed('send-2'), null);

  // Leaving the home disarms it, so a later send owes nothing.
  armLibrarySeed(hero);
  armLibrarySeed(null);
  oweCreatedCanvasSeed('send-3');
  assert.equal(takeCreatedCanvasSeed('send-3'), null);
});
