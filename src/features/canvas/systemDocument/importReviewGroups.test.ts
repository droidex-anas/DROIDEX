import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryProvenance, LibrarySkip } from '../protocol';
import { importReview } from './importReviewGroups';

function library(
  skipped: LibrarySkip[],
  skippedCount: number,
  partialCount = 0,
): LibraryProvenance {
  return { kind: 'shadcn', components: {}, tokens: {}, skipped, skippedCount, partialCount };
}

test('a kit whose import left nothing out or in part has no review', () => {
  assert.equal(importReview(library([], 0)), null);
});

test('left-out files group by reason, then kept ones, named from their shared folder', () => {
  const review = importReview(
    library(
      [
        { file: 'components/ui/button.tsx', reason: 'duplicate_export', detail: 'Button, Bar' },
        {
          file: 'components/ui/calendar.tsx',
          reason: 'unsupported_import',
          detail: 'react-day-picker',
        },
        { file: 'components/ui/charts', reason: 'not_a_component', detail: null },
        {
          file: 'components/ui/notice.tsx',
          reason: 'needs_left_out',
          detail: 'components/ui/sonner.tsx',
        },
        { file: 'components/ui/sonner.tsx', reason: 'unsupported_import', detail: 'next-themes' },
      ],
      17,
      2,
    ),
  );
  assert.deepEqual(review, {
    label: '17 left out · 2 notes',
    folder: 'components/ui',
    groups: [
      {
        reason: 'unsupported_import',
        title: 'Imports something the canvas cannot load',
        rows: [
          { file: 'calendar.tsx', note: 'Uses react-day-picker' },
          { file: 'sonner.tsx', note: 'Uses next-themes' },
        ],
      },
      {
        reason: 'needs_left_out',
        title: 'Needs a file that was left out',
        rows: [{ file: 'notice.tsx', note: 'Needs sonner.tsx' }],
      },
      {
        reason: 'not_a_component',
        title: 'Not a component file',
        rows: [{ file: 'charts', note: null }],
      },
      {
        reason: 'duplicate_export',
        title: 'Kept; the kit entry takes these names from another file',
        rows: [{ file: 'button.tsx', note: 'Button, Bar' }],
      },
    ],
    more: 14,
  });
});

test('an import that left nothing out reads as notes on the files it kept', () => {
  const review = importReview(
    library([{ file: 'components/ui/hidden.tsx', reason: 'no_exports', detail: null }], 0, 1),
  );
  assert.equal(review?.label, '1 note');
  assert.equal(review?.groups[0].title, 'Kept; the kit entry exports nothing from it');
});

test('files in different folders keep their whole path', () => {
  const review = importReview(
    library(
      [
        { file: 'src/ui/a.tsx', reason: 'unreadable', detail: null },
        { file: 'lib/b.tsx', reason: 'unreadable', detail: null },
      ],
      2,
    ),
  );
  assert.equal(review?.folder, null);
  assert.deepEqual(
    review?.groups[0].rows.map(({ file }) => file),
    ['src/ui/a.tsx', 'lib/b.tsx'],
  );
});
