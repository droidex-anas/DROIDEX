import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { startBridgeServer } from '../bridgeServer.js';
import { errorOf, harness, okReply, type Harness } from '../testing/canvasBridgeSupport.js';
import { CompilerWorker } from './compiler.js';
import { exportDesignSystem } from './designSystemExport.js';
import { readDesignSystem } from './designSystems.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import type {
  CanvasDiagnostic,
  DesignSystemDetail,
  DesignSystemSource,
  DesignSystemVersionRef,
} from './protocol.js';

const DESIGN_MD = `# Paper and ink

Quiet warm surfaces with one confident accent.

\`\`\`css
:root {
  --primary: #8a5a1f;
  --brand-ink: #2b2118;
}
[data-mode='dark'] {
  --primary: #e3a857;
}
\`\`\`
`;

// shadcn's shape: HSL channels inside @layer base, a .dark override, a scoped rule.
const SHADCN_CSS = `@layer base {
  :root {
    --background: 0 0% 100%;
    --primary: 222.2 47.4% 11.2%;
    --ring: var(--primary);
    --chart-1: 12 76% 61%;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --primary: 210 40% 98%;
  }
  .card {
    --inset: 4px;
  }
}`;

const TAILWIND_CONFIG = `module.exports = {
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#123456', 500: '#345678' }, slate: colors.slate },
      borderRadius: { lg: '14px' },
    },
  },
};`;

async function importKit(
  canvas: Harness,
  mutationId: string,
  source: DesignSystemSource,
): Promise<{ ref: DesignSystemVersionRef; diagnostics: CanvasDiagnostic[] }> {
  await canvas.handle({
    type: 'canvas.importDesignSystem',
    requestId: `import-${mutationId}`,
    mutationId,
    name: mutationId,
    source,
  });
  const reply = okReply(canvas, `import-${mutationId}`);
  assert.ok(reply.kind === 'designSystemSaved');
  return reply;
}

async function readKit(canvas: Harness, ref: DesignSystemVersionRef): Promise<DesignSystemDetail> {
  const requestId = `read-${ref.id}-${String(canvas.events.length)}`;
  await canvas.handle({ type: 'canvas.readDesignSystem', requestId, ref });
  const reply = okReply(canvas, requestId);
  assert.ok(reply.kind === 'designSystem');
  return reply.system;
}

test('a pasted DESIGN.md becomes a kit whose starter compiles on the shared primitives', async (t) => {
  const canvas = await harness(t);
  const { ref, diagnostics } = await importKit(canvas, 'paper-and-ink', {
    kind: 'designMd',
    text: DESIGN_MD,
  });
  assert.deepEqual(ref, { id: 'paper-and-ink', version: 1 });
  assert.deepEqual(diagnostics, []);

  const kit = await readKit(canvas, ref);
  assert.equal(kit.modes.light['--ds-accent'], '#8a5a1f');
  assert.equal(kit.modes.dark['--ds-accent'], '#e3a857');
  // Kept under its own name in both modes, and reported rather than dropped.
  assert.deepEqual(kit.unmapped, ['--brand-ink']);
  assert.equal(kit.modes.dark['--brand-ink'], '#2b2118');
  // The agent reads the whole DESIGN.md as the kit's guidance.
  assert.ok((await readDesignSystem(ref)).guidance.includes('one confident accent'));

  const compiler = new CompilerWorker();
  t.after(() => compiler.terminate());
  for (const mode of ['light', 'dark'] as const) {
    const design = await compiler.compile(
      {
        designId: 'hey',
        revisionId: 'revision-1',
        generation: 1,
        files: { 'main.tsx': DROIDEX_DESIGN_SYSTEM.examples['Hey.tsx'] },
        designSystem: { ...ref, mode },
        // Strict fails a build that strays from the kit, so a clean build is the proof.
        designSystemAdherence: 'strict',
      },
      new AbortController().signal,
    );
    assert.deepEqual(design.diagnostics, []);
    assert.ok(design.html.includes(mode === 'light' ? '#8a5a1f' : '#e3a857'));
  }
});

test('CSS variables and a Tailwind config map familiar names and keep the rest unmapped', async (t) => {
  const canvas = await harness(t);
  const fromCss = await importKit(canvas, 'from-css', { kind: 'cssOrTailwind', text: SHADCN_CSS });
  assert.deepEqual(fromCss.diagnostics, [
    {
      code: 'manual_interpretation_required',
      message:
        '--inset is set outside :root, html, @theme and the light and dark rules, so it was not imported.',
      line: 13,
    },
  ]);
  const css = await readKit(canvas, fromCss.ref);
  assert.equal(css.modes.light['--ds-accent'], 'hsl(222.2 47.4% 11.2%)');
  assert.equal(css.modes.dark['--ds-accent'], 'hsl(210 40% 98%)');
  assert.equal(css.modes.dark['--ds-canvas'], 'hsl(222.2 84% 4.9%)');
  // A reference follows its mode, and unset contract tokens keep DROIDEX values.
  assert.equal(css.modes.dark['--ds-focus'], 'hsl(210 40% 98%)');
  assert.equal(css.modes.light['--ds-danger'], DROIDEX_DESIGN_SYSTEM.modes.light['--ds-danger']);
  assert.deepEqual(css.unmapped, ['--chart-1']);

  const fromConfig = await importKit(canvas, 'from-config', {
    kind: 'cssOrTailwind',
    text: TAILWIND_CONFIG,
  });
  assert.deepEqual(
    fromConfig.diagnostics.map(({ code, line }) => ({ code, line })),
    [{ code: 'manual_interpretation_required', line: 4 }],
  );
  const config = await readKit(canvas, fromConfig.ref);
  assert.equal(config.modes.dark['--ds-accent'], '#123456');
  assert.equal(config.modes.light['--ds-radius-lg'], '14px');
  assert.deepEqual(config.unmapped, ['--color-brand-500']);

  // A stylesheet that does not parse saves nothing.
  await canvas.handle({
    type: 'canvas.importDesignSystem',
    requestId: 'broken',
    mutationId: 'broken-kit',
    name: 'Broken',
    source: { kind: 'cssOrTailwind', text: ':root { --primary: red' },
  });
  assert.deepEqual(errorOf(canvas, 'broken'), {
    code: 'invalid_input',
    message: 'Fix this stylesheet at line 1: Unclosed block.',
  });
  await assert.rejects(readDesignSystem({ id: 'broken-kit', version: 1 }), {
    code: 'version_mismatch',
  });
});

test('references resolve however deep they fan out, and what cannot be read is named', async (t) => {
  const canvas = await harness(t);
  // Twelve levels, each naming the next twice: the deepest value appears 4096 times
  // over if each reference is resolved again, so only a linear resolution fits.
  const chain = Array.from({ length: 12 }, (_, level) =>
    level === 11
      ? `  --level-11: 1px;`
      : `  --level-${String(level)}: var(--level-${String(level + 1)});`,
  );
  const text = [
    ':root {',
    ...chain,
    '  --loop-a: var(--loop-b);',
    '  --loop-b: var(--loop-a);',
    `  --${'long-'.repeat(200)}name: var(--missing);`,
    '}',
  ].join('\n');
  const { ref, diagnostics } = await importKit(canvas, 'deep-references', {
    kind: 'cssOrTailwind',
    text,
  });
  assert.equal((await readKit(canvas, ref)).modes.dark['--level-0'], '1px');
  assert.deepEqual(
    diagnostics.map(({ message }) => message.split(' was not imported. ')[0].slice(0, 12)),
    ['--loop-a', '--loop-b', '--long-long-'],
  );
  assert.ok(diagnostics.every(({ message }) => message.length <= 301));

  // A family list with a spread is computed, not shortened; with nothing readable
  // the refusal says why.
  await canvas.handle({
    type: 'canvas.importDesignSystem',
    requestId: 'computed-only',
    mutationId: 'computed-only',
    name: 'Computed',
    source: {
      kind: 'cssOrTailwind',
      text: "theme: { fontFamily: { sans: ['Inter', ...defaultTheme.fontFamily.sans] } }",
    },
  });
  assert.equal(
    errorOf(canvas, 'computed-only').message,
    'No tokens could be imported. theme.fontFamily.sans is computed in the config. Paste its values as CSS variables instead.',
  );
});

test('pasted sources are bounded before they are read, and competing values are refused', async (t) => {
  const canvas = await harness(t);
  const refusal = async (requestId: string, text: string) => {
    await canvas.handle({
      type: 'canvas.importDesignSystem',
      requestId,
      mutationId: requestId,
      name: requestId,
      source: { kind: 'cssOrTailwind', text },
    });
    return errorOf(canvas, requestId);
  };
  // Each of these would otherwise overflow a recursive reader and surface as
  // storage damage rather than as the paste's own fault.
  assert.deepEqual(
    await refusal('deep-config', `module.exports={theme:{colors:{a:${'['.repeat(4000)}`),
    {
      code: 'invalid_input',
      message: 'That config nests its values too deeply to read.',
    },
  );
  // Short names keep 3000 links under the 64 KiB paste bound.
  const chain = Array.from(
    { length: 3000 },
    (_, index) => `--${String(index)}:var(--${String(index + 1)});`,
  );
  assert.deepEqual(await refusal('long-chain', `:root{${chain.join('')}}`), {
    code: 'invalid_input',
    message: 'That source declares 3000 tokens; a kit holds at most 128 in each mode.',
  });
  assert.deepEqual(
    await refusal('competing', ':root { --primary: #123; }\n:root { --primary: #456; }'),
    {
      code: 'invalid_input',
      message: '--primary has competing shared values. Choose one explicitly.',
    },
  );

  const nested = `${'var(--missing, '.repeat(40)}red${')'.repeat(40)}`;
  const { ref, diagnostics } = await importKit(canvas, 'bounded-values', {
    kind: 'cssOrTailwind',
    text: `:root { --primary: #abc; --primary: #aabbcc; --wash: ${nested}; }`,
  });
  // Hex shorthand agrees with its long form, so the repeat is not competing.
  assert.equal((await readKit(canvas, ref)).modes.light['--ds-accent'], '#aabbcc');
  assert.deepEqual(
    diagnostics.map(({ message }) => message),
    ['--wash was not imported. It nests functions too deeply.'],
  );
});

test('saving a copy of a preset makes the user’s own kit with provenance', async (t) => {
  const canvas = await harness(t);
  const copy = {
    type: 'canvas.copyDesignSystem',
    mutationId: 'droidex-copy',
    source: { id: 'droidex', version: 1 },
    name: 'DROIDEX copy',
  };
  await canvas.handle({ ...copy, requestId: 'copy' });
  // A retry after a lost reply finds the version it saved instead of a second kit.
  await canvas.handle({ ...copy, requestId: 'copy-retry' });
  assert.deepEqual(okReply(canvas, 'copy-retry'), okReply(canvas, 'copy'));

  const kit = await readKit(canvas, { id: 'droidex-copy', version: 1 });
  assert.deepEqual(kit.provenance, { copiedFrom: { id: 'droidex', version: 1 } });
  assert.deepEqual(kit.modes, DROIDEX_DESIGN_SYSTEM.modes);
  assert.deepEqual(kit.unmapped, []);

  await canvas.handle({ type: 'canvas.listDesignSystems', requestId: 'list' });
  const listed = okReply(canvas, 'list');
  assert.ok(listed.kind === 'designSystems');
  assert.deepEqual(
    listed.systems
      .filter((system) => system.id.includes('droidex'))
      .map(({ id, kind }) => ({ id, kind })),
    [
      { id: 'droidex', kind: 'preset' },
      { id: 'droidex-copy', kind: 'user' },
    ],
  );

  // A preset's name cannot be taken by a new kit.
  await canvas.handle({ ...copy, requestId: 'over-preset', mutationId: 'droidex' });
  assert.equal(errorOf(canvas, 'over-preset').code, 'preset_read_only');
});

async function exportFolder(t: TestContext): Promise<{ parent: string; destination: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'kit-export-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const destination = join(parent, 'chosen');
  await mkdir(destination);
  await writeFile(join(parent, 'neighbour.txt'), 'keep');
  return { parent, destination };
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await filesUnder(join(directory, entry.name), `${path}/`)));
    else files.push(path);
  }
  return files.sort();
}

test('export writes the kit into the chosen empty folder only, and its modes read back', async (t) => {
  const { parent, destination } = await exportFolder(t);
  const ref = { id: 'claude-inspired', version: 1 };
  assert.deepEqual(await exportDesignSystem(ref, destination), { filesWritten: 8 });
  assert.deepEqual((await readdir(parent)).sort(), ['chosen', 'neighbour.txt']);
  assert.deepEqual(await filesUnder(destination), [
    'DESIGN.md',
    'design-system.json',
    'examples/Hey.tsx',
    'modes.css',
    'src/fonts/Inter-OFL.txt',
    'src/fonts/Lora-OFL.txt',
    'src/index.tsx',
    'src/tokens.css',
  ]);
  assert.equal(
    await readFile(join(destination, 'DESIGN.md'), 'utf8'),
    CLAUDE_INSPIRED_DESIGN_SYSTEM.guidance,
  );

  // The exported tokens are a stylesheet From CSS reads back unchanged.
  const canvas = await harness(t);
  const reimported = await importKit(canvas, 'claude-reimported', {
    kind: 'cssOrTailwind',
    text: await readFile(join(destination, 'modes.css'), 'utf8'),
  });
  assert.deepEqual(
    (await readKit(canvas, reimported.ref)).modes,
    CLAUDE_INSPIRED_DESIGN_SYSTEM.modes,
  );

  // A folder that is not empty is refused and left as it was.
  await assert.rejects(exportDesignSystem(ref, parent), { code: 'invalid_input' });
  assert.deepEqual((await readdir(parent)).sort(), ['chosen', 'neighbour.txt']);
});

test('only Electron main’s token reaches the export route', async (t) => {
  const { destination } = await exportFolder(t);
  const bridge = startBridgeServer({
    requestedPort: 0,
    token: 'renderer-token',
    assetToken: 'asset-token',
    canvasExportToken: 'host-token',
    onCommand: async () => undefined,
  });
  t.after(() => bridge.close());
  await bridge.ready;
  const post = (token: string, body: unknown) =>
    fetch(`http://127.0.0.1:${String(bridge.port)}/canvas/design-system-export`, {
      method: 'POST',
      headers: { 'x-canvas-export-token': token },
      body: JSON.stringify(body),
    });
  const request = { ref: { id: 'droidex', version: 1 }, destinationDirectory: destination };

  assert.equal((await post('renderer-token', request)).status, 404);
  assert.deepEqual(await readdir(destination), []);
  const exported = await post('host-token', request);
  assert.equal(exported.status, 200);
  assert.deepEqual(await exported.json(), { filesWritten: 7 });
});
