import assert from 'node:assert/strict';
import test from 'node:test';

import { appFencesInMarkdown } from './appBlocks';

test('app fences report their opening line and whether they are terminated', () => {
  const lines = (...parts: string[]) => parts.join('\n');
  const cases: Array<[string, Array<{ complete: boolean; startLine: number }>]> = [
    [
      lines(
        'Intro paragraph.',
        '',
        '```app',
        '<main>Complete</main>',
        '```',
        '',
        '```app',
        '<main>Still streaming',
      ),
      [
        { complete: true, startLine: 3 },
        { complete: false, startLine: 7 },
      ],
    ],
    // Fences inside quotes and lists report their own opening line.
    [
      lines('- item', '', '  > ```app', '  > <main>Quoted</main>', '  > ```'),
      [{ complete: true, startLine: 3 }],
    ],
    // Only a fence left unterminated is reported incomplete.
    [
      lines('```app', '<main>One</main>', '```', '```app', '<main>Two</main>', '```'),
      [
        { complete: true, startLine: 1 },
        { complete: true, startLine: 4 },
      ],
    ],
  ];
  for (const [source, fences] of cases) {
    assert.deepEqual(appFencesInMarkdown(source), fences);
  }
});
