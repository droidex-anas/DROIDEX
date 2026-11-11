import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { COMPONENTS_JSON, LIBRARY, project } from '../testing/shadcnLibraryFixture.js';
import { ownedCanvasRuntimeDir, startCanvasRuntime, stopCanvasRuntime } from './canvasRuntime.js';
import { kitPrimitives } from './designSystemBrief.js';
import { MAX_LIBRARY_COMPONENTS, TAILWIND_4_REFUSAL } from './designSystemLibrary.js';
import { importProjectDesignSystem } from './designSystemProject.js';
import { exportDesignSystem } from './designSystemExport.js';
import { MAX_LIBRARY_SKIPS } from './designSystemProvenance.js';
import { saveDesignSystem } from './designSystems.js';
import { buildDesignStylesheet } from './designStylesheet.js';
import { KitPreviews } from './kitPreviews.js';

pinScratchProfile();
after(() => stopCanvasRuntime());

const KIT = { id: 'acme', name: 'Acme' };
const SHADCN = [{ path: 'components.json', kind: 'shadcn' as const }];

test('a shadcn/ui library becomes a kit of its own components, tokens and theme that builds', async (t) => {
  const imported = await importProjectDesignSystem(await project(t, LIBRARY), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { system, diagnostics } = imported;
  assert.deepEqual(kitPrimitives(system), [
    'Button',
    'buttonVariants',
    'Card',
    'CardTitle',
    'Dialog',
    'DialogContent',
  ]);
  const { project: source } = system.provenance as Extract<
    typeof system.provenance,
    { project: unknown }
  >;
  assert.deepEqual(source.files, [
    'components.json',
    'app/globals.css',
    'tailwind.config.ts',
    'tsconfig.json',
    'lib/utils.ts',
  ]);
  assert.equal(source.library?.components.DialogContent, 'components/ui/dialog.tsx');
  assert.equal(source.library?.tokens['--ds-primary'], '--primary');
  assert.equal(source.library?.tokens['--ds-radius'], '--radius');
  assert.deepEqual(source.library?.skipped, [
    {
      file: 'components/ui/notice.tsx',
      reason: 'needs_left_out',
      detail: 'components/ui/sonner.tsx',
    },
    { file: 'components/ui/sonner.tsx', reason: 'unsupported_import', detail: 'next-themes' },
  ]);
  assert.equal(source.library?.skippedCount, 2);

  // Aliases point at the kit's own files, and the server directive is gone.
  const dialog = system.files['components/ui/dialog.tsx'];
  assert.match(dialog, /from "\.\.\/\.\.\/lib\/utils"/);
  assert.match(dialog, /import \{ buttonVariants \} from "\.\/button"/);
  assert.doesNotMatch(dialog, /use client|@\//);
  const theme = JSON.parse(system.files['tailwind.theme.json']) as Record<
    string,
    Record<string, string>
  >;
  assert.equal(theme.colors.primary, 'var(--ds-primary)');
  assert.equal(theme.colors['primary-foreground'], 'var(--ds-primary-foreground)');
  assert.equal(theme.borderRadius.md, 'calc(var(--ds-radius) - 2px)');
  const styles = system.files['styles.css'];
  assert.doesNotMatch(styles, /@tailwind|--primary|:root/);
  assert.match(styles, /@apply border-border/);

  assert.deepEqual(
    diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`),
    [
      'manual_interpretation_required tailwind.config.ts:25',
      'manual_interpretation_required tailwind.config.ts:',
      'unsupported_import components/ui/sonner.tsx:',
      'unsupported_import components/ui/notice.tsx:',
    ],
  );
  assert.match(diagnostics[0].message, /^theme\.extend\.fontFamily\.sans is computed/);
  assert.match(diagnostics[1].message, /theme\.extend\.keyframes, theme\.extend\.animation/);
  assert.match(diagnostics[2].message, /imports next-themes/);

  const previews = new KitPreviews();
  t.after(() => previews.close());
  assert.deepEqual(await previews.check(system), []);
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const built = await buildDesignStylesheet({}, system);
  assert.ok(built.ok);
  assert.match(built.css, /\.bg-primary\s*\{[^}]*var\(--ds-primary\)/);
  assert.match(built.css, /\.rounded-md\s*\{[^}]*calc\(var\(--ds-radius\) - 2px\)/);
});

test('copied rules and components read the kit tokens, even where --border and --ds-border both exist', async (t) => {
  const files = {
    ...LIBRARY,
    'app/globals.css':
      LIBRARY['app/globals.css'].replace(
        '--radius: 0.5rem;',
        `--radius: 0.5rem;
    --ds-border: 0 0% 50%;`,
      ) + '.sample { color: hsl(var(--primary) / 0.5); border-color: hsl(var(--border)); }\n',
    'components/ui/badge.tsx': `export function Badge() {
  return <span className="bg-[hsl(var(--primary)/0.5)]" style={{ outlineColor: "hsl(var(--ds-border))" }} />
}
`,
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { system } = imported;
  assert.equal(imported.kitNames['--border'], '--border');
  assert.equal(imported.kitNames['--ds-border'], '--ds-border');
  assert.match(
    system.files['styles.css'],
    /\.sample \{ color: color-mix\(in srgb, var\(--ds-primary\) 50%, transparent\); border-color: var\(--border\); \}/,
  );
  const badge = system.files['components/ui/badge.tsx'];
  assert.match(badge, /"bg-\[color-mix\(in_srgb,_var\(--ds-primary\)_50%,_transparent\)\]"/);
  assert.match(badge, /outlineColor: "var\(--ds-border\)"/);
  const built = await buildDesignStylesheet({}, system);
  assert.ok(built.ok);
  assert.match(built.css, /color-mix\(in srgb, var\(--ds-primary\) 50%, transparent\)/);
});

test('components are read by the parser, not their comments, strings or types, in every export form', async (t) => {
  const files = {
    ...LIBRARY,
    'components/ui/badge.tsx': `// Example: import { Foo } from 'outside-package'
import type { Theme } from "next-themes"
const label = "import x from 'elsewhere'"

  export function Badge({ theme }: { theme?: Theme }) {
    return <span>{label}{theme}</span>
  }
`,
    'components/ui/alert-dialog.tsx': `export default function () {
  return <div role="alertdialog" />
}
`,
    'components/ui/toggle.tsx': `export {
  default as AlertDialogRoot,
  type Missing,
} from "@/components/ui/alert-dialog"
`,
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { system, diagnostics } = imported;
  const primitives = kitPrimitives(system);
  for (const name of ['AlertDialog', 'AlertDialogRoot', 'Badge'])
    assert.ok(primitives.includes(name), name);
  assert.match(
    system.files['index.tsx'],
    /^export \{ default as AlertDialog \} from '\.\/components\/ui\/alert-dialog';$/m,
  );
  assert.match(system.files['components/ui/toggle.tsx'], /from "\.\/alert-dialog"/);
  assert.ok(!diagnostics.some((diagnostic) => diagnostic.file === 'components/ui/badge.tsx'));
  const previews = new KitPreviews();
  t.after(() => previews.close());
  assert.deepEqual(await previews.check(system), []);

  const unnamed = Object.fromEntries(
    Object.entries(LIBRARY).filter(([path]) => !path.startsWith('components/')),
  );
  unnamed['components/ui/hidden.tsx'] = 'const Hidden = () => <div />\n';
  const refused = await importProjectDesignSystem(await project(t, unnamed), SHADCN, KIT);
  assert.equal(refused.status, 'refused');
  assert.equal(
    refused.diagnostics[0].message,
    'No component in @/components/ui exports anything the kit recognises, starting with components/ui/hidden.tsx.',
  );
});

test('a library past the component bound keeps the first by name and lists the rest, up to its bound', async (t) => {
  // Without the two components left out, every one past the bound is a part.
  const files = Object.fromEntries(
    Object.entries(LIBRARY).filter(([path]) => !/\/(?:sonner|notice)\.tsx$/.test(path)),
  );
  const over = MAX_LIBRARY_SKIPS + 2;
  const parts = MAX_LIBRARY_COMPONENTS - 3 + over;
  for (let index = 0; index < parts; index += 1)
    files[`components/ui/part-${String(index).padStart(3, '0')}.tsx`] =
      `export function Part${String(index)}() {\n  return <div />\n}\n`;
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const copied = Object.keys(imported.system.files).filter((path) =>
    path.startsWith('components/'),
  );
  assert.equal(copied.length, MAX_LIBRARY_COMPONENTS);
  assert.ok(copied.includes('components/ui/button.tsx'));
  assert.match(imported.diagnostics[0].message, /leaves out part-\d+(?:, part-\d+)*\.$/);
  const { project: source } = imported.system.provenance as Extract<
    typeof imported.system.provenance,
    { project: unknown }
  >;
  const firstOver = parts - over;
  assert.equal(source.library?.skippedCount, over);
  assert.equal(source.library?.skipped.length, MAX_LIBRARY_SKIPS);
  assert.deepEqual(source.library?.skipped[0], {
    file: `components/ui/part-${String(firstOver).padStart(3, '0')}.tsx`,
    reason: 'over_limit',
    detail: null,
  });
});

test('a library import records each file it leaves out or keeps in part, once, the ones it never parses included', async (t) => {
  const files = {
    ...LIBRARY,
    'components/ui/1-up.tsx': 'export default function () {\n  return <div />\n}\n',
    'components/ui/ghost.tsx':
      'import { Missing } from "./missing"\n\nexport function Ghost() {\n  return <Missing />\n}\n',
    'components/ui/charts/bar.tsx': 'export function Bar() {\n  return <div />\n}\n',
    'components/ui/use-toast.ts': 'export function useToast() {}\n',
    'components/ui/date_picker.tsx': 'export function DatePicker() {\n  return <div />\n}\n',
    'components/ui/.DS_Store': '',
    'components/ui/huge.tsx': `// ${'x'.repeat(256 * 1024)}\n`,
    'components/ui/hidden.tsx': 'const Hidden = () => <div />\n',
    'components/ui/big-button.tsx':
      'export function Button() {\n  return <button />\n}\n\nexport const buttonVariants = () => ""\n',
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { project: source } = imported.system.provenance as Extract<
    typeof imported.system.provenance,
    { project: unknown }
  >;
  const skip = (file: string, reason: string, detail: string | null = null) => ({
    file: `components/ui/${file}`,
    reason,
    detail,
  });
  assert.deepEqual(source.library?.skipped, [
    skip('1-up.tsx', 'no_exports'),
    skip('button.tsx', 'duplicate_export', 'Button, buttonVariants'),
    skip('charts', 'not_a_component'),
    skip('date_picker.tsx', 'not_a_component'),
    skip('ghost.tsx', 'unsupported_import', 'components/ui/missing'),
    skip('hidden.tsx', 'no_exports'),
    skip('huge.tsx', 'unreadable'),
    skip('notice.tsx', 'needs_left_out', 'components/ui/sonner.tsx'),
    skip('sonner.tsx', 'unsupported_import', 'next-themes'),
    skip('use-toast.ts', 'not_a_component'),
  ]);
  assert.equal(source.library?.skippedCount, 7);
  assert.equal(source.library?.partialCount, 3);
  assert.equal(source.library?.components.Button, 'components/ui/big-button.tsx');
  for (const kept of ['1-up', 'button', 'hidden'])
    assert.ok(Object.hasOwn(imported.system.files, `components/ui/${kept}.tsx`), kept);
});

test('a left-out import is recorded short and without a host path, and the kit exports without it', async (t) => {
  const files = {
    ...LIBRARY,
    'components/ui/host.tsx':
      "import { Host } from '/Users/example-person/private-customer/src/Host'\nexport { Host }\n",
    'components/ui/drive.tsx':
      "import { Drive } from 'C:\\\\Users\\\\example-person\\\\Drive'\nexport { Drive }\n",
    'components/ui/url.tsx':
      "import { Url } from 'file:///Users/example-person/Url.tsx'\nexport { Url }\n",
    'components/ui/long.tsx': `import { Long } from '${'x'.repeat(1025)}'\nexport { Long }\n`,
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  assert.ok(kitPrimitives(imported.system).includes('Card'));
  const { project: source } = imported.system.provenance as Extract<
    typeof imported.system.provenance,
    { project: unknown }
  >;
  const details = Object.fromEntries(
    (source.library?.skipped ?? []).map(({ file, detail }) => [file.split('/').at(-1), detail]),
  );
  assert.deepEqual(details, {
    'drive.tsx': '…/Drive',
    'host.tsx': '…/Host',
    'long.tsx': `${'x'.repeat(199)}…`,
    'notice.tsx': 'components/ui/sonner.tsx',
    'sonner.tsx': 'next-themes',
    'url.tsx': '…/Url.tsx',
  });

  await saveDesignSystem(imported.system, {
    mutationId: 'library-export',
    baseVersion: null,
    savedBy: { actor: 'user' },
  });
  const destination = await mkdtemp(join(tmpdir(), 'library-export-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await exportDesignSystem({ id: KIT.id, version: imported.system.version }, destination);
  const document = await readFile(join(destination, 'document.json'), 'utf8');
  assert.match(document, /…\/Host/);
  assert.doesNotMatch(document, /example-person/);
});

test('aliases map as TypeScript reads them, and theme values the kit cannot keep whole are reported', async (t) => {
  const files: Record<string, string> = {
    ...LIBRARY,
    'tsconfig.json':
      '{ "compilerOptions": { "paths": { "@/*": ["./*"], "@/components/*": ["./custom/*"] } } }',
    'custom/ui/card.tsx': LIBRARY['components/ui/card.tsx'],
    // A Tailwind 3 project may still name Tailwind 4's at-rules in a comment.
    'package.json': JSON.stringify({ devDependencies: { tailwindcss: '^3.4.17' } }),
    'app/globals.css': `/* Tailwind 4 moves these into @theme. */\n${LIBRARY['app/globals.css']}`,
    'tailwind.config.ts': LIBRARY['tailwind.config.ts'].replace(
      'extend: {',
      'fontSize: { sm: ["0.8rem", { lineHeight: "1.8rem" }] },\n    extend: {',
    ),
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  assert.deepEqual(kitPrimitives(imported.system), ['Card', 'CardTitle']);
  const theme = JSON.parse(imported.system.files['tailwind.theme.json']) as Record<
    string,
    Record<string, string>
  >;
  assert.equal(theme.fontSize.sm, '0.8rem');
  assert.ok(
    imported.diagnostics.some(
      ({ message, line }) =>
        line === 8 && message.startsWith('theme.fontSize.sm keeps only its first value'),
    ),
  );

  const computed = {
    ...LIBRARY,
    'tailwind.config.ts': 'export default { theme: { extend: shared } }\n',
  };
  const unread = await importProjectDesignSystem(await project(t, computed), SHADCN, KIT);
  assert.equal(unread.status, 'imported');
  assert.ok(
    unread.diagnostics.some(({ message }) => message.startsWith('theme.extend is computed')),
  );
});

test('a library the canvas cannot build a kit from is refused, saying why', async (t) => {
  const tailwind4 = {
    ...LIBRARY,
    'components.json': JSON.stringify({
      ...COMPONENTS_JSON,
      tailwind: { config: '', css: 'app/globals.css' },
    }),
    'app/globals.css': '@import "tailwindcss";\n',
  };
  const unmapped = { ...LIBRARY, 'tsconfig.json': '{ "compilerOptions": {} }' };
  const tailwind = (options: object) => ({
    ...LIBRARY,
    'components.json': JSON.stringify({
      ...COMPONENTS_JSON,
      tailwind: { ...COMPONENTS_JSON.tailwind, ...options },
    }),
  });
  const nested = `${'{ a: '.repeat(40)}"x"${' }'.repeat(40)}`;
  const refusals: [
    Record<string, string>,
    typeof SHADCN | { path: string; kind: 'css' | 'shadcn' }[],
    string,
  ][] = [
    [tailwind4, SHADCN, TAILWIND_4_REFUSAL],
    [{ ...LIBRARY, 'app/globals.css': '@import "tailwindcss";\n' }, SHADCN, TAILWIND_4_REFUSAL],
    [
      {
        ...LIBRARY,
        'package.json': JSON.stringify({ devDependencies: { tailwindcss: '^4.1.0' } }),
      },
      SHADCN,
      TAILWIND_4_REFUSAL,
    ],
    [
      tailwind({ prefix: 'tw-' }),
      SHADCN,
      'components.json sets tailwind.prefix to "tw-", and a kit\'s classes take no prefix. Import a library that sets none.',
    ],
    [
      tailwind({ cssVariables: false }),
      SHADCN,
      "components.json sets tailwind.cssVariables to false, and a kit's tokens are the stylesheet's CSS variables. Import a library that keeps them.",
    ],
    [
      { ...LIBRARY, 'tailwind.config.ts': `export default { theme: { colors: ${nested} } }\n` },
      SHADCN,
      'tailwind.config.ts nests its theme deeper than the canvas reads. Flatten its theme to import the library.',
    ],
    [
      { ...LIBRARY, 'app/globals.css': ':root {\n  --primary: 0 0% 9%;\n' },
      SHADCN,
      'Fix this stylesheet at line 1: Unclosed block.',
    ],
    [unmapped, SHADCN, "tsconfig.json's paths do not say where @/components/ui points."],
    [
      LIBRARY,
      [...SHADCN, { path: 'app/globals.css', kind: 'css' }],
      'Name components.json alone: it names every file a shadcn/ui kit reads.',
    ],
  ];
  for (const [files, sources, message] of refusals) {
    const result = await importProjectDesignSystem(await project(t, files), sources, KIT);
    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0].message, message);
  }
});
