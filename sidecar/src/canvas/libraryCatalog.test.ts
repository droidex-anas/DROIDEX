import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { KIT_CATALOG_FILE, readKitCatalog, type KitFailure } from './kitCatalog.js';
import {
  LIBRARY_CATALOG_NOTICE,
  LIBRARY_DEMOS,
  leaveOutFailingSeeds,
  libraryCatalogFiles,
} from './libraryCatalog.js';
import seeds from './libraryCatalogSeeds.json' with { type: 'json' };
import type { LibraryComponent } from './libraryComponents.js';
import { moduleDeclarations } from './moduleDeclarations.js';
import type { CanvasDiagnostic } from './protocol.js';

const BUTTON = 'components/ui/button.tsx';
const SEPARATOR = 'components/ui/separator.tsx';

function libraryFiles(entry: string, modules: string[]) {
  return {
    'index.tsx': entry,
    ...Object.fromEntries(modules.map((module) => [module, 'export {};\n'])),
  };
}

const DEMOS = LIBRARY_DEMOS.map((jsx) => moduleDeclarations(jsx).elements);

function component(name: string, text = 'export {};\n'): LibraryComponent {
  return { name, file: `src/components/ui/${name}.tsx`, text, module: moduleDeclarations(text) };
}

const EXPORTED = {
  Button: 'src/components/ui/button.tsx',
  Separator: 'src/components/ui/separator.tsx',
};

function seeded(
  files: Record<string, string>,
  library = [component('button'), component('separator')],
) {
  const diagnostics: CanvasDiagnostic[] = [];
  return { ...libraryCatalogFiles(files, library, EXPORTED, DEMOS, diagnostics), diagnostics };
}

function catalogOf(files: Record<string, string>) {
  const read = readKitCatalog(files);
  assert.ok('catalog' in read);
  return read.catalog;
}

test('a shadcn demo seeds the catalog only when the kit kept its module and exports every name it uses', () => {
  const both = `export { Button, buttonVariants } from './components/ui/button';\nexport { Separator } from './components/ui/separator';\n`;
  const files = libraryFiles(both, [BUTTON, SEPARATOR]);
  const catalog = catalogOf({ ...files, ...seeded(files).files });
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
    catalogOf({ ...buttonFiles, ...seeded(buttonFiles).files }).map(({ name }) => name),
    ['Button'],
  );
  const buttonOnly = `export { Button } from './components/ui/button';\n`;
  assert.deepEqual(seeded(libraryFiles(buttonOnly, [SEPARATOR])).files, {});
});

test("the demos carry shadcn/ui's MIT notice, the same one NOTICE carries", () => {
  const files = libraryFiles(`export { Button } from './components/ui/button';\n`, [BUTTON]);
  const notice = seeded(files).files[LIBRARY_CATALOG_NOTICE];
  assert.match(
    notice,
    /shadcn\/ui\s+\(https:\/\/github\.com\/shadcn-ui\/ui, commit [0-9a-f]{40}\)/,
  );
  assert.ok(notice.endsWith(seeds.license));
  const repositoryNotice = readFileSync(new URL('../../../NOTICE', import.meta.url), 'utf8');
  for (const line of seeds.license.trim().split('\n'))
    assert.ok(repositoryNotice.includes(line), `NOTICE lacks "${line}"`);
});

const buttonSource = (variants: string) => `import { cva } from "class-variance-authority";

const buttonVariants = cva("inline-flex", {
  variants: { variant: { ${variants} }, size: { default: "h-9", icon: "size-9" } },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button() {
  return buttonVariants();
}

export { buttonVariants };
`;

test("a demo offers its first used component's variants, each defaulting to what it writes", () => {
  const files = libraryFiles(`export { Button } from './components/ui/button';\n`, [BUTTON]);
  const library = [component('button', buttonSource('default: "a", outline: "b", ghost: "c"'))];
  const [button] = catalogOf({ ...files, ...seeded(files, library).files });
  assert.deepEqual(button.props, [
    { name: 'variant', options: ['default', 'outline', 'ghost'], default: 'outline' },
    { name: 'size', options: ['default', 'icon'], default: 'default' },
  ]);
});

test("a demo giving a variant the library's cva does not define is left out, with a review record", () => {
  const files = libraryFiles(`export { Button } from './components/ui/button';\n`, [BUTTON]);
  const library = [component('button', buttonSource('default: "a", ghost: "c"'))];
  const { files: catalog, skipped, diagnostics } = seeded(files, library);
  assert.deepEqual(catalog, {});
  const detail = `Its demo gives Button variant="outline", which the library's Button does not define.`;
  assert.deepEqual(skipped, [
    { file: 'src/components/ui/button.tsx', reason: 'demo_left_out', detail },
  ]);
  assert.deepEqual(diagnostics, [
    {
      code: 'invalid_input',
      message: `catalog.json, Button: ${detail} The catalog leaves this demo out.`,
      file: KIT_CATALOG_FILE,
    },
  ]);
});

test('variants come only from the table the exported component itself uses, in the file the kit exports it from', () => {
  const files = libraryFiles(`export { Button } from './components/ui/button';\n`, [BUTTON]);
  const lacksOutline = buttonSource('default: "a", ghost: "c"');
  const unusedTable = [
    component('button', lacksOutline.replace('return buttonVariants();', 'return null;')),
  ];
  const unused = seeded(files, unusedTable);
  assert.deepEqual(unused.skipped, []);
  assert.equal(catalogOf({ ...files, ...unused.files })[0].props, undefined);

  // A file the kit does not export Button from, listed first, gives it nothing.
  const elsewhere = [
    component('fancy', lacksOutline),
    component('button', buttonSource('default: "a", outline: "b"')),
  ];
  const kept = seeded(files, elsewhere);
  assert.deepEqual(kept.skipped, []);
  assert.deepEqual(
    catalogOf({ ...files, ...kept.files })[0].props?.map(({ name }) => name),
    ['variant', 'size'],
  );
});

test('a seed that does not build is left out with a diagnostic, and the catalog and notice go with the last one', () => {
  const entry = `export { Button } from './components/ui/button';\nexport { Separator } from './components/ui/separator';\n`;
  const files = libraryFiles(entry, [BUTTON, SEPARATOR]);
  const kit = { files: { ...files, ...seeded(files).files } };
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
  assert.ok(Object.hasOwn(one.kit.files, LIBRARY_CATALOG_NOTICE));
  assert.deepEqual(one.diagnostics, [
    {
      code: 'compile_failed',
      message: 'catalog.json, Separator: broken. The catalog leaves this demo out.',
      file: KIT_CATALOG_FILE,
    },
  ]);
  const all = leaveOutFailingSeeds(kit, failing(['Button', 'Separator']));
  assert.equal(Object.hasOwn(all.kit.files, KIT_CATALOG_FILE), false);
  assert.equal(Object.hasOwn(all.kit.files, LIBRARY_CATALOG_NOTICE), false);
});
