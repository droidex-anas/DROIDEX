import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { designSystemBrief } from './designSystemBrief.js';
import {
  DOCUMENT_LIMITS,
  kitModes,
  writtenTextBytes,
  type DocumentSection,
} from './designSystemDocument.js';
import { AUTO_DESIGN_SYSTEM_REF, DESIGN_SYSTEM_LIMITS, saveDesignSystem } from './designSystems.js';
import { catalogFile } from './kitCatalog.js';
import { SAMPLE_KIT } from '../testing/sampleKit.js';

pinScratchProfile();

/** A kit filled to the schema's limits: long token names up to the cap and 16 KiB of notes. */
function fullKit(): DocumentSection[] {
  const sections = SAMPLE_KIT.sections;
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
    { ...SAMPLE_KIT, id: 'full', name: 'Full', sections },
    { mutationId: 'full-kit', baseVersion: null, savedBy: { actor: 'user' } },
  );
  const brief = await designSystemBrief(
    { ...ref, mode: 'dark' },
    { projectFolder: null, hasDesigns: false },
  );
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

test('under Auto, the opening read before a project chat’s first design offers a kit from the project', async (t) => {
  const offer =
    /offer in one sentence[^.]*build one from the project's[^.]*\. Build it only when the user says so\./;
  const folder = await mkdtemp(join(tmpdir(), 'brief-project-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const guidance = async (
    ref: typeof AUTO_DESIGN_SYSTEM_REF,
    projectFolder: string | null,
    hasDesigns: boolean,
  ) => {
    const brief = await designSystemBrief(ref, { projectFolder, hasDesigns });
    assert.ok(!('unavailable' in brief));
    return brief.guidance;
  };
  assert.match(await guidance(AUTO_DESIGN_SYSTEM_REF, folder, false), offer);
  assert.doesNotMatch(await guidance(AUTO_DESIGN_SYSTEM_REF, folder, false), /shadcn/);
  // A canvas already designed has its look, and a chat with no folder has nothing to read.
  assert.doesNotMatch(await guidance(AUTO_DESIGN_SYSTEM_REF, folder, true), offer);
  assert.doesNotMatch(await guidance(AUTO_DESIGN_SYSTEM_REF, null, false), offer);
  // The import refuses a linked components.json, so it is not offered.
  await writeFile(join(folder, 'elsewhere.json'), '{}');
  await symlink(join(folder, 'elsewhere.json'), join(folder, 'components.json'));
  assert.doesNotMatch(await guidance(AUTO_DESIGN_SYSTEM_REF, folder, false), /shadcn/);
  await rm(join(folder, 'components.json'));
  // A shadcn/ui library is offered as what the kit is made from.
  await writeFile(join(folder, 'components.json'), '{}');
  assert.match(
    await guidance(AUTO_DESIGN_SYSTEM_REF, folder, false),
    /build one from the project's shadcn\/ui components/,
  );
  // A chosen kit is the system already.
  const kit = await saveDesignSystem(
    { ...SAMPLE_KIT, id: 'chosen', name: 'Chosen' },
    { mutationId: 'chosen-kit', baseVersion: null, savedBy: { actor: 'user' } },
  );
  assert.doesNotMatch(await guidance({ ...kit, mode: 'light' }, folder, false), offer);
});

test('the brief names the kit’s catalog entries within their own 1 KiB, and counts the rest', async () => {
  const names = Array.from({ length: 40 }, (_, index) => `Marketing hero banner ${String(index)}`);
  const catalog = names.map((name) => ({
    name,
    module: 'index.tsx',
    uses: ['Button'],
    icons: [],
    jsx: '<Button>Go</Button>',
    note: null,
  }));
  const ref = await saveDesignSystem(
    {
      ...SAMPLE_KIT,
      id: 'catalogued',
      files: { ...SAMPLE_KIT.files, 'catalog.json': catalogFile(catalog) },
    },
    { mutationId: 'catalogued-kit', baseVersion: null, savedBy: { actor: 'user' } },
  );
  const brief = await designSystemBrief(
    { ...ref, mode: 'light' },
    { projectFolder: null, hasDesigns: false },
  );
  assert.ok(!('unavailable' in brief) && brief.catalog && brief.omittedCatalogNames);
  assert.ok(Buffer.byteLength(JSON.stringify(brief.catalog), 'utf8') <= 1024);
  assert.deepEqual(brief.catalog, names.slice(0, brief.catalog.length));
  assert.equal(brief.catalog.length + brief.omittedCatalogNames, names.length);
  // The primitives keep their own budget.
  assert.deepEqual(brief.primitives, ['Button', 'Card', 'Badge', 'Input', 'Tabs', 'Dialog']);
});
