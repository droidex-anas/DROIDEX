import assert from 'node:assert/strict';
import fsPromises, { mkdir, mkdtemp, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { kitModes } from './designSystemDocument.js';
import { unmappedKitTokens } from './designSystemImport.js';
import { importProjectDesignSystem, type ProjectSource } from './designSystemProject.js';

const KIT = { id: 'acme', name: 'Acme' };

async function project(t: TestContext, files: Record<string, string>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'kit-project-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'acme-web');
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

test('a Tailwind config and its CSS variables make one kit that names the files it read', async (t) => {
  const root = await project(t, {
    'tailwind.config.js': `module.exports = {
  theme: {
    extend: {
      colors: { primary: 'hsl(var(--primary))', chart: palette.chart },
      borderRadius: { lg: '14px' },
      boxShadow: { sm: 'var(--shadow-sm)' },
    },
  },
};`,
    'src/index.css': `:root {
  --primary: 222 47% 11%;
  --brand-ink: #2b2118;
  --accent: 210 40% 96%;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.1);
}
.dark {
  --primary: 210 40% 98%;
}`,
  });
  const sources: ProjectSource[] = [
    { path: './tailwind.config.js', kind: 'tailwind' },
    { path: 'src/index.css', kind: 'css' },
  ];
  const imported = await importProjectDesignSystem(root, sources, KIT);
  assert.equal(imported.status, 'imported');
  const { system, diagnostics } = imported;
  assert.deepEqual(system.provenance, {
    project: { name: 'acme-web', files: ['tailwind.config.js', 'src/index.css'] },
  });
  const modes = kitModes(system.sections);
  assert.equal(modes.light['--ds-accent'], 'hsl(222 47% 11%)');
  assert.equal(modes.dark['--ds-accent'], 'hsl(210 40% 98%)');
  assert.equal(modes.light['--ds-radius-lg'], '14px');
  // The config's shadow reads the stylesheet's token of the same name.
  assert.equal(modes.dark['--ds-shadow-sm'], '0 1px 2px rgb(0 0 0 / 0.1)');
  // Other tokens keep their names in the kit's namespace, the config's colour
  // beside the CSS token it reads; one whose --ds- name is a primitive's keeps its own.
  assert.deepEqual(unmappedKitTokens(system), ['--accent', '--ds-brand-ink', '--ds-color-primary']);
  assert.equal(modes.dark['--ds-color-primary'], 'hsl(210 40% 98%)');
  assert.deepEqual(
    diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`),
    ['manual_interpretation_required tailwind.config.js:4'],
  );
});

test('a token module and a token file read their literals, per mode, and name what they skip', async (t) => {
  const root = await project(t, {
    'src/themeTokens.ts': `export const SKILL_COLORS = {
  dark: '#93c5fd',
  light: '#1d4ed8',
} as const;

const STATUS_COLORS = {
  success: { dark: '#4fae82', light: '#1f7a4d' },
};

export const DURATION_QUICK = '150ms';
export const computed = buildTokens(source);
`,
    'tokens.json': JSON.stringify({
      name: 'Acme',
      color: {
        themes: [{ id: 'dark' }, { id: 'light' }],
        tokens: [
          { name: 'brand-ink', value: { dark: '#0a0a0a', light: '#f8f7f4' }, usage: 'Text.' },
          { name: 'space-0.5', value: '2px' },
        ],
      },
      size: { tokens: [{ name: 'brand-ink', value: '480px' }] },
    }),
  });
  const imported = await importProjectDesignSystem(
    root,
    [
      { path: 'src/themeTokens.ts', kind: 'tokens' },
      { path: 'tokens.json', kind: 'tokens' },
    ],
    KIT,
  );
  assert.equal(imported.status, 'imported');
  const modes = kitModes(imported.system.sections);
  assert.equal(modes.dark['--ds-skill-colors'], '#93c5fd');
  assert.equal(modes.light['--ds-skill-colors'], '#1d4ed8');
  assert.equal(modes.dark['--ds-status-colors-success'], '#4fae82');
  assert.equal(modes.light['--ds-status-colors-success'], '#1f7a4d');
  assert.equal(modes.light['--ds-duration-quick'], '150ms');
  assert.equal(modes.dark['--ds-brand-ink'], '#0a0a0a');
  assert.equal(modes.light['--ds-space-0-5'], '2px');
  // A record name another value already holds widens by its family.
  assert.equal(modes.light['--ds-size-brand-ink'], '480px');
  // The computed binding, the mode list and the rename are reported, not dropped quietly.
  assert.deepEqual(
    imported.diagnostics.map(
      ({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`,
    ),
    [
      'manual_interpretation_required src/themeTokens.ts:11',
      'manual_interpretation_required tokens.json:1',
      'renamed_token tokens.json:1',
    ],
  );
});

test('a computed binding ends at its statement, so the bindings after it are still read', async (t) => {
  const root = await project(t, {
    'src/tokens.ts': `export const derived = buildTokens(source);
export const palette = { brand: '#123456' };
export const easing = curves.standard
export const DURATION_QUICK = '150ms'
`,
  });
  const imported = await importProjectDesignSystem(
    root,
    [{ path: 'src/tokens.ts', kind: 'tokens' }],
    KIT,
  );
  assert.equal(imported.status, 'imported');
  const modes = kitModes(imported.system.sections);
  assert.equal(modes.light['--ds-palette-brand'], '#123456');
  assert.equal(modes.light['--ds-duration-quick'], '150ms');
  assert.deepEqual(
    imported.diagnostics.map(({ code, line }) => `${code} ${String(line ?? '')}`),
    ['manual_interpretation_required 1', 'manual_interpretation_required 3'],
  );
});

test('a family that sets a taken name per mode is renamed, and one it cannot rename is refused', async (t) => {
  const read = async (tokens: unknown) => {
    const root = await project(t, { 'tokens.json': JSON.stringify(tokens) });
    return importProjectDesignSystem(root, [{ path: 'tokens.json', kind: 'tokens' }], KIT);
  };
  const imported = await read({
    size: { tokens: [{ name: 'brand-ink', value: '480px' }] },
    color: { tokens: [{ name: 'brand-ink', value: { dark: '#0a0a0a', light: '#f8f7f4' } }] },
  });
  assert.equal(imported.status, 'imported');
  const modes = kitModes(imported.system.sections);
  assert.equal(modes.dark['--ds-brand-ink'], '480px');
  assert.equal(modes.light['--ds-color-brand-ink'], '#f8f7f4');
  assert.equal(modes.dark['--ds-color-brand-ink'], '#0a0a0a');
  assert.deepEqual(
    imported.diagnostics.map(({ code }) => code),
    ['renamed_token'],
  );
  // `color-primary` already starts with its family, so it has no wider name.
  const clash = await read({
    size: { tokens: [{ name: 'color-primary', value: '4px' }] },
    color: { primary: { light: '#ffffff', dark: '#000000' } },
  });
  assert.equal(clash.status, 'refused');
  assert.equal(clash.diagnostics.at(0)?.code, 'ambiguous_token');
});

test('a project file outside the folder, behind a link, too large or not text is refused', async (t) => {
  const root = await project(t, {
    'src/index.css': ':root { --primary: #123456; }',
    'big.css': `:root { --pad: 1px; }\n/*${'x'.repeat(256 * 1024)}*/`,
    'latin1.css': '',
  });
  const outside = await project(t, { 'secret.css': ':root { --leak: #000; }' });
  await writeFile(join(root, 'latin1.css'), Buffer.from([0x2f, 0x2a, 0xe9, 0x2a, 0x2f]));
  await symlink(join(outside, 'secret.css'), join(root, 'theme.css'));
  await symlink(outside, join(root, 'vendor'));
  const css = (path: string): ProjectSource => ({ path, kind: 'css' });

  const refusals: [ProjectSource[], RegExp][] = [
    [[css('../acme-web/src/index.css')], /leaves the project folder/],
    [[css('src\\..\\..\\secret.css')], /leaves the project folder/],
    [[css(join(root, 'src/index.css'))], /is absolute/],
    [[css('theme.css')], /theme\.css is a symbolic link/],
    [[css('vendor/secret.css')], /vendor\/secret\.css leaves the project folder/],
    [[css('big.css')], /big\.css is over 256 KiB/],
    [[css('latin1.css')], /latin1\.css is not UTF-8 text/],
    [[css('src')], /src is not a regular file/],
    [[css('src/index.css'), css('src//index.css')], /src\/index\.css is named twice/],
    [Array.from({ length: 9 }, (_, index) => css(`${String(index)}.css`)), /at most 8 project/],
  ];
  // Two spellings of one file, where the disk ignores case.
  const ignoresCase = await stat(join(root, 'SRC/INDEX.CSS')).then(
    () => true,
    () => false,
  );
  if (ignoresCase)
    refusals.push([[css('src/index.css'), css('SRC/INDEX.CSS')], /SRC\/INDEX\.CSS is named twice/]);
  for (const [sources, message] of refusals) {
    const result = await importProjectDesignSystem(root, sources, KIT);
    assert.equal(result.status, 'refused', sources[0].path);
    assert.equal(result.diagnostics[0].code, 'invalid_input');
    assert.match(result.diagnostics[0].message, message);
  }
});

test('a folder swapped for a link after the path checks is not read through', async (t) => {
  const root = await project(t, { 'nested/theme.css': ':root { --inside: #123456; }' });
  const outside = await project(t, { 'theme.css': ':root { --outside: #abcdef; }' });
  const open = fsPromises.open.bind(fsPromises);
  // Lands between the checks and the open, as a racing writer in the project could.
  const swap = t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof open>) => {
    swap.mock.restore();
    syncBuiltinESMExports();
    await rename(join(root, 'nested'), join(root, 'moved'));
    await symlink(outside, join(root, 'nested'));
    return open(...args);
  });
  syncBuiltinESMExports();
  t.after(syncBuiltinESMExports);

  const result = await importProjectDesignSystem(
    root,
    [{ path: 'nested/theme.css', kind: 'css' }],
    KIT,
  );
  assert.equal(swap.mock.callCount(), 1);
  assert.equal(result.status, 'refused');
  assert.match(result.diagnostics[0].message, /nested\/theme\.css changed while it was being read/);
});

test('a token that fails in one mode is reported where that mode sets it', async (t) => {
  const root = await project(t, {
    'light.css': ':root[data-mode="light"] { --brand: #123456; }',
    'dark.css': ':root[data-mode="dark"] { --brand: var(--missing); }',
  });
  const css = (path: string): ProjectSource => ({ path, kind: 'css' });
  const result = await importProjectDesignSystem(root, [css('light.css'), css('dark.css')], KIT);
  assert.deepEqual(
    result.diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`),
    ['unusable_value dark.css:1'],
  );
});
