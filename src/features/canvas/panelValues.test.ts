import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blurOf,
  colourFace,
  firstFamily,
  isOpaque,
  lengthFace,
  sameFontStack,
  sameValue,
  shadowTokens,
} from './panelValues';

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

test('a token whose step is a word reads as the step, which keeps a half-width field unclipped', () => {
  const radius = [
    { value: '--ds-radius-md', label: 'radius-md', hint: '8px' },
    { value: '--ds-radius-2xl', label: 'radius-2xl', hint: '1.5rem' },
  ];
  assert.deepEqual(lengthFace('8px', radius), { text: 'md', placeholder: '', token: 'radius-md' });
  assert.deepEqual(lengthFace('24px', radius), {
    text: '2xl',
    placeholder: '',
    token: 'radius-2xl',
  });
  // A numbered step alone would read as a length, so it keeps its scale.
  const half = [{ value: '--ds-space-2-5', label: 'space-2-5', hint: '10px' }];
  assert.deepEqual(lengthFace('10px', half), { text: 'space-2-5', placeholder: '' });
  const hairline = [{ value: '--ds-space-px', label: 'space-px', hint: '1px' }];
  assert.deepEqual(lengthFace('1px', hairline), { text: 'space-px', placeholder: '' });
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
  assert.deepEqual(colourFace('none'), { text: 'None', none: true });
  assert.deepEqual(colourFace('None'), { text: 'None', none: true });
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

test('a token as the kit wrote it is the computed value when it is the same colour, length or text', () => {
  assert.ok(sameValue('#2d2a26', 'rgb(45, 42, 38)'));
  assert.ok(sameValue('hsl(0 0% 100% / 50%)', 'rgba(255, 255, 255, 0.5)'));
  assert.ok(sameValue('0.5rem', '8px'));
  assert.ok(sameValue('600', '600'));
  assert.ok(sameValue('transparent', 'rgba(0, 0, 0, 0)'));
  assert.ok(!sameValue('#2d2a26', 'rgb(45, 42, 39)'));
  assert.ok(!sameValue('0.5rem', '9px'));
});

test('a shadow token is the computed shadow Chromium writes colour first, in px', () => {
  // As Electron 39 computes a Tailwind shadow class: its two empty ring layers first.
  assert.ok(
    sameValue(
      '0 12px 32px rgb(20 20 20 / 0.12)',
      'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(20, 20, 20, 0.12) 0px 12px 32px 0px',
    ),
  );
  assert.ok(
    sameValue(
      '0 1px 0.125rem #0000000a, inset 0 0 0 1px #000',
      'rgba(0, 0, 0, 0.04) 0px 1px 2px 0px, rgb(0, 0, 0) 0px 0px 0px 1px inset',
    ),
  );
  assert.ok(
    !sameValue('0 12px 32px rgb(20 20 20 / 0.12)', 'rgba(20, 20, 20, 0.12) 0px 12px 30px 0px'),
  );
  assert.ok(!sameValue('0 1px 2px #000', 'rgb(0, 0, 0) 0px 1px 2px 0px inset'));
  // CSS clamps an alpha above 1, so the browser computes it opaque.
  assert.ok(sameValue('0 1px 2px rgba(0, 0, 0, 2)', 'rgb(0, 0, 0) 0px 1px 2px 0px'));
  assert.ok(
    !sameValue('0 1px 2px #000', 'rgb(0, 0, 0) 0px 1px 2px 0px, rgb(0, 0, 0) 0px 1px 2px 0px'),
  );
});

test('a filter reads as its blur, whatever else it composes, and a colour as opaque or not', () => {
  assert.equal(blurOf('blur(12px)'), '12px');
  assert.equal(blurOf('grayscale(1) blur(4px) contrast(1.2)'), '4px');
  assert.equal(blurOf('grayscale(1)'), 'none');
  assert.equal(blurOf('blur(4px) blur(12px)'), 'blur(4px) blur(12px)');
  assert.equal(blurOf('none'), 'none');
  assert.equal(blurOf('--ds-blur-soft'), '--ds-blur-soft');
  assert.ok(isOpaque('rgb(255, 255, 255)'));
  assert.ok(!isOpaque('rgba(255, 255, 255, 0.6)'));
  assert.ok(isOpaque('rgba(0, 0, 0, 2)'));
  assert.ok(!isOpaque('--ds-surface'));
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

test('a shadow reads as the kit tokens it is drawn from, or as none of them', () => {
  const tokens = [
    { value: '--ds-shadow-sm', label: 'shadow-sm', hint: '0 1px 2px rgb(0 0 0 / 0.05)' },
    { value: '--ds-shadow-edge', label: 'shadow-edge', hint: '0 0 0 1px #000' },
    {
      value: '--ds-shadow-ring',
      label: 'shadow-ring',
      hint: '0 0 0 1px #000, 0 4px 8px #0000001a',
    },
    { value: '--ds-shadow-md', label: 'shadow-md', hint: '0 12px 32px rgb(0 0 0 / 0.1)' },
  ];
  const empty = 'rgba(0, 0, 0, 0) 0px 0px 0px 0px';
  const sm = 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px';
  const md = 'rgba(0, 0, 0, 0.1) 0px 12px 32px 0px';
  assert.deepEqual(shadowTokens(`${empty}, ${sm}, ${md}`, tokens), [
    '--ds-shadow-sm',
    '--ds-shadow-md',
  ]);
  // shadow-edge is the ring's first layer, but the ring's second is no token alone.
  const edge = 'rgb(0, 0, 0) 0px 0px 0px 1px';
  assert.deepEqual(shadowTokens(`${edge}, rgba(0, 0, 0, 0.1) 0px 4px 8px 0px`, tokens), [
    '--ds-shadow-ring',
  ]);
  assert.deepEqual(shadowTokens('--ds-shadow-sm, --ds-shadow-md', tokens), [
    '--ds-shadow-sm',
    '--ds-shadow-md',
  ]);
  assert.deepEqual(shadowTokens('none', tokens), []);
  assert.equal(shadowTokens(`${md}, rgba(0, 0, 0, 0.2) 0px 2px 4px 0px`, tokens), null);
  // Tokens that overlap split a long stack many ways, and every way strands its last layer.
  const one = 'rgb(0, 0, 0) 0px 1px 2px 0px';
  const overlapping = [
    { value: '--ds-shadow-one', label: 'shadow-one', hint: '0 1px 2px #000' },
    { value: '--ds-shadow-two', label: 'shadow-two', hint: '0 1px 2px #000, 0 1px 2px #000' },
  ];
  const stack = [...Array<string>(30).fill(one), 'rgb(0, 0, 0) 0px 2px 4px 0px'].join(', ');
  assert.equal(shadowTokens(stack, overlapping), null);
});
