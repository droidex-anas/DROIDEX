import assert from 'node:assert/strict';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { designSystemBrief } from './designSystemBrief.js';
import {
  DOCUMENT_LIMITS,
  kitModes,
  writtenTextBytes,
  type DocumentSection,
} from './designSystemDocument.js';
import { DESIGN_SYSTEM_LIMITS, saveDesignSystem } from './designSystems.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';

pinScratchProfile();

/** A preset filled to the schema's limits: 128 long token names and 16 KiB of notes. */
function fullKit(): DocumentSection[] {
  const sections = OPENAI_INSPIRED_DESIGN_SYSTEM.sections;
  const declared = Object.keys(kitModes(sections).light).length;
  const others: DocumentSection = {
    kind: 'tokens',
    id: 'other-tokens',
    title: 'Other tokens',
    items: [
      {
        kind: 'group',
        id: 'brand-scale',
        title: 'Brand scale',
        tokens: Array.from({ length: DOCUMENT_LIMITS.maxTokens - declared }, (_, index) => ({
          name: `--brand-marketing-illustration-highlight-tone-${String(index)}`,
          value: '#123456',
        })),
      },
    ],
  };
  const room = DESIGN_SYSTEM_LIMITS.maxGuidanceBytes - writtenTextBytes(sections);
  const notes: DocumentSection = {
    kind: 'notes',
    id: 'more',
    title: 'More rules',
    items: [0, 1].map((index) => ({
      kind: 'note',
      id: `long-${String(index)}`,
      label: `long-${String(index)}.md`,
      body: 'x'.repeat(Math.floor(room / 2)),
      author: 'user',
    })),
  };
  return [...sections, notes, others];
}

test('a full kit’s brief lists token names by section kind within the 4 KiB name budget', async () => {
  const sections = fullKit();
  const ref = await saveDesignSystem(
    { ...OPENAI_INSPIRED_DESIGN_SYSTEM, id: 'full', name: 'Full', sections },
    { mutationId: 'full-kit', baseVersion: null, savedBy: { actor: 'user' } },
  );
  const brief = await designSystemBrief({ ...ref, mode: 'dark' });
  assert.ok(!('unavailable' in brief));

  const { primitives, tokens, omittedNames } = brief;
  const listBytes = Buffer.byteLength(JSON.stringify({ primitives, tokens }), 'utf8');
  assert.ok(listBytes <= 4 * 1024 + '{"primitives":[],"tokens":{}}'.length, String(listBytes));
  assert.deepEqual(primitives, ['Button', 'Card', 'Badge', 'Input', 'Tabs', 'Dialog']);
  // Kinds follow the document; the names cut are the last ones, and counted.
  assert.deepEqual(Object.keys(tokens), [
    'colors',
    'typography',
    'spacing',
    'radius',
    'shadows',
    'motion',
    'tokens',
  ]);
  assert.deepEqual(tokens.radius, [
    '--ds-radius-sm',
    '--ds-radius-md',
    '--ds-radius-lg',
    '--ds-radius-pill',
  ]);
  const listed = Object.values(tokens).flat().length;
  assert.ok(omittedNames !== undefined && omittedNames > 0);
  assert.equal(listed + omittedNames, DOCUMENT_LIMITS.maxTokens);
  assert.ok(Buffer.byteLength(JSON.stringify(brief), 'utf8') < 21 * 1024);
});
