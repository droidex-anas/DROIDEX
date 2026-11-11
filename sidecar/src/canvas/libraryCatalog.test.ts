import assert from 'node:assert/strict';
import test from 'node:test';
import { KIT_CATALOG_FILE, readKitCatalog, type KitFailure } from './kitCatalog.js';
import { leaveOutFailingSeeds, libraryCatalogFiles } from './libraryCatalog.js';

const BUTTON = 'components/ui/button.tsx';
const SEPARATOR = 'components/ui/separator.tsx';

function libraryFiles(entry: string, modules: string[]) {
  return {
    'index.tsx': entry,
    ...Object.fromEntries(modules.map((module) => [module, 'export {};\n'])),
  };
}

function catalogOf(files: Record<string, string>) {
  const read = readKitCatalog(files);
  assert.ok('catalog' in read);
  return read.catalog;
}

test('a shadcn demo seeds the catalog only when the kit kept its module and exports every name it uses', () => {
  const both = `export { Button, buttonVariants } from './components/ui/button';\nexport { Separator } from './components/ui/separator';\n`;
  const files = libraryFiles(both, [BUTTON, SEPARATOR]);
  const catalog = catalogOf({ ...files, ...libraryCatalogFiles(files) });
  assert.deepEqual(
    catalog.map(({ name, module, uses }) => [name, module, uses]),
    [
      ['Button', BUTTON, ['Button']],
      ['Separator', SEPARATOR, ['Separator']],
    ],
  );
  assert.match(
    catalog[0].jsx,
    /^<div className="flex flex-wrap items-center gap-2 md:flex-row">\n {2}<Button variant="outline">/,
  );
  assert.deepEqual(catalog[0].icons, ['ArrowUpIcon']);

  // The separator module left out, then kept without its export.
  const buttonFiles = libraryFiles(both, [BUTTON]);
  assert.deepEqual(
    catalogOf({ ...buttonFiles, ...libraryCatalogFiles(buttonFiles) }).map(({ name }) => name),
    ['Button'],
  );
  const buttonOnly = `export { Button } from './components/ui/button';\n`;
  assert.deepEqual(libraryCatalogFiles(libraryFiles(buttonOnly, [SEPARATOR])), {});
});

test('a seed that does not build is left out with a diagnostic, and the catalog goes with the last one', () => {
  const entry = `export { Button } from './components/ui/button';\nexport { Separator } from './components/ui/separator';\n`;
  const files = libraryFiles(entry, [BUTTON, SEPARATOR]);
  const kit = { files: { ...files, ...libraryCatalogFiles(files) } };
  const failing = (names: string[]) =>
    names.map(
      (name): KitFailure => ({
        entry: name,
        diagnostic: {
          code: 'compile_failed',
          message: `catalog.json, ${name}: broken.`,
          file: KIT_CATALOG_FILE,
        },
      }),
    );

  const one = leaveOutFailingSeeds(kit, failing(['Separator']));
  assert.deepEqual(
    catalogOf(one.kit.files).map(({ name }) => name),
    ['Button'],
  );
  assert.deepEqual(one.diagnostics, [
    {
      code: 'compile_failed',
      message: 'catalog.json, Separator: broken. The catalog leaves this demo out.',
      file: KIT_CATALOG_FILE,
    },
  ]);
  const all = leaveOutFailingSeeds(kit, failing(['Button', 'Separator']));
  assert.equal(Object.hasOwn(all.kit.files, KIT_CATALOG_FILE), false);
});
