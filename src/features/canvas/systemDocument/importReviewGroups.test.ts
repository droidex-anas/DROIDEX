import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryProvenance, LibrarySkip } from '../protocol';
import { importReview } from './importReviewGroups';

function library(skipped: LibrarySkip[], skippedCount = skipped.length): LibraryProvenance {
  return { kind: 'shadcn', components: {}, tokens: {}, skipped, skippedCount };
}

test('a kit that left nothing out has no review', () => {
  assert.equal(importReview(library([])), null);
});

test('left-out files group by reason, named from their shared folder, with what each needs', () => {
  const review = importReview(
    library(
      [
        { file: 'components/ui/button.tsx', reason: 'duplicate_export', detail: 'Button' },
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
    ),
  );
  assert.deepEqual(review, {
    label: '17 left out',
    folder: 'components/ui',
    groups: [
      {
        reason: 'unsupported_import',
        title: "Imports a package the canvas can't load",
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
        reason: 'duplicate_export',
        title: 'Exports a name another file already exports',
        rows: [{ file: 'button.tsx', note: 'Button is not exported from it' }],
      },
      {
        reason: 'not_a_component',
        title: 'Not a component file',
        rows: [{ file: 'charts', note: null }],
      },
    ],
    more: 12,
  });
});

test('files in different folders keep their whole path', () => {
  const review = importReview(
    library([
      { file: 'src/ui/a.tsx', reason: 'unreadable', detail: null },
      { file: 'lib/b.tsx', reason: 'unreadable', detail: null },
    ]),
  );
  assert.equal(review?.folder, null);
  assert.deepEqual(
    review?.groups[0].rows.map(({ file }) => file),
    ['src/ui/a.tsx', 'lib/b.tsx'],
  );
});
