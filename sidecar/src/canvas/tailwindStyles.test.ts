// Every class a style edit can write, compiled by the Tailwind designs compile
// with, must set the property the edit means to the value it means, and must
// read back as setting that property, so the next edit finds and replaces it.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  canvasRuntime,
  ownedCanvasRuntimeDir,
  startCanvasRuntime,
  stopCanvasRuntime,
} from './canvasRuntime.js';
import { CANVAS_TAILWIND_OPTIONS } from './designStylesheet.js';
import {
  canonicalCss,
  resolveStyleChange,
  STYLE_PROPERTIES,
  styleValue,
  type StyleResolution,
} from './styleEdits.js';
import { BLUR } from './tailwindStock.js';
import { classStyle, longhands, styleClass } from './tailwindStyles.js';

const TOKEN = '--ds-probe';
const RAW_VALUES = [
  '0',
  '1px',
  '2px',
  '4px',
  '6px',
  '8px',
  '0.75rem',
  '16px',
  '24px',
  '320px',
  '100%',
  '9999px',
  '-4px',
  '-16px',
  '1',
  '1.25',
  '1.5',
  '0.5',
  '0.25',
  '400',
  '600',
  '-0.025em',
  '0.05em',
  'auto',
  'fit-content',
  'none',
  'currentColor',
  ...Object.values(BLUR),
  'blur(0.5rem)',
];
// Tailwind sets a shadow through its own variable, after ring layers, and a
// blur through its own, which the filter composes.
const SET_THROUGH: Readonly<Record<string, string>> = {
  boxShadow: '--tw-shadow',
  filter: '--tw-blur',
  backdropFilter: '--tw-backdrop-blur',
};

after(() => stopCanvasRuntime());

/** Each class the edit writes for a property, with the CSS value it must set. */
function writableClasses() {
  const written: { property: string; name: string; value: string }[] = [];
  for (const [property, rule] of Object.entries(STYLE_PROPERTIES)) {
    const values = typeof rule.values === 'string' ? RAW_VALUES : rule.values;
    const resolutions: StyleResolution[] = [{ kind: 'token', token: TOKEN }];
    if (rule.stacks) resolutions.push({ kind: 'tokens', tokens: [TOKEN, `${TOKEN}-2`] });
    for (const value of values) {
      try {
        resolutions.push(resolveStyleChange({ property, value }, {}));
      } catch {
        // A value this property cannot take never reaches the writer.
      }
    }
    for (const resolution of resolutions) {
      const name = styleClass(property, resolution);
      if (name !== null) written.push({ property, name, value: styleValue(property, resolution) });
    }
  }
  return written;
}

/** The declarations Tailwind generates for each class, by class name. */
async function compiled(names: readonly string[]): Promise<Map<string, Map<string, string>>> {
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const { postcss, tailwindcss } = canvasRuntime();
  const content = [{ raw: names.map((name) => `"${name}"`).join(' '), extension: 'tsx' }];
  const result = await postcss([tailwindcss({ content, ...CANVAS_TAILWIND_OPTIONS })]).process(
    '@tailwind utilities;',
    { from: undefined },
  );
  const rules = new Map<string, Map<string, string>>();
  result.root.walkRules((rule) => {
    // A comma is escaped by its code point, `\2c `.
    const name = rule.selector
      .slice(1)
      .replace(/\\([\da-f]{1,6}) ?|\\(.)/gi, (_, code?: string, character?: string) =>
        code === undefined ? (character ?? '') : String.fromCodePoint(parseInt(code, 16)),
      );
    const declarations = new Map<string, string>();
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value);
    });
    rules.set(name, declarations);
  });
  return rules;
}

test('every class a style edit writes sets its property to the value the edit meant', async () => {
  const written = writableClasses();
  const rules = await compiled(written.map(({ name }) => name));
  for (const { property, name, value } of written) {
    const declarations = rules.get(name);
    assert.ok(declarations, `Tailwind generated nothing for ${name}`);
    const css = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const set = declarations.get(SET_THROUGH[property] ?? css);
    assert.ok(set !== undefined, `${name} sets no ${css}`);
    // `blur-none` sets its blur to nothing.
    const isFilter = property === 'filter' || property === 'backdropFilter';
    const read = isFilter && set.trim() === '' ? 'none' : set;
    // SVG reads a bare stroke width in pixels.
    const sets = property === 'strokeWidth' && /^\d+$/.test(read) ? `${read}px` : read;
    assert.equal(canonicalCss(sets), canonicalCss(value), `${name} for ${property}: ${value}`);
    assert.deepEqual(classStyle(name), { sets: longhands(property), scope: 'always' }, name);
  }
});

test('a stroke class sets the width or the colour its value names', () => {
  for (const name of ['stroke-2', 'stroke-[1.5]', 'stroke-[number:var(--w)]'])
    assert.deepEqual(classStyle(name)?.sets, ['strokeWidth'], name);
  for (const name of [
    'stroke-black',
    'stroke-[#fff]',
    'stroke-[var(--ds-accent)]',
    'stroke-current',
  ])
    assert.deepEqual(classStyle(name)?.sets, ['stroke'], name);
});

test('a class under a breakpoint or colour mode applies per frame, under any other variant per state', () => {
  assert.equal(classStyle('md:p-4')?.scope, 'frame');
  assert.equal(classStyle('dark:hover:bg-black')?.scope, 'frame');
  assert.equal(classStyle('hover:p-4')?.scope, 'state');
  assert.equal(classStyle('[&>*]:p-4')?.scope, 'state');
  assert.equal(classStyle('title'), null);
});
