import assert from 'node:assert/strict';
import test from 'node:test';
import { colourFace, firstFamily, lengthFace, sameFontStack } from './panelValues';

const spacing = [
  { value: '--ds-space-1', label: 'space-1', hint: '4px' },
  { value: '--ds-space-2', label: 'space-2', hint: '0.5rem' },
];

test('a length reads as the token it matches in px, and zero or a keyword as a placeholder', () => {
  assert.deepEqual(lengthFace('8px', spacing), { text: 'space-2', placeholder: '' });
  assert.deepEqual(lengthFace('4px', spacing), { text: 'space-1', placeholder: '' });
  assert.deepEqual(lengthFace('12px', spacing), { text: '12px', placeholder: '' });
  assert.deepEqual(lengthFace('0px', spacing), { text: '', placeholder: '0' });
  assert.deepEqual(lengthFace('auto'), { text: '', placeholder: 'Auto' });
  assert.deepEqual(lengthFace('none'), { text: '', placeholder: 'None' });
  assert.deepEqual(lengthFace('normal'), { text: '', placeholder: 'Normal' });
  // A unitless number is not a length, so no spacing token can claim it.
  assert.deepEqual(lengthFace('8', spacing), { text: '8', placeholder: '' });
  assert.deepEqual(lengthFace('16px 24px', spacing), { text: '16px 24px', placeholder: '' });
});

test('a fractional length reads to three significant figures, never short of whole pixels', () => {
  assert.deepEqual(lengthFace('213.578px'), { text: '214px', placeholder: '' });
  assert.deepEqual(lengthFace('22.53px'), { text: '22.5px', placeholder: '' });
  assert.deepEqual(lengthFace('1.5px'), { text: '1.5px', placeholder: '' });
  assert.deepEqual(lengthFace('-0.08px'), { text: '-0.08px', placeholder: '' });
  assert.deepEqual(lengthFace('1234.56px'), { text: '1235px', placeholder: '' });
});

test('a colour reads as its token, else hex with its opacity, and nothing painted as None', () => {
  const colours = [{ value: '--ds-ink', label: 'ink', hint: '#141414' }];

  assert.deepEqual(colourFace('rgb(20, 20, 20)', colours), { text: 'ink', none: false });
  assert.deepEqual(colourFace('rgb(51, 102, 255)', colours), { text: '#3366ff', none: false });
  assert.deepEqual(colourFace('rgba(51, 102, 255, 0.5)'), { text: '#3366ff 50%', none: false });
  assert.deepEqual(colourFace('rgb(51 102 255 / 25%)'), { text: '#3366ff 25%', none: false });
  assert.deepEqual(colourFace('rgba(0, 0, 0, 0)'), { text: 'None', none: true });
  assert.deepEqual(colourFace('transparent'), { text: 'None', none: true });
  // A colour space this reader does not convert is shown as written, and
  // matches a token written the same way.
  const oklch = [{ value: '--ds-accent', label: 'accent', hint: 'oklch(0.6 0.2 250)' }];
  assert.deepEqual(colourFace('oklch(0.6 0.2 250)', oklch), { text: 'accent', none: false });
  assert.deepEqual(colourFace('oklch(0.5 0.1 30)', oklch), {
    text: 'oklch(0.5 0.1 30)',
    none: false,
  });
});

test('a colour token in any form the style edits accept matches what Chromium computes for it', () => {
  // A kit's value beside what Electron 39's getComputedStyle reports for it.
  const computed = [
    ['hsl(220 100% 60%)', 'rgb(51, 119, 255)'],
    ['hsla(220, 100%, 60%, 0.5)', 'rgba(51, 119, 255, 0.5)'],
    ['hwb(220 20% 0%)', 'rgb(51, 119, 255)'],
    ['lab(50% 40 -20 / 0.5)', 'lab(50 40 -20 / 0.5)'],
    ['lch(50% 40 270deg)', 'lch(50 40 270)'],
    ['oklab(60% 25% -25%)', 'oklab(0.6 0.1 -0.1)'],
    ['oklch(60% 50% 0.5turn / 50%)', 'oklch(0.6 0.2 180 / 0.5)'],
    ['color(display-p3 20% 40% 100%)', 'color(display-p3 0.2 0.4 1)'],
  ];
  for (const [written, value] of computed) {
    const brand = [{ value: '--ds-brand', label: 'brand', hint: written }];
    assert.deepEqual(colourFace(value, brand), { text: 'brand', none: false }, written);
  }
  const accent = [{ value: '--ds-accent', label: 'accent', hint: 'oklch(60% 0.2 250deg)' }];
  assert.deepEqual(colourFace('oklch(0.6 0.2 251)', accent), {
    text: 'oklch(0.6 0.2 251)',
    none: false,
  });
});

test('a font stack is named by its first family and matched however it is quoted', () => {
  assert.equal(firstFamily('"Inter Variable", system-ui, sans-serif'), 'Inter Variable');
  assert.equal(
    sameFontStack(
      '"Inter Variable", system-ui, sans-serif',
      "'inter variable',system-ui,sans-serif",
    ),
    true,
  );
  assert.equal(sameFontStack('Inter, sans-serif', 'Inter, serif'), false);
});
