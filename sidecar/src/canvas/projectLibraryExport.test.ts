import assert from 'node:assert/strict';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { LIBRARY, project } from '../testing/shadcnLibraryFixture.js';
import { kitModes } from './designSystemDocument.js';
import { importProjectDesignSystem } from './designSystemProject.js';
import type { DesignSystem } from './designSystems.js';
import { SAMPLE_KIT } from '../testing/sampleKit.js';
import { libraryExport } from './projectLibraryExport.js';

async function libraryKit(t: TestContext): Promise<{ root: string; kit: DesignSystem }> {
  const root = await project(t, LIBRARY);
  const imported = await importProjectDesignSystem(
    root,
    [{ path: 'components.json', kind: 'shadcn' }],
    { id: 'acme', name: 'Acme' },
  );
  assert.equal(imported.status, 'imported');
  return { root, kit: { ...imported.system, version: 1 } };
}

const MAIN = `import { Button, Card as Panel } from '@droidex/design-system';
import { Note } from './note';

export default function Hey() {
  return (
    <Panel style={{ color: 'var(--ds-primary)', borderRadius: 'var(--ds-radius)', background: 'var(--ds-danger)' }}>
      <Note />
      <Button className="bg-[var(--ds-accent)]">Go</Button>
    </Panel>
  );
}
`;

const SOURCE = new Map([
  ['main.tsx', MAIN],
  [
    'note.tsx',
    `import { CardTitle } from '@droidex/design-system';\nexport const Note = () => <CardTitle>Hi</CardTitle>;\n`,
  ],
  ['note.css', '.note { color: var(--ds-fg, black); border-color: var(--ds-border); }\n'],
]);

test("an export to the library's project imports its components and reads its tokens", async (t) => {
  const { root, kit } = await libraryKit(t);
  const exported = await libraryExport(root, kit, SOURCE);
  assert.equal(exported?.status, 'rewritten');
  const files = new Map(exported.files.map(({ path, content }) => [path, String(content)]));
  assert.deepEqual(
    [...files.keys()],
    [
      'src/main.tsx',
      'src/note.tsx',
      'src/note.css',
      'canvas-export/tokens.css',
      'canvas-export/guidance.md',
      'README.md',
    ],
  );

  assert.equal(
    files.get('src/main.tsx'),
    `import { Button } from '@/components/ui/button';
import { Card as Panel } from '@/components/ui/card';
import { Note } from './note';

export default function Hey() {
  return (
    <Panel style={{ color: 'hsl(var(--primary))', borderRadius: 'var(--radius)', background: 'var(--ds-danger)' }}>
      <Note />
      <Button className="bg-[hsl(var(--primary))]">Go</Button>
    </Panel>
  );
}
`,
  );
  assert.match(
    files.get('src/note.tsx') ?? '',
    /^import \{ CardTitle \} from '@\/components\/ui\/card';$/m,
  );
  // Bare channels behind a fallback cannot read as a colour, so that one keeps the kit's token.
  assert.equal(
    files.get('src/note.css'),
    '.note { color: var(--ds-fg, black); border-color: hsl(var(--border)); }\n',
  );

  // The tokens the project lacks keep the kit's values.
  const { light, dark } = kitModes(kit.sections);
  const tokensCss = files.get('canvas-export/tokens.css') ?? '';
  assert.match(
    tokensCss,
    new RegExp(`^:root \\{\\n  --ds-danger: ${light['--ds-danger']};\\n  --ds-fg: `),
  );
  assert.match(tokensCss, new RegExp(`\\.dark \\{\\n  --ds-danger: ${dark['--ds-danger']};`));

  const readme = files.get('README.md') ?? '';
  assert.match(
    readme,
    /exported into acme-web to build with\nthe project's own shadcn\/ui components/,
  );
  assert.match(readme, /through the `@\/components\/ui` alias in `components\.json`/);
  assert.match(readme, /^\| `Card` \| `@\/components\/ui\/card` \|$/m);
  assert.match(readme, /^\| `--ds-primary` \| `hsl\(var\(--primary\)\)` \|$/m);
  assert.match(readme, /^\| `--ds-radius` \| `var\(--radius\)` \|$/m);
  assert.match(
    readme,
    /`canvas-export\/tokens\.css` sets\ntheir kit values, light on `:root` and dark on `\.dark`: `--ds-danger`, `--ds-fg`\./,
  );
  assert.doesNotMatch(readme, /design-system\/|npm install/);
});

test('the export copies the kit and says why when the library is not as the kit found it', async (t) => {
  const { root, kit } = await libraryKit(t);
  const reason = async (source = SOURCE) => {
    const exported = await libraryExport(root, kit, source);
    assert.equal(exported?.status, 'copied');
    assert.match(exported.readme, /^## Why the kit is copied$/m);
    return exported.readme;
  };

  const whole = new Map([
    ...SOURCE,
    [
      'main.tsx',
      `import * as Kit from '@droidex/design-system';\nexport default () => <Kit.Button />;\n`,
    ],
  ]);
  assert.match(
    await reason(whole),
    /src\/main\.tsx imports from @droidex\/design-system other than values by name\./,
  );
  const reexported = new Map([
    ...SOURCE,
    ['main.tsx', `export { Button } from '@droidex/design-system';\n`],
  ]);
  assert.match(
    await reason(reexported),
    /src\/main\.tsx uses @droidex\/design-system other than in an import\./,
  );

  // A default export in place of the named ones is not the kit's Card or CardTitle.
  const card = LIBRARY['components/ui/card.tsx'];
  await writeFile(
    join(root, 'components/ui/card.tsx'),
    'export default function Unrelated() {\n  return null;\n}\n',
  );
  assert.match(await reason(), /components\/ui\/card\.tsx is not the component the kit copied/);
  await rm(join(root, 'components/ui/card.tsx'));
  assert.match(await reason(), /components\/ui\/card\.tsx/);
  await writeFile(join(root, 'components/ui/card.tsx'), card);

  await writeFile(join(root, 'app/globals.css'), ':root {\n  --primary: 0 0% 9%;\n');
  assert.match(await reason(), /app\/globals\.css: /);
  await rm(join(root, 'components.json'));
  assert.match(await reason(), /components\.json/);

  assert.equal(await libraryExport(root, SAMPLE_KIT, SOURCE), null);
});

test("the export reads the library's ui folder, not the cn() helper the kit copied", async (t) => {
  const { root, kit } = await libraryKit(t);
  await rename(join(root, 'lib/utils.ts'), join(root, 'lib/utils.tsx'));
  assert.equal((await libraryExport(root, kit, SOURCE))?.status, 'rewritten');
});

test('the export copies the kit into another project whose components differ from its copies', async (t) => {
  const { kit } = await libraryKit(t);
  const card = LIBRARY['components/ui/card.tsx'].replace('rounded-xl', 'rounded-lg');
  const other = await project(t, { ...LIBRARY, 'components/ui/card.tsx': card });
  const exported = await libraryExport(other, kit, SOURCE);
  assert.equal(exported?.status, 'copied');
  assert.match(
    exported.readme,
    /components\/ui\/card\.tsx is not the component the kit copied: it changed since the kit was made, or this is another project\./,
  );
});
