import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  const theme = { colors: { accent: 'var(--ds-accent)', other: 'var(--ds-other)' } };
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
