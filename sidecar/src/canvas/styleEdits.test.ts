import assert from 'node:assert/strict';
import test from 'node:test';
import { STYLE_PROPERTIES as RENDERER_STYLE_PROPERTIES } from '../../../src/features/canvas/styleProperties.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { SourceElementError } from './sourceElements.js';
import { resolveStyleChange, STYLE_PROPERTIES, styleValue } from './styleEdits.js';

const KIT = DROIDEX_DESIGN_SYSTEM.modes.light;
type Change = Parameters<typeof resolveStyleChange>[0];

function refusal(change: Change, tokens: Record<string, string> = KIT): SourceElementError {
  try {
    resolveStyleChange(change, tokens);
  } catch (error) {
    assert.ok(error instanceof SourceElementError);
    return error;
  }
  assert.fail(`${change.property}: ${change.value} was accepted`);
}

test('each kind writes the kit token with that value, and the raw value only when the kit has none', () => {
  const cases: [Change, string][] = [
    [{ kind: 'spacing', property: 'padding', value: '0.5rem' }, 'var(--ds-space-2)'],
    [{ kind: 'spacing', property: 'gap', value: '--ds-space-4' }, 'var(--ds-space-4)'],
    [{ kind: 'spacing', property: 'marginTop', value: '-13px' }, '-13px'],
    [{ kind: 'size', property: 'borderRadius', value: '10px' }, 'var(--ds-radius-md)'],
    [{ kind: 'size', property: 'width', value: '320px' }, '320px'],
    [{ kind: 'colour', property: 'color', value: '#8A5A1F' }, 'var(--ds-accent)'],
    [{ kind: 'colour', property: 'borderColor', value: 'rgb(1 2 3)' }, 'rgb(1 2 3)'],
    [{ kind: 'colour', property: 'boxShadow', value: '--ds-shadow-sm' }, 'var(--ds-shadow-sm)'],
    [
      { kind: 'typography', property: 'fontFamily', value: '--ds-font-mono' },
      'var(--ds-font-mono)',
    ],
    [{ kind: 'typography', property: 'fontSize', value: '1rem' }, 'var(--ds-text-base)'],
    [{ kind: 'typography', property: 'fontWeight', value: '600' }, '600'],
    [{ kind: 'layout', property: 'justifyContent', value: 'space-between' }, 'space-between'],
    [{ kind: 'opacity', property: 'opacity', value: '0.5' }, '0.5'],
  ];
  for (const [change, css] of cases) {
    const resolution = resolveStyleChange(change, KIT);
    assert.equal(styleValue(resolution), css, change.property);
    assert.equal(resolution.kind, css.startsWith('var(') ? 'token' : 'raw', change.property);
  }
});

test('a raw value resolves to the same token whatever order the kit lists its tokens in', () => {
  const change: Change = { kind: 'spacing', property: 'padding', value: '4px' };
  const tokens = { '--ds-space-b': '4px', '--ds-space-a': '4px' };
  const reversed = { '--ds-space-a': '4px', '--ds-space-b': '4px' };
  assert.deepEqual(resolveStyleChange(change, tokens), { kind: 'token', token: '--ds-space-a' });
  assert.deepEqual(resolveStyleChange(change, reversed), resolveStyleChange(change, tokens));
});

test('a token outside the property family and a value it cannot take are invalid edits', () => {
  for (const change of [
    { kind: 'spacing', property: 'padding', value: '--ds-accent' },
    { kind: 'spacing', property: 'padding', value: '--ds-space-9' },
    { kind: 'colour', property: 'color', value: '--ds-space-2' },
    { kind: 'layout', property: 'flexDirection', value: '--ds-space-2' },
    { kind: 'spacing', property: 'padding', value: 'calc(1px + 2px)' },
    { kind: 'spacing', property: 'padding', value: '-4px' },
    { kind: 'colour', property: 'color', value: 'red;background:url(x)' },
    { kind: 'opacity', property: 'opacity', value: '1.5' },
    { kind: 'layout', property: 'justifyContent', value: 'left' },
    { kind: 'typography', property: 'fontFamily', value: 'Comic Sans MS' },
  ] satisfies Change[]) {
    assert.equal(refusal(change).code, 'invalid_edit', `${change.property}: ${change.value}`);
  }
});

test('a property outside the whitelist, or sent as another kind, is unsupported by name', () => {
  for (const change of [
    { kind: 'colour', property: 'backgroundImage', value: '#fff' },
    { kind: 'colour', property: 'padding', value: '#fff' },
    { kind: 'size', property: 'constructor', value: '1px' },
  ] satisfies Change[]) {
    const error = refusal(change);
    assert.equal(error.code, 'unsupported_edit');
    assert.match(error.message, new RegExp(`^${change.property} `));
  }
});

test('the renderer edits the same properties, as the same kinds', () => {
  const kinds = Object.fromEntries(
    Object.entries(STYLE_PROPERTIES).map(([property, rule]) => [property, rule.kind]),
  );
  assert.deepEqual(RENDERER_STYLE_PROPERTIES, kinds);
});
