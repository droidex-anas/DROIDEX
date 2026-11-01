import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { startBridgeServer } from '../bridgeServer.js';
import { errorOf, harness, okReply, type Harness } from '../testing/canvasBridgeSupport.js';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { CompilerWorker } from './compiler.js';
import type { DesignSystemDocumentView } from './designSystemCommands.js';
import { kitGuidance, kitModes } from './designSystemDocument.js';
import { exportDesignSystem } from './designSystemExport.js';
import { proposeDesignSystem } from './designSystemProposals.js';
import { readDesignSystem, saveDesignSystem, type DesignSystemSource } from './designSystems.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';
import { STARTER_TOKENS } from './presets/starter.js';
import type { CanvasDiagnostic, DesignSystemVersionRef } from './protocol.js';

pinScratchProfile();

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

async function readKit(
  canvas: Harness,
  ref: DesignSystemVersionRef,
): Promise<DesignSystemDocumentView & { modes: ReturnType<typeof kitModes> }> {
  const requestId = `read-${ref.id}-${String(canvas.events.length)}`;
  await canvas.handle({ type: 'canvas.readDesignSystem', requestId, ref });
  const reply = okReply(canvas, requestId);
  assert.ok(reply.kind === 'designSystem');
  return { ...reply.system, modes: kitModes(reply.system.sections) };
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
  // Kept under its own name in the kit's namespace, and reported rather than dropped.
  assert.deepEqual(kit.unmapped, ['--ds-brand-ink']);
  assert.equal(kit.modes.dark['--ds-brand-ink'], '#2b2118');
  // The agent reads the whole DESIGN.md as one of the kit's notes.
  const saved = await readDesignSystem(ref);
  assert.ok(kitGuidance(saved.name, saved.sections).includes('### design.md'));
  assert.ok(kitGuidance(saved.name, saved.sections).includes('one confident accent'));

  const compiler = new CompilerWorker();
  t.after(() => compiler.terminate());
  for (const mode of ['light', 'dark'] as const) {
    const design = await compiler.compile(
      {
        kind: 'design',
        designId: 'hey',
        revisionId: 'revision-1',
        generation: 1,
        files: { 'main.tsx': OPENAI_INSPIRED_DESIGN_SYSTEM.examples['PricingCard.tsx'] },
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
  // A reference follows its mode, and unset contract tokens keep the starter's values.
  assert.equal(css.modes.dark['--ds-focus'], 'hsl(210 40% 98%)');
  assert.equal(css.modes.light['--ds-danger'], STARTER_TOKENS.light['--ds-danger']);
  assert.deepEqual(css.unmapped, ['--ds-chart-1']);

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
  assert.deepEqual(config.unmapped, ['--ds-color-brand-500']);

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
  assert.equal((await readKit(canvas, ref)).modes.dark['--ds-level-0'], '1px');
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
  // storage damage rather than as the paste's own fault. The closers do not
  // match what they would close, so only depth counted as the readers open
  // does, never a count of brackets in the text, refuses them.
  assert.deepEqual(
    await refusal('deep-config', `module.exports={theme:{colors:{${'a:{]'.repeat(15000)}`),
    { code: 'invalid_input', message: 'That config nests its values too deeply to read.' },
  );
  assert.deepEqual(await refusal('deep-rules', `${'a{b:"}";'.repeat(6000)}${'}'.repeat(6000)}`), {
    code: 'invalid_input',
    message: 'That stylesheet nests its rules too deeply to read.',
  });
  // Short names keep 3000 links under the 64 KiB paste bound.
  const chain = Array.from(
    { length: 3000 },
    (_, index) => `--${String(index)}:var(--${String(index + 1)});`,
  );
  assert.deepEqual(await refusal('long-chain', `:root{${chain.join('')}}`), {
    code: 'invalid_input',
    message: 'That source declares 3000 tokens; a kit holds at most 256.',
  });
  assert.deepEqual(
    await refusal('competing', ':root { --primary: #123; }\n:root { --primary: #456; }'),
    {
      code: 'invalid_input',
      message: '--primary has competing shared values. Choose one explicitly.',
    },
  );

  // A `)` inside a string closes nothing, so these functions nest 9000 deep.
  const nested = `var(--missing, ${'f(")"'.repeat(9000)}${')'.repeat(9000)})`;
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
  const preset = await readDesignSystem({ id: 'droidex', version: 1 });
  assert.deepEqual(kit.sections, preset.sections);
  assert.deepEqual(kit.cover, preset.cover);
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

test('the document saves on its latest version, restores an older one and is announced', async (t) => {
  const canvas = await harness(t);
  await canvas.handle({
    type: 'canvas.copyDesignSystem',
    requestId: 'copy',
    mutationId: 'studio',
    source: { id: 'droidex', version: 1 },
    name: 'Studio',
  });
  const first = await readKit(canvas, { id: 'studio', version: 1 });
  const save = {
    type: 'canvas.saveDesignSystem',
    id: 'studio',
    cover: null,
    sections: first.sections,
  };
  await canvas.handle({
    ...save,
    requestId: 'save',
    mutationId: 'save-2',
    baseVersion: 1,
    name: 'Studio two',
  });
  assert.deepEqual(okReply(canvas, 'save'), {
    kind: 'designSystemSaved',
    ref: { id: 'studio', version: 2 },
    diagnostics: [],
  });
  const second = await readKit(canvas, { id: 'studio', version: 2 });
  assert.deepEqual([second.name, second.cover, second.latestVersion], ['Studio two', null, 2]);
  assert.deepEqual(second.savedBy, { actor: 'user' });
  // The document edits only what it shows, so the source stays the base's.
  assert.deepEqual(await readDesignSystem({ id: 'studio', version: 2 }), {
    ...(await readDesignSystem({ id: 'studio', version: 1 })),
    version: 2,
    name: 'Studio two',
    cover: null,
  });

  await canvas.handle({
    ...save,
    requestId: 'stale',
    mutationId: 'stale',
    baseVersion: 1,
    name: 'Late',
  });
  assert.deepEqual(errorOf(canvas, 'stale'), {
    code: 'revision_conflict',
    message: 'This design system now has version 2. Read it again and save on top of it.',
    latestVersion: 2,
  });

  await canvas.handle({
    type: 'canvas.restoreDesignSystemVersion',
    requestId: 'restore',
    mutationId: 'restore-1',
    id: 'studio',
    version: 1,
    onto: 2,
  });
  const restored = await readKit(canvas, { id: 'studio', version: 3 });
  assert.equal(restored.name, 'Studio');
  await canvas.handle({
    type: 'canvas.listDesignSystemVersions',
    requestId: 'history',
    id: 'studio',
  });
  const history = okReply(canvas, 'history');
  assert.ok(history.kind === 'designSystemVersions');
  assert.deepEqual(
    history.versions.map((entry) => entry.version),
    [3, 2, 1],
  );

  const deleteStudio = {
    type: 'canvas.setDesignSystemDeleted',
    requestId: 'delete',
    mutationId: 'delete-studio',
    id: 'studio',
    deleted: true,
  };
  await canvas.handle(deleteStudio);
  assert.deepEqual(okReply(canvas, 'delete'), { kind: 'ok' });
  // Every write is announced so other windows refetch; the stale save is not.
  assert.equal(
    canvas.events.filter((event) => event.type === 'canvas.designSystemsChanged').length,
    4,
  );

  // canvas_theme saves through the same owner, so an agent's save is announced too.
  await canvas.handle({ ...deleteStudio, requestId: 'undo', mutationId: 'undo', deleted: false });
  const before = canvas.events.length;
  await saveDesignSystem(await readDesignSystem({ id: 'studio', version: 3 }), {
    mutationId: 'agent-save',
    baseVersion: 3,
    savedBy: { actor: 'agent', appSessionId: 'chat-one' },
  });
  assert.deepEqual(canvas.events.slice(before), [
    { type: 'canvas.designSystemsChanged', id: 'studio' },
  ]);
});

test('the document reads an agent proposal, and accept and discard answer and are announced', async (t) => {
  const canvas = await harness(t);
  await canvas.handle({
    type: 'canvas.copyDesignSystem',
    requestId: 'copy',
    mutationId: 'reviewed',
    source: { id: 'droidex', version: 1 },
    name: 'Reviewed',
  });
  const propose = async (mutationId: string, name: string, baseVersion: number) => {
    const kit = await readDesignSystem({ id: 'reviewed', version: baseVersion });
    await proposeDesignSystem(
      { ...kit, name },
      { mutationId, baseVersion, appSessionId: 'chat-one', beforePublish: () => undefined },
    );
  };
  await propose('first', 'Reviewed by the agent', 1);
  const proposal = (await readKit(canvas, { id: 'reviewed', version: 1 })).proposal;
  assert.deepEqual(
    [proposal?.baseVersion, proposal?.appSessionId, proposal?.name],
    [1, 'chat-one', 'Reviewed by the agent'],
  );
  assert.ok(proposal);

  const changed = (from: number) =>
    canvas.events.slice(from).filter((event) => event.type === 'canvas.designSystemsChanged');
  let before = canvas.events.length;
  await canvas.handle({
    type: 'canvas.acceptDesignSystemProposal',
    requestId: 'accept',
    mutationId: 'accept',
    id: 'reviewed',
    proposalId: proposal.proposalId,
    onto: 1,
  });
  assert.deepEqual(okReply(canvas, 'accept'), {
    kind: 'designSystemSaved',
    ref: { id: 'reviewed', version: 2 },
    diagnostics: [],
  });
  const accepted = await readKit(canvas, { id: 'reviewed', version: 2 });
  assert.deepEqual(
    [accepted.name, accepted.savedBy, accepted.proposal],
    ['Reviewed by the agent', { actor: 'agent', appSessionId: 'chat-one' }, null],
  );

  assert.ok(changed(before).length > 0, 'an accept tells the lists to refresh');

  await propose('second', 'Never accepted', 2);
  const second = (await readKit(canvas, { id: 'reviewed', version: 2 })).proposal;
  assert.ok(second);
  before = canvas.events.length;
  await canvas.handle({
    type: 'canvas.discardDesignSystemProposal',
    requestId: 'discard',
    id: 'reviewed',
    proposalId: second.proposalId,
  });
  assert.deepEqual(okReply(canvas, 'discard'), { kind: 'ok' });
  assert.deepEqual(changed(before), [{ type: 'canvas.designSystemsChanged', id: 'reviewed' }]);
  assert.equal((await readKit(canvas, { id: 'reviewed', version: 2 })).proposal, null);
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
  assert.deepEqual(await exportDesignSystem(ref, destination), { filesWritten: 23 });
  assert.deepEqual((await readdir(parent)).sort(), ['chosen', 'neighbour.txt']);
  const primitives = ['Badge', 'Button', 'Card', 'Dialog', 'Input', 'Tabs'];
  assert.deepEqual(
    await filesUnder(destination),
    [
      'DESIGN.md',
      'document.json',
      ...['ReadingView', 'cover', ...primitives].map((name) => `examples/${name}.tsx`),
      'modes.css',
      ...['1-rules', '2-feel', ...primitives.map((name) => name.toLowerCase())].map(
        (name) => `notes/${name}.md`,
      ),
      'src/fonts/Inter-OFL.txt',
      'src/fonts/Lora-OFL.txt',
      'src/index.tsx',
      'src/tokens.css',
    ].sort(),
  );
  const { name, sections } = CLAUDE_INSPIRED_DESIGN_SYSTEM;
  assert.equal(await readFile(join(destination, 'DESIGN.md'), 'utf8'), kitGuidance(name, sections));
  const exported: unknown = JSON.parse(await readFile(join(destination, 'document.json'), 'utf8'));
  assert.deepEqual(exported, {
    id: 'claude-inspired',
    version: 1,
    name,
    cover: CLAUDE_INSPIRED_DESIGN_SYSTEM.cover,
    sections,
    provenance: null,
  });

  // The exported tokens are a stylesheet From CSS reads back unchanged.
  const canvas = await harness(t);
  const reimported = await importKit(canvas, 'claude-reimported', {
    kind: 'cssOrTailwind',
    text: await readFile(join(destination, 'modes.css'), 'utf8'),
  });
  assert.deepEqual((await readKit(canvas, reimported.ref)).modes, kitModes(sections));

  // A folder that is not empty is refused and left as it was.
  await assert.rejects(exportDesignSystem(ref, parent), { code: 'invalid_input' });
  assert.deepEqual((await readdir(parent)).sort(), ['chosen', 'neighbour.txt']);
});

test('only Electron main’s token reaches the export route', async (t) => {
  const { destination } = await exportFolder(t);
  const bridge = startBridgeServer({
    requestedPort: 0,
    token: 'renderer-token',
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
  const request = { ref: { id: 'openai-inspired', version: 1 }, destinationDirectory: destination };

  assert.equal((await post('renderer-token', request)).status, 404);
  assert.deepEqual(await readdir(destination), []);
  const exported = await post('host-token', request);
  assert.equal(exported.status, 200);
  assert.deepEqual(await exported.json(), { filesWritten: 22 });
});
