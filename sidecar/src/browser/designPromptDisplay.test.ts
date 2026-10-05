import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { designPromptDisplayFromText } from './designPromptDisplay.js';
import { browserDesignReferenceDir } from './browserPaths.js';
import { formatAppPrompt } from '../appPrompt.js';

test('designPromptDisplayFromText extracts instruction and browser chips from a pack', () => {
  const dir = join(tmpdir(), `droid-display-${Date.now()}`);
  const packDir = browserDesignReferenceDir('m1', dir);
  mkdirSync(packDir, { recursive: true });
  const packPath = join(packDir, 'pack.json');
  writeFileSync(
    packPath,
    JSON.stringify({
      appSessionId: 'm1',
      browserSessionId: 'b1',
      createdAt: new Date().toISOString(),
      instruction: 'What font is this?',
      references: [
        {
          id: '@live-heading',
          anchor: {
            id: '@live-heading',
            kind: 'element',
            label: 'Hero heading',
            tag: 'h1',
            name: 'Hero heading',
            box: { x: 10, y: 20, width: 200, height: 48 },
          },
          detail: {
            id: '@live-heading',
            selector: 'h1',
            selectorVerified: true,
            attributes: {},
            styles: {},
            ancestors: [],
          },
          url: 'https://example.com',
          viewport: { width: 1000, height: 800, deviceScaleFactor: 2 },
          scroll: { x: 0, y: 0 },
          createdAt: new Date().toISOString(),
        },
      ],
    }),
    'utf8',
  );

  assert.deepEqual(
    designPromptDisplayFromText(
      [
        'Design Mode reference pack:',
        '- URL: https://example.com',
        '- Screenshot: none',
        `- References JSON: ${packPath}`,
        '',
        'User instruction:',
        'What font is this?',
      ].join('\n'),
      { browserDataDir: dir },
    ),
    {
      text: 'What font is this?',
      browserRefs: [
        {
          id: '@live-heading',
          kind: 'element',
          label: 'Hero-heading',
          url: 'https://example.com',
          selector: 'h1',
          imageDataUrl: undefined,
        },
      ],
      sideChatReplies: undefined,
    },
  );
});

test('designPromptDisplayFromText ignores packs outside browser data and prompts that are not packs', () => {
  const dir = join(tmpdir(), `droid-display-${Date.now()}-guarded`);
  mkdirSync(dir, { recursive: true });
  const outsidePath = join(tmpdir(), `droid-display-outside-${Date.now()}.json`);
  writeFileSync(
    outsidePath,
    JSON.stringify({
      references: [
        {
          id: '@outside',
          kind: 'element',
          element: { ref: '@outside', tagName: 'button', attributes: {}, computedStyles: {} },
        },
      ],
    }),
    'utf8',
  );

  assert.deepEqual(
    designPromptDisplayFromText(
      [
        'Design Mode reference pack:',
        '- URL: https://example.com',
        '- Screenshot: none',
        `- References JSON: ${outsidePath}`,
        '',
        'User instruction:',
        'What font is this?',
      ].join('\n'),
      { browserDataDir: dir },
    ),
    {
      text: 'What font is this?',
      browserRefs: undefined,
      sideChatReplies: undefined,
    },
  );
  // A prompt that is not a design pack is left alone.
  assert.equal(designPromptDisplayFromText('hello'), null);
});

test('designPromptDisplayFromText takes side-chat replies out of a framed instruction', () => {
  const instruction = [
    'Match @1',
    '',
    '<side_chat_replies>\nThe user attached these answers from a side chat about this conversation.',
    '<reply>\nUse the brand blue\n</reply>',
    '</side_chat_replies>',
  ].join('\n');
  const shown = designPromptDisplayFromText(
    `Design Mode reference pack:\n\nUser instruction:\n${formatAppPrompt(instruction, 'create')}`,
  );
  assert.equal(shown?.text, 'Match @1');
  assert.deepEqual(shown?.sideChatReplies, ['Use the brand blue']);
});
