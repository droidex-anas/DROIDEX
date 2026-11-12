import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { stopCanvasRuntime } from './canvasRuntime.js';
import { starterKit } from './designSystemImport.js';
import { designSystemSchema, readDesignSystem } from './designSystems.js';
import {
  catalogFile,
  catalogProblem,
  entryFailure,
  KIT_CATALOG_FILE,
  kitFailureSchema,
  readCatalogEntries,
  type CatalogEntry,
} from './kitCatalog.js';
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
    ['unknown field', [{ ...button, variants: {} }], /Unrecognized key/],
    [
      'prop default not an option',
      [
        {
          ...button,
          props: [{ name: 'variant', options: ['default', 'outline'], default: 'ghost' }],
        },
      ],
      /at 0\.props\.0: A prop's default is one of its options/,
    ],
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

test('a catalog failure is told as the entry whose lines it is on, and an unexported name as that entry', async (t) => {
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
  // The label goes on after the compiler bounds its message, and must keep the reply valid.
  const long = entryFailure('Broken', { code: 'invalid_input', message: 'x'.repeat(2048) });
  assert.ok(kitFailureSchema.safeParse(long).success);

  // Entry is also what the check once named each entry's own component.
  for (const name of ['Table', 'Entry']) {
    const unexported = await previews.checkCatalog(
      starterWith(catalogFile([entry(name, `<${name} />`, [name])])),
    );
    assert.deepEqual(unexported, [
      {
        entry: name,
        diagnostic: {
          code: 'invalid_input',
          message: `catalog.json, ${name}: ${name} is not exported by the kit. Use a name its index.tsx exports.`,
          file: KIT_CATALOG_FILE,
        },
      },
    ]);
  }
});

test('an entry stands alone, one JSX element naming only its own uses, icons and bindings, or it is refused by name', async (t) => {
  const previews = new KitPreviews();
  t.after(() => previews.close());
  const fitting = [
    entry('Button', '<Button>Go</Button>'),
    entry('List', "<ul>{['a', 'b'].map((item) => <li key={item}>{item}</li>)}</ul>", []),
    { ...entry('Add', '<Button>\n  <PlusIcon /> Add\n</Button>'), icons: ['PlusIcon'] },
  ];
  assert.deepEqual(await previews.checkCatalog(starterWith(catalogFile(fitting))), []);
  const cases: [string, string[], RegExp][] = [
    ['<div />\n)}\n<span>injected</span>\n{(null', [], /\(jsx line 2\)/],
    [
      '<div />\n)}\n</>\n);\n}\nimport { useState } from "react";\nexport const injected = 42;\nfunction Tail() {return (<>\n{(null',
      [],
      /\(jsx line 2\)/,
    ],
    ['<div />; <span />', [], /must be one JSX element or fragment/],
    ['<div />, <span />', [], /must be one JSX element or fragment/],
    ['<div /> /* open', [], /\(jsx line 1\)/],
    ['<div>\r\r\r\r<Missing />\r</div>', [], /Missing is not in its uses or icons/],
    ['<Button />', [], /Button is not in its uses or icons/],
    ['<div>{window.location.href}</div>', [], /window is not in its uses or icons/],
    ['<div>{`hello ${unknownValue}`}</div>', [], /unknownValue is not in its uses or icons/],
    ["<div>{void import('react')}</div>", [], /cannot load a module/],
    ['<div>{this.missing}</div>', [], /cannot use this or new\.target/],
    ['<div />', ['Button'], /Button is in its uses, but its jsx does not use it/],
  ];
  for (const [jsx, uses, message] of cases) {
    const failures = await previews.checkCatalog(
      starterWith(catalogFile([...fitting, entry('Bad', jsx, uses)])),
    );
    assert.deepEqual(
      failures.map(({ entry: name }) => name),
      ['Bad'],
      jsx,
    );
    assert.match(failures[0].diagnostic.message, /^catalog\.json, Bad: /, jsx);
    assert.match(failures[0].diagnostic.message, message, jsx);
  }
});

test("the kit's built exports decide what an entry may use, and a missing name is every entry's that names it", async (t) => {
  const previews = new KitPreviews();
  t.after(() => previews.close());
  const kit = starterKit();
  const files = {
    ...kit.files,
    'index.tsx': `${kit.files['index.tsx']}
export * from './parts';
  export function Indented() {
    return <div />;
  }
export const Bar = () => null, Foo = () => null;
`,
    'parts.tsx': 'export function Part() {\n  return <div />;\n}\n',
  };
  const exported = ['Part', 'Indented', 'Foo'].map((name) => entry(name, `<${name} />`, [name]));
  assert.deepEqual(
    await previews.checkCatalog({
      ...kit,
      files: { ...files, [KIT_CATALOG_FILE]: catalogFile(exported) },
    }),
    [],
  );

  const missingIcon = (name: string) => ({
    ...entry(name, '<NoSuchIcon />', []),
    icons: ['NoSuchIcon'],
  });
  const failures = await previews.checkCatalog(
    starterWith(
      catalogFile([missingIcon('First'), entry('Button', '<Button />'), missingIcon('Second')]),
    ),
  );
  assert.deepEqual(
    failures.map(({ entry: name, diagnostic }) => [name, diagnostic.message]),
    [
      ['First', 'catalog.json, First: lucide-react has no icon NoSuchIcon.'],
      ['Second', 'catalog.json, Second: lucide-react has no icon NoSuchIcon.'],
    ],
  );
});

test('a catalog read finds an entry by its name and the entries filed under it, within its byte budget', () => {
  const files = (catalog: CatalogEntry[]) => starterWith(catalogFile(catalog)).files;
  const named = [
    entry('Button', '<Button>Go</Button>'),
    entry('Button / outline', '<Button variant="outline">Go</Button>'),
    entry('Button group', '<Button>One</Button>'),
    entry('Badge', '<Badge>New</Badge>', ['Badge']),
  ];
  const read = readCatalogEntries(files(named), ['button']);
  assert.deepEqual(
    read.entries.map(({ name }) => name),
    ['Button', 'Button / outline'],
  );
  assert.deepEqual(read.entries[1], {
    name: 'Button / outline',
    uses: ['Button'],
    icons: [],
    jsx: '<Button variant="outline">Go</Button>',
    note: null,
    props: [],
  });
  assert.equal(read.omitted, undefined);
  assert.throws(
    () => readCatalogEntries(files(named), ['Badge', 'Card']),
    /This kit has no component called Card\. Read the catalog without entries/,
  );
  // Entries past the budget are named, never cut short, so a later read can ask for them.
  const large = Array.from({ length: 8 }, (_, index) =>
    entry(`Big ${String(index)}`, `<Button>${'x'.repeat(3 * 1024)}</Button>`),
  );
  const all = readCatalogEntries(files(large), undefined);
  assert.deepEqual(
    all.entries.map(({ name }) => name),
    ['Big 0', 'Big 1', 'Big 2', 'Big 3', 'Big 4'],
  );
  assert.deepEqual(all.omitted, ['Big 5', 'Big 6', 'Big 7']);
  assert.ok(all.entries.every(({ jsx }) => jsx.endsWith('</Button>')));
});

test('a catalog read always returns its first entry, and counts brackets and commas against the rest', () => {
  const files = (catalog: CatalogEntry[]) => starterWith(catalogFile(catalog)).files;
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  // Quotes double when escaped, and eight props of 32 options add about 11 KB.
  const option = (index: number) => `${'o'.repeat(38)}${String(index).padStart(2, '0')}`;
  const options = Array.from({ length: 32 }, (_, index) => option(index));
  const huge: CatalogEntry = {
    ...entry('Huge', `<Button>${'"'.repeat(4000)}</Button>`),
    props: Array.from({ length: 8 }, (_, index) => ({
      name: `p${String(index)}`,
      options,
      default: options[0],
    })),
  };
  const first = readCatalogEntries(
    files([huge, entry('Button', '<Button>Go</Button>')]),
    undefined,
  );
  assert.ok(bytes(first.entries) > 16 * 1024);
  assert.deepEqual(
    first.entries.map(({ name }) => name),
    ['Huge'],
  );
  assert.deepEqual(first.omitted, ['Button']);

  // Four entries of 4096 bytes each come to 16,389 bytes as a list.
  const four = ['Fit 0', 'Fit 1', 'Fit 2', 'Fit 3'].map((name) => {
    const jsx = '<Button></Button>';
    const rest = bytes({ name, uses: ['Button'], icons: [], jsx, note: null, props: [] });
    return entry(name, `<Button>${'x'.repeat(4096 - rest)}</Button>`);
  });
  const read = readCatalogEntries(files(four), undefined);
  assert.ok(read.entries.every((one) => bytes(one) === 4096));
  assert.deepEqual(read.omitted, ['Fit 3']);
  assert.ok(bytes(read.entries) <= 16 * 1024);
});

test('a catalog read keeps the names it leaves out within its budget', () => {
  const name = (index: number) => `${'n'.repeat(76)} ${String(index).padStart(3, '0')}`;
  const many = Array.from({ length: 100 }, (_, index) =>
    entry(name(index), `<Button>${'x'.repeat(400)}</Button>`),
  );
  const read = readCatalogEntries(starterWith(catalogFile(many)).files, undefined);
  assert.ok(read.omitted && read.omitted.length > 50);
  assert.equal(read.entries.length + read.omitted.length, many.length);
  assert.ok(Buffer.byteLength(JSON.stringify(read), 'utf8') <= 16 * 1024);
});
