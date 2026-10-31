import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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
  // The config's own colour keeps its name beside the CSS token it reads.
  assert.deepEqual(unmappedKitTokens(system), ['--brand-ink', '--color-primary']);
  assert.equal(modes.dark['--color-primary'], 'hsl(210 40% 98%)');
  assert.deepEqual(
    diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`),
    ['manual_interpretation_required tailwind.config.js:4'],
  );
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
  for (const [sources, message] of refusals) {
    const result = await importProjectDesignSystem(root, sources, KIT);
    assert.equal(result.status, 'refused', sources[0].path);
    assert.equal(result.diagnostics[0].code, 'invalid_input');
    assert.match(result.diagnostics[0].message, message);
  }
});
