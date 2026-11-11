import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KIT_THEME_FILE, kitTailwindTheme } from './kitTailwindTheme.js';
import type { SourceElement, SourceFiles } from './protocol.js';
import { applyElementEdit } from './sourceElementEdits.js';
import { SourceElementError } from './sourceElementError.js';
import { instrumentSource } from './sourceElements.js';
import type { ResolvedStyle } from './sourceStyles.js';

function reference(element: SourceElement) {
  return { designId: 'design', revisionId: 'r1', elementId: element.elementId, instancePath: '0' };
}

function onlyElement(files: SourceFiles) {
  const mapped = instrumentSource(files, 'r1');
  assert.equal(mapped.elements.length, 1);
  const element = mapped.elements[0];
  assert.ok(element);
  return { ...mapped, element };
}

const token = (name: string) => ({ kind: 'token', token: name }) as const;
const raw = (value: string) => ({ kind: 'raw', value }) as const;

test('an SVG paint edit drops the presentation attribute its class or inline style outranks', () => {
  const cases: { markup: string; styles: ResolvedStyle[]; changed: string }[] = [
    {
      markup: '<path d="M0 0h4" fill="#0D99FF" stroke="#000" strokeWidth="2" />',
      styles: [
        { property: 'fill', resolution: token('--ds-accent') },
        { property: 'strokeWidth', resolution: raw('1px') },
      ],
      changed:
        '<path d="M0 0h4" stroke="#000" className="fill-[color:var(--ds-accent)] stroke-1" />',
    },
    {
      markup: '<circle fill="none" stroke="red" strokeWidth={3} />',
      styles: [
        { property: 'stroke', resolution: raw('none') },
        { property: 'fill', resolution: raw('#a1b2c3') },
        { property: 'strokeWidth', resolution: raw('3px') },
      ],
      changed: '<circle className="stroke-none" style={{ fill: "#a1b2c3", strokeWidth: 3 }} />',
    },
    {
      markup: '<svg className="block" fill="#000" stroke="currentColor" />',
      styles: [{ property: 'fill', resolution: raw('currentcolor') }],
      changed: '<svg className="block fill-current" stroke="currentColor" />',
    },
    {
      markup: '<path className="stroke-[percentage:var(--x)]" stroke-width="2" />',
      styles: [{ property: 'strokeWidth', resolution: raw('1px') }],
      changed: '<path className="stroke-1" />',
    },
  ];
  for (const { markup, styles, changed } of cases) {
    const files = { 'main.tsx': `export default () => ${markup};\n` };
    const mapped = onlyElement(files);
    const edited = applyElementEdit(files, mapped.elements, {
      element: reference(mapped.element),
      change: { kind: 'style', styles },
    });
    assert.deepEqual(edited, { 'main.tsx': `export default () => ${changed};\n` });
  }
});

test('an SVG paint edit replaces a paint class named by the kit or by a colour name', () => {
  const colors = { accent: 'var(--ds-accent)', other: 'var(--ds-other)' };
  const theme = kitTailwindTheme({
    sections: [],
    files: { [KIT_THEME_FILE]: JSON.stringify({ colors }) },
  });
  const cases: { markup: string; property: string; changed: string }[] = [
    { markup: 'fill-accent', property: 'fill', changed: 'fill-[color:var(--ds-other)]' },
    { markup: 'stroke-accent/50', property: 'stroke', changed: 'stroke-[color:var(--ds-other)]' },
    { markup: 'fill-[red]', property: 'fill', changed: 'fill-[color:var(--ds-other)]' },
    { markup: 'stroke-[red]', property: 'stroke', changed: 'stroke-[color:var(--ds-other)]' },
  ];
  for (const { markup, property, changed } of cases) {
    const files = { 'main.tsx': `export default () => <path className="${markup}" />;\n` };
    const mapped = onlyElement(files);
    const edited = applyElementEdit(files, mapped.elements, {
      element: reference(mapped.element),
      change: { kind: 'style', styles: [{ property, resolution: token('--ds-other') }], theme },
    });
    assert.deepEqual(
      edited,
      { 'main.tsx': `export default () => <path className="${changed}" />;\n` },
      markup,
    );
  }
});

test('an SVG paint attribute worked out in code is left to the agent, not dropped', () => {
  const cases: { attribute: string; property: string }[] = [
    { attribute: 'fill={active ? "#fff" : "#000"}', property: 'fill' },
    { attribute: 'stroke={paint()}', property: 'stroke' },
    { attribute: 'strokeWidth={width}', property: 'strokeWidth' },
    { attribute: 'stroke-width={width}', property: 'strokeWidth' },
  ];
  for (const { attribute, property } of cases) {
    const files = {
      'main.tsx': `export default ({ active, width }) => <path d="M0 0h4" ${attribute} />;\n`,
    };
    const mapped = onlyElement(files);
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, {
          element: reference(mapped.element),
          change: { kind: 'style', styles: [{ property, resolution: raw('2px') }] },
        }),
      (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
      attribute,
    );
  }
});

test('a class a kit theme colour key makes two utilities stays, and the edited property goes inline', () => {
  const other = token('--ds-other');
  const cases: { markup: string; colors: string; styles: ResolvedStyle[]; changed: string }[] = [
    {
      markup:
        '<div className="bg-cover" style={{ backgroundImage: "linear-gradient(red, blue)" }}>Box</div>',
      colors: 'cover',
      styles: [{ property: 'backgroundColor', resolution: other }],
      changed:
        '<div className="bg-cover" style={{ backgroundImage: "linear-gradient(red, blue)", backgroundColor: "var(--ds-other)" }}>Box</div>',
    },
    {
      markup: '<p className="text-brand">Box</p>',
      colors: 'brand',
      styles: [{ property: 'color', resolution: other }],
      changed: '<p className="text-brand" style={{ color: "var(--ds-other)" }}>Box</p>',
    },
    {
      markup: '<p className="text-brand">Box</p>',
      colors: 'brand',
      styles: [{ property: 'fontSize', resolution: raw('24px') }],
      changed: '<p className="text-brand" style={{ fontSize: 24 }}>Box</p>',
    },
    {
      markup: '<p className="text-sm text-center">Box</p>',
      colors: 'sm',
      styles: [{ property: 'color', resolution: other }],
      changed: '<p className="text-sm text-center" style={{ color: "var(--ds-other)" }}>Box</p>',
    },
    {
      markup: '<p className="text-center">Box</p>',
      colors: 'center',
      styles: [{ property: 'color', resolution: other }],
      changed: '<p className="text-center" style={{ color: "var(--ds-other)" }}>Box</p>',
    },
    {
      markup: '<div className="border-2">Box</div>',
      colors: '2',
      styles: [{ property: 'borderColor', resolution: other }],
      changed: '<div className="border-2" style={{ borderColor: "var(--ds-other)" }}>Box</div>',
    },
    {
      markup: '<path className="stroke-2" />',
      colors: '2',
      styles: [{ property: 'stroke', resolution: other }],
      changed: '<path className="stroke-2" style={{ stroke: "var(--ds-other)" }} />',
    },
    {
      markup: '<div className="border-t-2" style={{ borderStyle: "solid" }}>Box</div>',
      colors: 't-2',
      styles: [{ property: 'borderWidth', resolution: raw('1px') }],
      changed:
        '<div className="border-t-2" style={{ borderStyle: "solid", borderWidth: 1 }}>Box</div>',
    },
  ];
  for (const { markup, colors, styles, changed } of cases) {
    const files = { 'main.tsx': `export default () => ${markup};\n` };
    const mapped = onlyElement(files);
    const theme = { colors: { [colors]: '#ff0000' }, fontSize: { brand: '20px' } };
    const edited = applyElementEdit(files, mapped.elements, {
      element: reference(mapped.element),
      change: { kind: 'style', styles, theme },
    });
    assert.deepEqual(edited, { 'main.tsx': `export default () => ${changed};\n` }, markup);
  }
});

test('an important class a kit theme key makes two utilities refuses the edit inline cannot win', () => {
  const files = { 'main.tsx': 'export default () => <div className="!bg-cover">Box</div>;\n' };
  const mapped = onlyElement(files);
  assert.throws(
    () =>
      applyElementEdit(files, mapped.elements, {
        element: reference(mapped.element),
        change: {
          kind: 'style',
          styles: [{ property: 'backgroundColor', resolution: token('--ds-other') }],
          theme: { colors: { cover: '#ff0000' } },
        },
      }),
    (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
  );
});
