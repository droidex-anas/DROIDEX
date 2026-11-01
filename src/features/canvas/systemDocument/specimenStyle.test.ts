import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentSection } from '../designSystemDocumentProtocol';
import { specimenProperties } from './specimenStyle';

// Node has no CSS.supports; this answers as a browser does for the corner values below.
Object.defineProperty(globalThis, 'CSS', {
  value: {
    supports: (property: string, value: string) =>
      property === 'border-radius' && /^(?:0|\d+px|var\(.+\))$/.test(value),
  },
});

test('a token drawn as plain text is still published for the tokens that refer to it', () => {
  const sections: DocumentSection[] = [
    {
      kind: 'radius',
      id: 'radius',
      title: 'Corner radius',
      items: [
        {
          kind: 'group',
          id: 'corners',
          title: 'Corners',
          tokens: [
            { name: '--ds-radius-zero', value: '0' },
            { name: '--ds-radius-next', value: 'var(--ds-radius-zero, 9px)' },
          ],
        },
      ],
    },
  ];
  assert.deepEqual(specimenProperties(sections, 'light'), {
    '--ds-radius-zero': '0',
    '--ds-radius-next': 'var(--ds-radius-zero, 9px)',
  });
});
