import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatShadow, parseShadow, shadowSummary } from './shadowLayers';

test('a shadow parses into layers and writes back as it was', () => {
  for (const value of [
    '0 1px 2px rgb(34 30 25 / 0.06)',
    'inset 0 0 0 1px #0000001a',
    '0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px hsl(30 10% 10% / 10%)',
  ])
    assert.equal(formatShadow(parseShadow(value) ?? []), value);

  const [layer] = parseShadow('0 16px 44px rgb(0 0 0 / 0.50)') ?? [];
  assert.deepEqual(
    { x: layer.x, blur: layer.blur, spread: layer.spread, alpha: layer.alpha },
    {
      x: { amount: 0, unit: '' },
      blur: { amount: 44, unit: 'px' },
      spread: { amount: 0, unit: '' },
      alpha: 0.5,
    },
  );
});

test('only a shadow whose every colour has a rewritable alpha parses', () => {
  for (const value of ['none', '0 1px 2px black', '0 1px var(--ds-shade)', '4px', '0 1px 2px'])
    assert.equal(parseShadow(value), null, value);
});

test('an edited layer keeps its colour notation and drops a trailing zero spread', () => {
  const layers = parseShadow('0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px #000') ?? [];
  const edited = [
    { ...layers[0], alpha: 0.25 },
    { ...layers[1], spread: { amount: 0, unit: 'px' }, blur: { amount: 3, unit: '' }, alpha: 0.1 },
  ];
  assert.equal(formatShadow(edited), '0 1px 2px rgba(0,0,0, 0.25), 0 0 3px #0000001a');
  assert.equal(
    formatShadow([{ ...layers[0], color: 'rgb(34 30 25)', alpha: 0.06 }]),
    '0 1px 2px rgb(34 30 25 / 0.06)',
  );
});

test("a shadow's summary counts its layers and gives their alpha", () => {
  assert.equal(shadowSummary(parseShadow('0 1px 2px rgb(0 0 0 / 0.04)') ?? []), '1 layer · 4%');
  assert.equal(
    shadowSummary(parseShadow('0 1px 2px #0000000a, 0 8px 24px rgb(0 0 0 / 0.08)') ?? []),
    '2 layers · 4–8%',
  );
});
