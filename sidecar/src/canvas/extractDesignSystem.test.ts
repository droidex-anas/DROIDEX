import assert from 'node:assert/strict';
import { test } from 'node:test';
import postcss from 'postcss';
import { DESIGN_SYSTEM_LIMITS, readDesignSystem, saveDesignSystem } from './designSystems.js';
import { extractDesignSystem } from './extractDesignSystem.js';
import { CompilerWorker } from './compiler.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { HEY_TSX } from './presets/starter.js';

const input = {
  name: 'Owned studio',
  sourceCanvasId: 'canvas-owned',
  from: { designId: 'design-owned', revisionId: 'revision-owned' },
};

test('a saved token-only extraction compiles all six shared primitives with styles and tokens in both modes', async (t) => {
  const result = extractDesignSystem(
    { 'tokens.css': ':root { --ds-accent: #ff0000; }', 'main.tsx': HEY_TSX },
    input,
  );
  assert.equal(result.status, 'extracted');
  if (result.status !== 'extracted') return;
  const ref = await saveDesignSystem(result.system);
  const worker = new CompilerWorker();
  t.after(() => worker.terminate());
  for (const mode of ['light', 'dark'] as const) {
    const compiled = await worker.compile(
      {
        designId: input.from.designId,
        revisionId: input.from.revisionId,
        generation: 1,
        designSystem: { ...ref, mode },
        files: { 'main.tsx': HEY_TSX },
      },
      new AbortController().signal,
    );
    assert.deepEqual(compiled.diagnostics, []);
    assert.equal(result.system.modes[mode]['--ds-accent'], '#ff0000');
    for (const name of ['button', 'input', 'card', 'badge', 'tab', 'dialog']) {
      assert.ok(compiled.html.includes('.ds-' + name), `${name} retains its base styles`);
    }
    for (const match of compiled.html.matchAll(/var\((--ds-[\w-]+)/g)) {
      assert.ok(Object.hasOwn(result.system.modes[mode], match[1]), `${match[1]} is mapped`);
    }
  }
});

test('extraction keeps owned tokens and primitive modules, reports inherited values, and persists provenance', async (t) => {
  const extracted = extractDesignSystem(
    {
      'tokens.css':
        ':root { --ds-space: 8px; }\n[data-mode="light"] { --ds-accent: #123456; }\n[data-mode="dark"] { --ds-accent: #abcdef; }\n.ds-button { padding: var(--ds-space); }\n.scene { color: var(--ds-fg); }',
      'button.tsx':
        'import type { ButtonHTMLAttributes } from "react";\nimport { Label } from "./label";\nexport function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props}><Label /></button>; }',
      'label.tsx': 'export function Label() { return <span>Owned</span>; }',
      'main.tsx':
        'import { Card } from "@droidex/design-system"; export default function App() { return <Card>Scene</Card>; }',
      'DESIGN.md': 'Use the source-owned Button for actions.',
    },
    input,
  );
  assert.equal(extracted.status, 'extracted');
  if (extracted.status !== 'extracted') return;
  assert.deepEqual(extracted.system.modes, {
    light: { ...DROIDEX_DESIGN_SYSTEM.modes.light, '--ds-space': '8px', '--ds-accent': '#123456' },
    dark: { ...DROIDEX_DESIGN_SYSTEM.modes.dark, '--ds-space': '8px', '--ds-accent': '#abcdef' },
  });
  assert.deepEqual(extracted.system.provenance, {
    sourceCanvasId: input.sourceCanvasId,
    revision: input.from,
  });
  assert.ok(extracted.system.files['source/button.tsx'].includes('export function Button'));
  assert.ok(extracted.system.files['source/label.tsx'].includes('Owned'));
  assert.ok(!Object.hasOwn(extracted.system.files, 'source/main.tsx'));
  assert.match(extracted.system.files['source/tokens.css'], /\.ds-button/);
  assert.doesNotMatch(extracted.system.files['source/tokens.css'], /\.scene/);
  assert.ok(
    extracted.diagnostics.some(
      (entry) => entry.code === 'not_source_owned' && entry.message.includes('--ds-fg'),
    ),
  );
  assert.ok(
    extracted.diagnostics.some(
      (entry) => entry.code === 'not_source_owned' && entry.file === 'main.tsx',
    ),
  );
  const ref = await saveDesignSystem(extracted.system);
  assert.deepEqual((await readDesignSystem(ref)).provenance, extracted.system.provenance);
  const worker = new CompilerWorker();
  t.after(() => worker.terminate());
  const compiled = await worker.compile(
    {
      designId: input.from.designId,
      revisionId: input.from.revisionId,
      generation: 1,
      designSystem: ref,
      files: {
        'main.tsx':
          'import { Button } from "@droidex/design-system"; export default function App() { return <Button />; }',
      },
    },
    new AbortController().signal,
  );
  assert.deepEqual(compiled.diagnostics, []);
});

test('extraction preserves owned Badge exports and imports after an apostrophe in JSX prose', async (t) => {
  const result = extractDesignSystem(
    {
      'primitives.tsx': `export function Button() { return <button>Don't</button>; }
import { Label } from './label';
export function Badge() { return <span className='b'><Label /></span>; }`,
      'label.tsx': 'export function Label() { return <span>Owned badge</span>; }',
    },
    input,
  );
  assert.equal(result.status, 'extracted');
  if (result.status !== 'extracted') return;
  const ref = await saveDesignSystem(result.system);
  const worker = new CompilerWorker();
  t.after(() => worker.terminate());
  const compiled = await worker.compile(
    {
      designId: input.from.designId,
      revisionId: input.from.revisionId,
      generation: 1,
      designSystem: ref,
      files: {
        'main.tsx':
          'import { Badge } from "@droidex/design-system"; export default function App() { return <Badge />; }',
      },
    },
    new AbortController().signal,
  );
  assert.deepEqual(compiled.diagnostics, []);
  assert.ok(compiled.html.includes('Owned badge'));
});

test('a wrapper around an imported kit primitive is reported instead of copying its inherited implementation', () => {
  const result = extractDesignSystem(
    {
      'button.tsx':
        'import { Button as BaseButton } from "@droidex/design-system";\nexport function Button() { return <BaseButton>Owned label</BaseButton>; }',
    },
    input,
  );
  assert.equal(result.status, 'extracted');
  if (result.status !== 'extracted') return;
  assert.ok(!Object.hasOwn(result.system.files, 'source/button.tsx'));
  assert.ok(result.diagnostics.some((entry) => entry.code === 'not_source_owned'));
  assert.deepEqual(result.system.modes, DROIDEX_DESIGN_SYSTEM.modes);
});

test('extraction filters imported stylesheets to primitive rules regardless of source record order', () => {
  const button =
    'import "./button.css";\nexport function Button() { return <button className="ds-button">Owned</button>; }';
  for (const { css, selectors } of [
    {
      css: '.ds-button { padding: 8px; }\nbody { background: hotpink; }\n.scene { margin: 40px; }',
      selectors: ['.ds-button'],
    },
    { css: 'body { background: hotpink; }\n.scene { margin: 40px; }', selectors: [] },
  ]) {
    const cssFirst = extractDesignSystem({ 'button.css': css, 'button.tsx': button }, input);
    const moduleFirst = extractDesignSystem({ 'button.tsx': button, 'button.css': css }, input);
    assert.equal(cssFirst.status, 'extracted');
    assert.equal(moduleFirst.status, 'extracted');
    if (cssFirst.status !== 'extracted' || moduleFirst.status !== 'extracted') return;
    assert.equal(
      cssFirst.system.files['source/button.css'],
      moduleFirst.system.files['source/button.css'],
    );
    const actualSelectors: string[] = [];
    postcss.parse(cssFirst.system.files['source/button.css']).walkRules((rule) => {
      actualSelectors.push(rule.selector);
    });
    assert.deepEqual(actualSelectors, selectors);
  }
});

test('extraction maps shared root defaults and an explicit dark override without ambiguity', () => {
  const rules = [':root { --ds-accent: #fff; }', ':root[data-mode="dark"] { --ds-accent: #000; }'];
  for (const css of [rules.join('\n'), [...rules].reverse().join('\n')]) {
    const result = extractDesignSystem({ 'tokens.css': css }, input);
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.system.modes.light['--ds-accent'], '#ffffff');
    assert.equal(result.system.modes.dark['--ds-accent'], '#000000');
    assert.ok(!result.diagnostics.some((entry) => entry.code === 'ambiguous_token'));
  }
});

test('extraction refuses missing mode counterparts and ambiguous values rather than guessing', () => {
  for (const css of [
    '[data-mode="light"] { --ds-accent: #123456; }',
    ':root { --ds-accent: #123456; }\n:root { --ds-accent: #abcdef; }',
  ]) {
    const result = extractDesignSystem({ 'tokens.css': css }, input);
    assert.equal(result.status, 'refused');
    assert.ok(result.diagnostics.length > 0);
  }
});

test('extraction refuses guidance over 16 KiB in UTF-8 without truncating it', () => {
  const guidance = 'é'.repeat(DESIGN_SYSTEM_LIMITS.maxGuidanceBytes / 2);
  const accepted = extractDesignSystem({ 'DESIGN.md': guidance }, input);
  assert.equal(accepted.status, 'extracted');
  if (accepted.status !== 'extracted') return;
  assert.equal(accepted.system.guidance, guidance);
  const refused = extractDesignSystem({ 'DESIGN.md': guidance + 'é' }, input);
  assert.equal(refused.status, 'refused');
  assert.match(refused.diagnostics[0]?.message ?? '', /16 KiB/);
});
