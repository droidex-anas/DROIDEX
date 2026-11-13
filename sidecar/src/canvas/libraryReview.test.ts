import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_LIBRARY_SKIPS, type LibrarySkip } from './designSystemProvenance.js';
import { libraryReview } from './libraryReview.js';

test('a review lists what fits its bounds and counts every record, listed or not', () => {
  // Real paths are 20 to 60 characters; these fill the byte budget long before 128 records.
  const deep = `components/${'nested/'.repeat(130)}`;
  const records: LibrarySkip[] = [
    { file: `${'x'.repeat(1025)}.tsx`, reason: 'not_a_component', detail: null },
    { file: `${deep}button.tsx`, reason: 'duplicate_export', detail: 'Button' },
  ];
  for (let index = 0; index < 200; index += 1)
    records.push({ file: `${deep}part-${String(index)}.tsx`, reason: 'over_limit', detail: null });

  const review = libraryReview(records);
  assert.equal(review.skippedCount, 201);
  assert.equal(review.partialCount, 1);
  assert.ok(review.skipped.length > 0 && review.skipped.length < MAX_LIBRARY_SKIPS);
  assert.ok(Buffer.byteLength(JSON.stringify(review.skipped)) <= 32 * 1024);
  assert.ok(review.skipped.every(({ file }) => file.length <= 1024));
});
