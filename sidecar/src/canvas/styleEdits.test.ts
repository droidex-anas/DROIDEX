import assert from 'node:assert/strict';
import test from 'node:test';
import { STYLE_PROPERTIES as RENDERER_STYLE_PROPERTIES } from '../../../src/features/canvas/styleProperties.js';
import { STARTER_TOKENS } from './presets/starter.js';
import { SourceElementError } from './sourceElementError.js';
import { editTokens, resolveStyleChange, STYLE_PROPERTIES, styleValue } from './styleEdits.js';

const KIT = STARTER_TOKENS.light;
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

test('a style writes the kit token with its value, and the raw value only when the kit has none', () => {
  const cases: [Change, string][] = [
    [{ property: 'padding', value: '0.5rem' }, 'var(--ds-space-2)'],
    [{ property: 'gap', value: '--ds-space-4' }, 'var(--ds-space-4)'],
    [{ property: 'marginTop', value: '-13px' }, '-13px'],
    [{ property: 'borderRadius', value: '10px' }, 'var(--ds-radius-md)'],
    [{ property: 'width', value: '320px' }, '320px'],
    [{ property: 'color', value: '#8A5A1F' }, 'var(--ds-accent)'],
    [{ property: 'borderColor', value: 'rgb(1 2 3)' }, 'rgb(1 2 3)'],
    [{ property: 'boxShadow', value: '--ds-shadow-sm' }, 'var(--ds-shadow-sm)'],
    [{ property: 'fontFamily', value: '--ds-font-mono' }, 'var(--ds-font-mono)'],
    [{ property: 'fontSize', value: '1rem' }, 'var(--ds-text-base)'],
    [{ property: 'fontWeight', value: '600' }, '600'],
    [{ property: 'justifyContent', value: 'space-between' }, 'space-between'],
    [{ property: 'display', value: 'inline-grid' }, 'inline-grid'],
    [{ property: 'opacity', value: '0.5' }, '0.5'],
    [{ property: 'width', value: 'fit-content' }, 'fit-content'],
    [{ property: 'height', value: 'auto' }, 'auto'],
    [{ property: 'maxWidth', value: 'none' }, 'none'],
  ];
  for (const [change, css] of cases) {
    const resolution = resolveStyleChange(change, KIT);
    assert.equal(styleValue(change.property, resolution), css, change.property);
    assert.equal(resolution.kind, css.startsWith('var(') ? 'token' : 'raw', change.property);
  }
});

test('a blur takes none, a stock step or a kit blur token, and shadow tokens stack within one value', () => {
  const kit = { ...KIT, '--ds-blur-soft': '12px' };
  assert.deepEqual(resolveStyleChange({ property: 'filter', value: 'blur(0.75rem)' }, kit), {
    kind: 'token',
    token: '--ds-blur-soft',
  });
  const token = resolveStyleChange({ property: 'backdropFilter', value: '--ds-blur-soft' }, kit);
  assert.equal(styleValue('backdropFilter', token), 'blur(var(--ds-blur-soft))');
  for (const value of ['none', 'blur(0)', 'blur(4px)'])
    assert.deepEqual(resolveStyleChange({ property: 'filter', value }, kit), {
      kind: 'raw',
      value,
    });
  for (const value of ['blur(5px)', '8px', 'grayscale(1)', 'blur(4px) grayscale(1)'])
    assert.equal(refusal({ property: 'filter', value }).code, 'invalid_edit', value);

  const stacked = resolveStyleChange(
    { property: 'boxShadow', value: '--ds-shadow-sm, --ds-shadow-md' },
    KIT,
  );
  assert.deepEqual(stacked, { kind: 'tokens', tokens: ['--ds-shadow-sm', '--ds-shadow-md'] });
  assert.equal(styleValue('boxShadow', stacked), 'var(--ds-shadow-sm),var(--ds-shadow-md)');
  assert.match(
    refusal({ property: 'boxShadow', value: '--ds-shadow-sm,--ds-accent' }).message,
    /^--ds-accent isn’t one of this kit’s shadow tokens/,
  );
  const seven = Array.from({ length: 7 }, () => '--ds-shadow-md').join(',');
  assert.match(
    refusal({ property: 'boxShadow', value: seven }).message,
    /^7 shadow tokens are too many to stack/,
  );
  assert.equal(
    refusal({ property: 'padding', value: '--ds-space-2,--ds-space-4' }).code,
    'invalid_edit',
  );
});

test('editTokens lists, per property, the kit tokens its rule accepts', () => {
  const tokens = editTokens(STARTER_TOKENS.light, STARTER_TOKENS.dark);
  // A keyword-only property is absent, and spacing serves padding but not width.
  assert.ok(!('flexDirection' in tokens));
  assert.deepEqual(
    (tokens.padding ?? []).map(({ name }) => name),
    ['--ds-space-1', '--ds-space-2', '--ds-space-3', '--ds-space-4', '--ds-space-6'],
  );
  assert.ok(!('width' in tokens));
  // A colour-valued token serves every colour property, whatever its name.
  for (const property of ['color', 'backgroundColor', 'borderColor'])
    assert.ok(
      (tokens[property] ?? []).some(({ name }) => name === '--ds-accent'),
      property,
    );
  // A mode-dependent token carries both values; a fixed one collapses to one.
  const accent = (tokens.color ?? []).find(({ name }) => name === '--ds-accent');
  assert.deepEqual(accent, { name: '--ds-accent', light: '#8a5a1f', dark: '#e3a857' });
  const space = (tokens.padding ?? []).find(({ name }) => name === '--ds-space-2');
  assert.deepEqual(space, { name: '--ds-space-2', value: '0.5rem' });
  // Every listed token is one the property's edit accepts.
  for (const [property, options] of Object.entries(tokens))
    for (const { name } of options)
      assert.deepEqual(
        resolveStyleChange({ property, value: name }, STARTER_TOKENS.light),
        { kind: 'token', token: name },
        `${property}: ${name}`,
      );
});

test('editTokens lists each scale smallest first, pixels before em and percentages, and names with numbers read as numbers', () => {
  const kit = {
    '--ds-space-fluid': 'clamp(1rem, 2vw, 2rem)',
    '--ds-space-half': '50%',
    '--ds-space-em': '0.5em',
    '--ds-space-2': '0.5rem',
    '--ds-space-10': '2.5rem',
    '--ds-space-0-5': '2px',
    '--ds-radius-pill': '9999px',
    '--ds-radius-md': '8px',
    '--ds-radius-xs': '2px',
    '--ds-radius-card': '8px',
    '--ds-gray-10': '#111111',
    '--ds-gray-2': '#eeeeee',
  };
  const names = (property: string) =>
    (editTokens(kit, kit)[property] ?? []).map(({ name }) => name);
  assert.deepEqual(names('padding'), [
    '--ds-space-0-5',
    '--ds-space-2',
    '--ds-space-10',
    '--ds-space-em',
    '--ds-space-half',
    '--ds-space-fluid',
  ]);
  assert.deepEqual(names('borderRadius'), [
    '--ds-radius-xs',
    '--ds-radius-card',
    '--ds-radius-md',
    '--ds-radius-pill',
  ]);
  assert.deepEqual(names('color'), ['--ds-gray-2', '--ds-gray-10']);
});
test('an SVG paint takes a colour token, none or currentcolor, and a stroke width a length or stroke token', () => {
  const kit = { ...KIT, '--ds-stroke-thin': '1.5px' };
  assert.deepEqual(resolveStyleChange({ property: 'fill', value: '#8A5A1F' }, kit), {
    kind: 'token',
    token: '--ds-accent',
  });
  for (const value of ['none', 'currentcolor'])
    assert.deepEqual(resolveStyleChange({ property: 'stroke', value }, kit), {
      kind: 'raw',
      value,
    });
  assert.deepEqual(resolveStyleChange({ property: 'strokeWidth', value: '1.5px' }, kit), {
    kind: 'token',
    token: '--ds-stroke-thin',
  });
  assert.deepEqual(editTokens(kit, kit).strokeWidth, [
    { name: '--ds-stroke-thin', value: '1.5px' },
  ]);
  for (const change of [
    { property: 'color', value: 'none' },
    { property: 'fill', value: 'url(#gradient)' },
    { property: 'strokeWidth', value: '-1px' },
    { property: 'strokeWidth', value: '--ds-space-2' },
  ] satisfies Change[])
    assert.equal(refusal(change, kit).code, 'invalid_edit', `${change.property}: ${change.value}`);
});

test('a raw value resolves to the same token whatever order the kit lists its tokens in', () => {
  const change: Change = { property: 'padding', value: '4px' };
  const tokens = { '--ds-space-b': '4px', '--ds-space-a': '4px' };
  const reversed = { '--ds-space-a': '4px', '--ds-space-b': '4px' };
  assert.deepEqual(resolveStyleChange(change, tokens), { kind: 'token', token: '--ds-space-a' });
  assert.deepEqual(resolveStyleChange(change, reversed), resolveStyleChange(change, tokens));
});

test('a token outside the property family and a value it cannot take are invalid edits', () => {
  for (const change of [
    { property: 'padding', value: '--ds-accent' },
    { property: 'padding', value: '--ds-space-9' },
    { property: 'color', value: '--ds-space-2' },
    { property: 'flexDirection', value: '--ds-space-2' },
    { property: 'padding', value: 'calc(1px + 2px)' },
    { property: 'padding', value: 'fit-content' },
    { property: 'maxWidth', value: 'auto' },
    { property: 'minWidth', value: 'auto' },
    { property: 'borderWidth', value: '50%' },
    { property: 'padding', value: '-4px' },
    { property: 'color', value: 'red;background:url(x)' },
    { property: 'opacity', value: '1.5' },
    { property: 'justifyContent', value: 'left' },
    { property: 'fontFamily', value: 'Comic Sans MS' },
  ] satisfies Change[]) {
    assert.equal(refusal(change).code, 'invalid_edit', `${change.property}: ${change.value}`);
  }
  // A property that takes only the kit's tokens points to them, not to another value.
  assert.match(
    refusal({ property: 'fontFamily', value: 'Comic Sans MS' }).message,
    /Pick one of this kit’s font family tokens/,
  );
});

test('a property outside the whitelist is unsupported by name', () => {
  for (const [change, name] of [
    [{ property: 'backgroundImage', value: '#fff' }, 'background image'],
    [{ property: 'constructor', value: '1px' }, 'constructor'],
  ] satisfies [Change, string][]) {
    const error = refusal(change);
    assert.equal(error.code, 'unsupported_edit');
    assert.match(error.message, new RegExp(`change the ${name} `));
  }
});

test('the renderer edits the same properties', () => {
  assert.deepEqual(RENDERER_STYLE_PROPERTIES, Object.keys(STYLE_PROPERTIES));
});
