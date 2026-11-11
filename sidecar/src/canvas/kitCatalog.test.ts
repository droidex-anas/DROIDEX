import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { stopCanvasRuntime } from './canvasRuntime.js';
import { starterKit } from './designSystemImport.js';
import { designSystemSchema, readDesignSystem } from './designSystems.js';
import { catalogFile, catalogProblem, KIT_CATALOG_FILE, type CatalogEntry } from './kitCatalog.js';
import { KitPreviews } from './kitPreviews.js';
import { AUTO_DESIGN_SYSTEM } from './presets/auto.js';

pinScratchProfile();
after(() => stopCanvasRuntime());

function entry(name: string, jsx: string, uses = ['Button']): CatalogEntry {
  return { name, module: 'index.tsx', uses, icons: [], jsx, note: null };
}

function starterWith(catalog: string) {
  const kit = starterKit();
  return { ...kit, files: { ...kit.files, [KIT_CATALOG_FILE]: catalog } };
}

test('a catalog file outside its bounds is refused, naming what it breaks', () => {
  const button = entry('Button', '<Button>Go</Button>');
  const cases: [string, unknown, RegExp][] = [
    ['not JSON', '{', /is not JSON/],
    [
      'too many',
      Array.from({ length: 129 }, (_, i) => entry(`B${String(i)}`, '<Button />')),
      /at most 128/,
    ],
    ['long JSX', [entry('Long', `<Button>${'x'.repeat(4 * 1024)}</Button>`)], /at 0\.jsx: .*4 KiB/],
    ['unknown field', [{ ...button, props: {} }], /Unrecognized key/],
    ['not a name', [entry('Pair', '<Button />', ['Button Card'])], /at 0\.uses\.0/],
    ['twice', [button, button], /names two entries Button/],
    [
      'no module',
      [{ ...button, module: 'button.tsx' }],
      /catalog\.json, Button: the kit has no file button\.tsx/,
    ],
  ];
  for (const [label, catalog, message] of cases) {
    const json = typeof catalog === 'string' ? catalog : JSON.stringify(catalog);
    assert.match(catalogProblem(starterWith(json).files) ?? '', message, label);
  }
  assert.equal(catalogProblem(starterWith(catalogFile([button])).files), null);
  const { files, ...rest } = starterWith('{');
  const parsed = designSystemSchema.safeParse({
    id: 'acme',
    version: 1,
    name: 'Acme',
    files,
    ...rest,
  });
  assert.match(parsed.error?.issues[0]?.message ?? '', /catalog\.json is not JSON/);
});

test("every preset's catalog builds against its kit", async (t) => {
  const previews = new KitPreviews();
  t.after(() => previews.close());
  const droidex = await readDesignSystem({ id: 'droidex', version: 1 });
  const kits = { Auto: AUTO_DESIGN_SYSTEM, DROIDEX: droidex, starter: starterKit() };
  for (const [name, kit] of Object.entries(kits))
    assert.deepEqual(await previews.checkCatalog(kit), [], name);
});

test('a catalog failure is told as the entry whose lines it is on, and an unexported name refuses before any compile', async (t) => {
  const previews = new KitPreviews();
  t.after(() => previews.close());
  const built = await previews.checkCatalog(
    starterWith(
      catalogFile([
        entry('Button', '<Button>Go</Button>'),
        entry('Broken', '<div>\n  <Missing />\n</div>'),
        entry('Badge', '<Badge>New</Badge>', ['Badge']),
      ]),
    ),
  );
  assert.deepEqual(
    built.map(({ entry: name, diagnostic }) => [name, diagnostic.file]),
    [['Broken', KIT_CATALOG_FILE]],
  );
  assert.match(built[0].diagnostic.message, /^catalog\.json, Broken: .*Missing/);

  const unexported = await previews.checkCatalog(
    starterWith(catalogFile([entry('Table', '<Table />', ['Table'])])),
  );
  assert.deepEqual(unexported, [
    {
      entry: 'Table',
      diagnostic: {
        code: 'invalid_input',
        message:
          'catalog.json, Table: Table is not exported by the kit. Use a name its index.tsx exports.',
        file: KIT_CATALOG_FILE,
      },
    },
  ]);
});
